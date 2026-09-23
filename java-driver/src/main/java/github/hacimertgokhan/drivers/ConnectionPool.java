package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisConnectionException;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import github.hacimertgokhan.drivers.exceptions.DenisTimeoutException;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReferenceArray;
import java.util.function.UnaryOperator;

/**
 * A fixed number of pipelined connections that share one session state
 * (group login and selected project).
 *
 * <p>Commands go to the open connection with the fewest commands in flight.
 * A connection that breaks is dropped from its slot; with reconnect enabled a
 * background thread re-opens it with exponential backoff and replays the
 * handshake ({@code MODE json}, {@code LIN}, {@code AUTH}). Commands submitted
 * while no connection is open wait for one (up to the command timeout);
 * commands that were already sent are never re-sent.
 */
final class ConnectionPool implements Connection.Listener {
    private static final System.Logger LOG = System.getLogger(DenisClient.class.getName());
    /** A connection whose oldest command waits longer than this is avoided when choosing where to send. */
    static final long BUSY_NANOS = TimeUnit.MILLISECONDS.toNanos(1);

    /** Immutable session state replayed on every (re)connect. */
    static final class SessionState {
        final String group;
        final String password;
        final String token;

        SessionState(String group, String password, String token) {
            this.group = group;
            this.password = password;
            this.token = token;
        }

        SessionState withLogin(String newGroup, String newPassword) {
            // the server keeps the selected project when the same group logs in again
            return new SessionState(newGroup, newPassword, newGroup.equals(group) ? token : null);
        }

        SessionState withToken(String newToken) {
            return new SessionState(group, password, newToken);
        }
    }

    private final ClientConfig config;
    private final AtomicReferenceArray<Connection> slots;
    private final AtomicBoolean[] reconnecting;
    private final Object stateLock = new Object();
    private final List<Runnable> waiters = new ArrayList<>(); // guarded by this
    private final AtomicInteger roundRobin = new AtomicInteger();
    private final ScheduledThreadPoolExecutor timer;
    private final ExecutorService workers;
    private volatile SessionState session;
    private volatile boolean closed;

    ConnectionPool(ClientConfig config) {
        this.config = config;
        this.slots = new AtomicReferenceArray<>(config.poolSize);
        this.reconnecting = new AtomicBoolean[config.poolSize];
        for (int i = 0; i < reconnecting.length; i++) {
            reconnecting[i] = new AtomicBoolean();
        }
        this.session = new SessionState(config.group, config.password, config.token);
        this.timer = new ScheduledThreadPoolExecutor(1, daemonThreads("denis-timer"));
        this.timer.setRemoveOnCancelPolicy(true);
        this.workers = new ThreadPoolExecutor(0, Integer.MAX_VALUE, 30, TimeUnit.SECONDS,
                new SynchronousQueue<>(), daemonThreads("denis-worker"));
    }

    private static ThreadFactory daemonThreads(String prefix) {
        AtomicInteger n = new AtomicInteger();
        return r -> {
            Thread t = new Thread(r, prefix + "-" + n.incrementAndGet());
            t.setDaemon(true);
            return t;
        };
    }

    ClientConfig config() {
        return config;
    }

    String token() {
        return session.token;
    }

    String group() {
        return session.group;
    }

    boolean isClosed() {
        return closed;
    }

    ExecutorService workers() {
        return workers;
    }

    /** Number of currently open connections. */
    int openConnections() {
        int n = 0;
        for (int i = 0; i < slots.length(); i++) {
            Connection c = slots.get(i);
            if (c != null && c.isOpen()) {
                n++;
            }
        }
        return n;
    }

    // =================================================================== startup

    /** Open every connection eagerly; the first one creates the project when configured to. */
    void start() {
        try {
            Connection first = openAndHandshake(session);
            if (config.createProject && session.token == null) {
                if (session.group == null) {
                    first.close(clientClosed());
                    throw Protocol.invalid("createProject(true) needs credentials(group, password)");
                }
                long t = config.handshakeTimeoutNanos();
                String token = await(first.send(Commands.createProject()), t);
                await(first.send(Commands.auth(token)), t);
                session = session.withToken(token);
            }
            runAll(publish(0, first));
            List<CompletableFuture<Connection>> rest = new ArrayList<>();
            SessionState s = session;
            for (int i = 1; i < config.poolSize; i++) {
                rest.add(CompletableFuture.supplyAsync(() -> openAndHandshake(s), workers));
            }
            DenisException failure = null;
            for (int i = 0; i < rest.size(); i++) {
                try {
                    runAll(publish(i + 1, await(rest.get(i), 0)));
                } catch (DenisException e) {
                    if (failure == null) {
                        failure = e;
                    }
                }
            }
            if (failure != null) {
                throw failure;
            }
            long timeout = config.commandTimeoutNanos();
            if (timeout > 0) {
                long period = Math.max(5, Math.min(100, timeout / 4_000_000L));
                timer.scheduleWithFixedDelay(this::sweep, period, period, TimeUnit.MILLISECONDS);
            }
        } catch (RuntimeException e) {
            closeNow();
            throw e;
        }
    }

    private Connection openAndHandshake(SessionState s) {
        Connection c = Connection.open(config.host, config.port, config.connectTimeoutMillis(), config.maxReplyBytes, this);
        try {
            List<Command.Pending<?>> batch = new ArrayList<>(3);
            Command.Pending<?> mode = new Command.Pending<>(Commands.modeJson());
            batch.add(mode);
            if (s.group != null) {
                batch.add(new Command.Pending<>(Commands.login(s.group, s.password)));
            }
            if (s.token != null) {
                batch.add(new Command.Pending<>(Commands.auth(s.token)));
            }
            c.write(batch);
            long t = config.handshakeTimeoutNanos();
            try {
                await(mode.future, t);
            } catch (DenisException e) {
                Throwable cause = e.getCause();
                if (cause instanceof DenisException && DenisException.PROTOCOL.equals(((DenisException) cause).code())) {
                    throw new DenisException(DenisException.PROTOCOL, config.host + ":" + config.port
                            + " did not accept MODE json; is it a Denis server speaking protocol 2? (" + cause.getMessage() + ")", null, e);
                }
                throw e;
            }
            for (int i = 1; i < batch.size(); i++) {
                await(batch.get(i).future, t);
            }
            return c;
        } catch (RuntimeException e) {
            c.close(new DenisConnectionException(DenisException.CLOSED, "handshake failed: " + e.getMessage(), e));
            throw e;
        }
    }

    /** Put {@code c} into slot {@code index}; returns the waiters that can now run. */
    private List<Runnable> publish(int index, Connection c) {
        List<Runnable> ready;
        synchronized (this) {
            if (closed) {
                c.close(clientClosed());
                return List.of();
            }
            slots.set(index, c);
            ready = new ArrayList<>(waiters);
            waiters.clear();
        }
        if (!c.isOpen() && slots.compareAndSet(index, c, null)) {
            // closed between handshake and publication; the listener did not see it in its slot
            scheduleReconnect(index);
        }
        return ready;
    }

    private static void runAll(List<Runnable> tasks) {
        for (Runnable r : tasks) {
            r.run();
        }
    }

    // =================================================================== dispatch

    /**
     * Choose a connection. Blocking callers and pipelines ({@code affinity}
     * false) get the open connection with the fewest commands in flight:
     * lowest latency, and a slow command never delays them. Async callers get
     * their thread's "home" connection so one thread's commands are written
     * back to back and coalesce into few system calls (least-pending routing
     * would chase idle connections and pay one flush per command), unless the
     * home connection's oldest command has waited longer than
     * {@link #BUSY_NANOS}; then they fall back to least pending too.
     */
    private Connection pick(boolean affinity) {
        int n = slots.length();
        if (n == 1) {
            Connection c = slots.get(0);
            return c != null && c.isOpen() ? c : null;
        }
        Connection home = slots.get((int) Math.floorMod(Thread.currentThread().getId(), (long) n));
        if (affinity && home != null && home.isOpen() && home.headWaitNanos(System.nanoTime()) < BUSY_NANOS) {
            return home;
        }
        int start = (roundRobin.getAndIncrement() & Integer.MAX_VALUE) % n;
        Connection best = null;
        int bestLoad = Integer.MAX_VALUE;
        for (int k = 0; k < n; k++) {
            Connection c = slots.get((start + k) % n);
            if (c == null || !c.isOpen()) {
                continue;
            }
            int load = c.inFlight();
            if (load < bestLoad) {
                best = c;
                bestLoad = load;
                if (load == 0) {
                    break;
                }
            }
        }
        return best;
    }

    private List<Connection> openList() {
        List<Connection> list = new ArrayList<>();
        for (int i = 0; i < slots.length(); i++) {
            Connection c = slots.get(i);
            if (c != null && c.isOpen()) {
                list.add(c);
            }
        }
        return list;
    }

    <T> CompletableFuture<T> submit(Command<T> command) {
        return submit(command, false);
    }

    /** @param affinity route by thread affinity (async callers) instead of least pending (blocking callers) */
    <T> CompletableFuture<T> submit(Command<T> command, boolean affinity) {
        Command.Pending<T> p = new Command.Pending<>(command);
        dispatch(new ArrayList<>(List.of(p)), affinity);
        return p.future;
    }

    /** Send {@code batch} contiguously on one connection. Failures complete the futures. */
    void dispatch(List<Command.Pending<?>> batch, boolean affinity) {
        if (closed) {
            failAll(batch, clientClosed());
            return;
        }
        Connection c = pick(affinity);
        if (c != null) {
            c.write(batch);
            return;
        }
        if (!config.reconnect) {
            failAll(batch, noConnection(null));
            return;
        }
        AtomicBoolean claimed = new AtomicBoolean();
        Runnable retry = () -> {
            if (claimed.compareAndSet(false, true)) {
                batch.removeIf(p -> p.future.isDone()); // e.g. a synchronous caller gave up
                if (!batch.isEmpty()) {
                    dispatch(batch, affinity);
                }
            }
        };
        synchronized (this) {
            if (!closed) {
                c = pick(affinity);
                if (c == null) {
                    waiters.add(retry);
                }
            }
        }
        if (closed) {
            failAll(batch, clientClosed());
            return;
        }
        if (c != null) {
            c.write(batch);
            return;
        }
        ensureReconnecting();
        long timeout = config.commandTimeoutNanos();
        if (timeout > 0) {
            try {
                timer.schedule(() -> {
                    if (claimed.compareAndSet(false, true)) {
                        synchronized (this) {
                            waiters.remove(retry);
                        }
                        failAll(batch, noConnection(timeout));
                    }
                }, timeout, TimeUnit.NANOSECONDS);
            } catch (RejectedExecutionException e) {
                // closing: close() fails the waiters
            }
        }
    }

    private static void failAll(List<Command.Pending<?>> batch, DenisException e) {
        for (Command.Pending<?> p : batch) {
            p.fail(e);
        }
    }

    private DenisException noConnection(Long waitedNanos) {
        return new DenisConnectionException(DenisException.CONNECTION, "no open connection to " + config.host + ":" + config.port
                + (waitedNanos == null ? "" : " within " + waitedNanos / 1_000_000L + " ms (still reconnecting)"));
    }

    DenisException clientClosed() {
        return new DenisConnectionException(DenisException.CLOSED, "the Denis client is closed");
    }

    private void sweep() {
        long timeout = config.commandTimeoutNanos();
        long now = System.nanoTime();
        for (int i = 0; i < slots.length(); i++) {
            Connection c = slots.get(i);
            if (c != null) {
                c.checkTimeout(now, timeout);
            }
        }
    }

    // =================================================================== session changes

    /**
     * Run a session command ({@code LIN}/{@code AUTH}) on every open
     * connection and remember the new state for reconnects. The first
     * connection decides success; a connection where the command then fails
     * is closed (and re-opened with the new state when reconnect is on).
     */
    <T> T applySession(Command<T> command, UnaryOperator<SessionState> next) {
        checkNotIoThread();
        synchronized (stateLock) {
            ensureOpen();
            List<Connection> open = openList();
            if (open.isEmpty()) {
                throw noConnection(null);
            }
            long t = config.commandTimeoutNanos();
            T result = await(open.get(0).send(command), t);
            session = next.apply(session);
            List<CompletableFuture<T>> others = new ArrayList<>();
            for (int i = 1; i < open.size(); i++) {
                others.add(open.get(i).send(command));
            }
            for (int i = 0; i < others.size(); i++) {
                try {
                    await(others.get(i), t);
                } catch (DenisException e) {
                    open.get(i + 1).close(new DenisConnectionException(DenisException.CLOSED,
                            "session change (" + command.name + ") failed on this connection: " + e.getMessage(), e));
                }
            }
            return result;
        }
    }

    /** Forget the selected project and replace every connection with a fresh one without it. */
    void resetProject() {
        synchronized (stateLock) {
            session = session.withToken(null);
            for (int i = 0; i < slots.length(); i++) {
                Connection old = slots.get(i);
                if (old == null || closed) {
                    continue;
                }
                Connection fresh = null;
                try {
                    fresh = openAndHandshake(session);
                } catch (DenisException e) {
                    LOG.log(System.Logger.Level.WARNING, "Could not re-open Denis connection: " + e.getMessage());
                }
                if (fresh != null) {
                    runAll(publish(i, fresh));
                }
                old.close(new DenisConnectionException(DenisException.CLOSED, "the selected project was deleted"));
            }
        }
    }

    // =================================================================== reconnect

    @Override
    public void closed(Connection connection, DenisException cause) {
        for (int i = 0; i < slots.length(); i++) {
            if (slots.compareAndSet(i, connection, null)) {
                if (!closed) {
                    LOG.log(System.Logger.Level.WARNING, "Denis connection lost: " + cause.getMessage());
                    scheduleReconnect(i);
                }
                return;
            }
        }
    }

    private void ensureReconnecting() {
        for (int i = 0; i < slots.length(); i++) {
            if (slots.get(i) == null) {
                scheduleReconnect(i);
            }
        }
    }

    private void scheduleReconnect(int index) {
        if (closed || !config.reconnect || !reconnecting[index].compareAndSet(false, true)) {
            return;
        }
        try {
            workers.execute(() -> reconnectLoop(index));
        } catch (RejectedExecutionException e) {
            reconnecting[index].set(false);
        }
    }

    private void reconnectLoop(int index) {
        try {
            long delay = 0;
            int attempt = 0;
            while (!closed) {
                if (delay > 0) {
                    try {
                        Thread.sleep(delay);
                    } catch (InterruptedException e) {
                        return;
                    }
                    if (closed) {
                        return;
                    }
                }
                attempt++;
                SessionState s = session;
                try {
                    Connection c = openAndHandshake(s);
                    List<Runnable> ready = null;
                    synchronized (stateLock) {
                        if (session == s) {
                            ready = publish(index, c);
                        }
                    }
                    if (ready == null) {
                        // the session changed during the handshake: start over with the new state
                        c.close(new DenisConnectionException(DenisException.CLOSED, "stale session"));
                        delay = 0;
                        continue;
                    }
                    LOG.log(System.Logger.Level.INFO, "Denis connection re-established to " + config.host + ":" + config.port
                            + " after " + attempt + " attempt(s)");
                    runAll(ready);
                    return;
                } catch (DenisException e) {
                    LOG.log(System.Logger.Level.DEBUG, "Denis reconnect attempt " + attempt + " failed: " + e.getMessage());
                    long min = Math.max(1, config.reconnectMinDelay.toMillis());
                    delay = delay == 0 ? min : Math.min(delay * 2, Math.max(min, config.reconnectMaxDelay.toMillis()));
                }
            }
        } finally {
            reconnecting[index].set(false);
            // the connection may have died again before the flag was cleared
            if (!closed && slots.get(index) == null) {
                scheduleReconnect(index);
            }
        }
    }

    // =================================================================== waiting and closing

    void ensureOpen() {
        if (closed) {
            throw clientClosed();
        }
    }

    /**
     * Wait for {@code future}. {@code timeoutNanos <= 0} waits until it
     * completes (the timeout sweeper still bounds commands on a stalled
     * connection). On timeout the future is failed so a late reply is ignored.
     */
    static <T> T await(CompletableFuture<T> future, long timeoutNanos) {
        if (!future.isDone()) {
            checkNotIoThread();
        }
        try {
            return timeoutNanos > 0 ? future.get(timeoutNanos, TimeUnit.NANOSECONDS) : future.get();
        } catch (ExecutionException e) {
            throw unwrap(e.getCause());
        } catch (TimeoutException e) {
            DenisTimeoutException timeout = new DenisTimeoutException("no reply within " + timeoutNanos / 1_000_000L + " ms");
            if (future.completeExceptionally(timeout)) {
                throw timeout;
            }
            return await(future, 0);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new DenisException(DenisException.INTERRUPTED, "interrupted while waiting for a Denis reply");
        }
    }

    /** Blocking on a reader thread would wait for a reply only that thread can read. */
    static void checkNotIoThread() {
        if (Thread.currentThread() instanceof Connection.ReaderThread) {
            throw new DenisException(DenisException.INVALID, "blocking Denis call on a driver I/O thread "
                    + "(inside a callback of an async command); use the async API there, or attach the callback "
                    + "with a *Async method and your own executor");
        }
    }

    static DenisException unwrap(Throwable t) {
        while ((t instanceof CompletionException || t instanceof ExecutionException) && t.getCause() != null) {
            t = t.getCause();
        }
        if (t instanceof DenisException) {
            return (DenisException) t;
        }
        return new DenisException(DenisException.ERROR, String.valueOf(t), null, t);
    }

    /** Stop accepting commands, let in-flight ones finish (up to the shutdown timeout), then close everything. */
    void close() {
        List<Runnable> pendingWaiters;
        synchronized (this) {
            if (closed) {
                return;
            }
            closed = true;
            pendingWaiters = new ArrayList<>(waiters);
            waiters.clear();
        }
        runAll(pendingWaiters); // dispatch sees closed and fails them with CLOSED
        long grace = config.shutdownTimeout.toMillis();
        if (grace > 0 && !(Thread.currentThread() instanceof Connection.ReaderThread)) {
            List<CompletableFuture<?>> inFlight = new ArrayList<>();
            for (Connection c : openList()) {
                inFlight.addAll(c.inFlightFutures());
            }
            if (!inFlight.isEmpty()) {
                try {
                    CompletableFuture.allOf(inFlight.toArray(new CompletableFuture<?>[0])).get(grace, TimeUnit.MILLISECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (ExecutionException | TimeoutException ignored) {
                    // failures belong to their callers; stragglers are failed below
                }
            }
        }
        closeNow();
    }

    private void closeNow() {
        closed = true;
        for (int i = 0; i < slots.length(); i++) {
            Connection c = slots.getAndSet(i, null);
            if (c != null) {
                c.close(clientClosed());
            }
        }
        timer.shutdownNow();
        workers.shutdownNow();
    }
}
