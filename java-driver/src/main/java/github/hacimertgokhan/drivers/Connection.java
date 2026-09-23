package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisConnectionException;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import github.hacimertgokhan.drivers.exceptions.DenisTimeoutException;

import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;

/**
 * One pipelined TCP connection.
 *
 * <p>Writers append request lines under a lock and queue their pending
 * futures in the same order; one daemon reader thread reads reply lines and
 * completes the oldest pending future for each (the server answers in
 * order). A writer only flushes when no other writer is waiting for the lock,
 * so bursts from many threads are coalesced into few system calls.
 *
 * <p>When the connection breaks, times out or receives garbage it is closed
 * and every in-flight future fails; nothing is ever re-sent.
 */
final class Connection {
    /** Notified exactly once when the connection closes. */
    interface Listener {
        void closed(Connection connection, DenisException cause);
    }

    private static final int READ_BUFFER = 64 * 1024;
    private static final AtomicInteger IDS = new AtomicInteger();

    final int id = IDS.incrementAndGet();
    private final String address;
    private final Socket socket;
    private final OutputStream out;
    private final InputStream in;
    private final long maxReplyBytes;
    private final Listener listener;
    private final ReentrantLock writeLock = new ReentrantLock();
    private final AtomicInteger writersWaiting = new AtomicInteger();
    private final ConcurrentLinkedQueue<Command.Pending<?>> pending = new ConcurrentLinkedQueue<>();
    private final AtomicInteger inFlight = new AtomicInteger();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final ReaderThread reader;
    private volatile long lastProgressNanos = System.nanoTime();
    private volatile DenisException closeCause;

    // flush coalescing (see write() and flushIfDirty())
    /** Commands written to the buffer (guarded by writeLock). */
    private long writtenSeq;
    /** Commands known to be flushed to the socket (written under writeLock). */
    private volatile long flushedSeq;
    /** Replies received (reader thread only). */
    private volatile long repliedSeq;
    /** Buffered, unflushed data exists. */
    private volatile boolean dirty;

    // reader state (reader thread only)
    private final byte[] buf = new byte[READ_BUFFER];
    private int bufPos;
    private int bufLen;
    private byte[] line = new byte[1024];
    private int lineLen;

    private Connection(String host, int port, Socket socket, long maxReplyBytes, Listener listener) throws IOException {
        this.address = host + ":" + port;
        this.socket = socket;
        this.out = new BufferedOutputStream(socket.getOutputStream(), 64 * 1024);
        this.in = socket.getInputStream();
        this.maxReplyBytes = maxReplyBytes;
        this.listener = listener;
        this.reader = new ReaderThread(this);
    }

    /** Open a TCP connection and start its reader thread (no handshake). */
    static Connection open(String host, int port, int connectTimeoutMillis, long maxReplyBytes, Listener listener) {
        Socket socket = new Socket();
        try {
            socket.setTcpNoDelay(true);
            socket.setKeepAlive(true);
            socket.connect(new InetSocketAddress(host, port), Math.max(0, connectTimeoutMillis));
            Connection connection = new Connection(host, port, socket, maxReplyBytes, listener);
            connection.reader.start();
            return connection;
        } catch (SocketTimeoutException e) {
            closeQuietly(socket);
            throw new DenisConnectionException(DenisException.CONNECTION,
                    "cannot connect to " + host + ":" + port + ": timed out after " + connectTimeoutMillis + " ms", e);
        } catch (IOException | RuntimeException e) {
            closeQuietly(socket);
            throw new DenisConnectionException(DenisException.CONNECTION,
                    "cannot connect to " + host + ":" + port + ": " + e.getMessage(), e);
        }
    }

    boolean isOpen() {
        return !closed.get();
    }

    int inFlight() {
        return inFlight.get();
    }

    /**
     * How long the oldest in-flight command has been waiting for its reply
     * (since it was sent and since the previous reply arrived); 0 when idle.
     */
    long headWaitNanos(long now) {
        Command.Pending<?> head = pending.peek();
        if (head == null) {
            return 0;
        }
        return now - Math.max(head.sentNanos, lastProgressNanos);
    }

    DenisException closeCause() {
        return closeCause;
    }

    @Override
    public String toString() {
        return "Connection#" + id + "(" + address + (closed.get() ? ", closed" : ", in-flight=" + inFlight.get()) + ")";
    }

    // =================================================================== writing

    <T> CompletableFuture<T> send(Command<T> command) {
        Command.Pending<T> p = new Command.Pending<>(command);
        write(List.of(p));
        return p.future;
    }

    /**
     * Queue and write {@code batch} contiguously, in order. Failures are
     * reported through the pending futures, never thrown.
     */
    void write(List<? extends Command.Pending<?>> batch) {
        if (batch.isEmpty()) {
            return;
        }
        IOException failure = null;
        writersWaiting.incrementAndGet();
        writeLock.lock();
        try {
            writersWaiting.decrementAndGet();
            if (closed.get()) {
                DenisException cause = closedError();
                for (Command.Pending<?> p : batch) {
                    p.fail(cause);
                }
                return;
            }
            long now = System.nanoTime();
            for (Command.Pending<?> p : batch) {
                p.sentNanos = now;
                inFlight.incrementAndGet();
                pending.add(p);
            }
            try {
                for (Command.Pending<?> p : batch) {
                    out.write(p.command.frame);
                }
                writtenSeq += batch.size();
                // Flush coalescing. Skip the flush when (a) another writer is about to take the lock (it decides
                // after us), or (b) an already flushed command still awaits its reply: the reader thread flushes
                // before it blocks again. 'dirty' is written before 'repliedSeq' is read, and the reader writes
                // 'repliedSeq' before it reads 'dirty' (volatile, Dekker style), so either we see the reply and
                // flush, or the reader sees 'dirty' and flushes: data is never stranded.
                dirty = true;
                if (writersWaiting.get() == 0 && flushedSeq <= repliedSeq) {
                    flushLocked();
                }
            } catch (IOException e) {
                failure = e;
            }
        } finally {
            writeLock.unlock();
        }
        if (failure != null) {
            close(new DenisConnectionException(DenisException.CLOSED,
                    "connection to " + address + " failed while writing: " + failure.getMessage(), failure));
        }
    }

    /** Caller holds writeLock. */
    private void flushLocked() throws IOException {
        dirty = false;
        out.flush();
        flushedSeq = writtenSeq;
    }

    /** Reader thread, before it blocks on the socket: send what writers left in the buffer. */
    private void flushIfDirty() throws IOException {
        if (!dirty) {
            return;
        }
        writeLock.lock();
        try {
            if (dirty && !closed.get()) {
                flushLocked();
            }
        } finally {
            writeLock.unlock();
        }
    }

    private DenisException closedError() {
        DenisException cause = closeCause;
        return new DenisConnectionException(DenisException.CLOSED,
                "connection to " + address + " is closed" + (cause == null ? "" : ": " + cause.getMessage()), cause);
    }

    // =================================================================== reading

    static final class ReaderThread extends Thread {
        private final Connection connection;

        ReaderThread(Connection connection) {
            super("denis-reader-" + connection.id);
            this.connection = connection;
            setDaemon(true);
        }

        @Override
        public void run() {
            connection.readLoop();
        }
    }

    private void readLoop() {
        try {
            while (!closed.get()) {
                String text = readLine();
                if (text == null) {
                    close(new DenisConnectionException(DenisException.CLOSED, "connection closed by server " + address));
                    return;
                }
                lastProgressNanos = System.nanoTime();
                Map<String, Object> reply;
                try {
                    reply = Json.parseObject(text);
                } catch (Json.JsonException e) {
                    DenisException error = Protocol.protocol("malformed reply from " + address + " (" + e.getMessage() + "): "
                            + Protocol.abbreviate(text));
                    Command.Pending<?> head = pending.peek();
                    if (head != null) {
                        head.fail(error); // the command this line answered; the rest fail with CLOSED below
                    }
                    close(error);
                    return;
                }
                Command.Pending<?> p = pending.poll();
                if (p == null) {
                    close(Protocol.protocol("unexpected reply from " + address + " with no command outstanding: "
                            + Protocol.abbreviate(text)));
                    return;
                }
                inFlight.decrementAndGet();
                repliedSeq = repliedSeq + 1; // single writer: the reader thread
                try {
                    p.complete(reply);
                } catch (Throwable t) {
                    // a dependent callback threw; that is the caller's problem, keep reading
                }
            }
        } catch (IOException e) {
            close(new DenisConnectionException(DenisException.CLOSED,
                    "connection to " + address + " lost: " + e.getMessage(), e));
        } catch (DenisException e) {
            close(e);
        } catch (Throwable t) {
            close(new DenisConnectionException(DenisException.CLOSED, "reader failed: " + t, t));
        }
    }

    /** Next line without its terminator ({@code \n} or {@code \r\n}); {@code null} at end of stream. */
    private String readLine() throws IOException {
        lineLen = 0;
        while (true) {
            if (bufPos == bufLen) {
                flushIfDirty();
                int n = in.read(buf);
                if (n < 0) {
                    return null;
                }
                bufPos = 0;
                bufLen = n;
            }
            int i = bufPos;
            while (i < bufLen && buf[i] != '\n') {
                i++;
            }
            if (i < bufLen) {
                String text;
                if (lineLen == 0) {
                    int end = i > bufPos && buf[i - 1] == '\r' ? i - 1 : i;
                    text = new String(buf, bufPos, end - bufPos, StandardCharsets.UTF_8);
                } else {
                    append(bufPos, i - bufPos);
                    int end = lineLen > 0 && line[lineLen - 1] == '\r' ? lineLen - 1 : lineLen;
                    text = new String(line, 0, end, StandardCharsets.UTF_8);
                    if (line.length > 1024 * 1024) {
                        line = new byte[1024];
                    }
                }
                bufPos = i + 1;
                return text;
            }
            append(bufPos, bufLen - bufPos);
            bufPos = bufLen;
        }
    }

    private void append(int from, int count) {
        if (count == 0) {
            return;
        }
        long needed = (long) lineLen + count;
        if (needed > maxReplyBytes) {
            throw Protocol.protocol("reply from " + address + " is longer than " + maxReplyBytes + " bytes");
        }
        if (needed > line.length) {
            long size = Math.max(needed, Math.min((long) line.length * 2, maxReplyBytes));
            byte[] bigger = new byte[(int) Math.min(size, Integer.MAX_VALUE - 16)];
            System.arraycopy(line, 0, bigger, 0, lineLen);
            line = bigger;
        }
        System.arraycopy(buf, from, line, lineLen, count);
        lineLen += count;
    }

    // =================================================================== timeouts and closing

    /**
     * Fail the oldest command with TIMEOUT and close the connection when it
     * has waited longer than {@code timeoutNanos} since it was sent and since
     * the previous reply arrived.
     */
    void checkTimeout(long now, long timeoutNanos) {
        Command.Pending<?> head = pending.peek();
        if (head == null || closed.get()) {
            return;
        }
        long since = Math.max(head.sentNanos, lastProgressNanos);
        if (now - since > timeoutNanos) {
            long millis = timeoutNanos / 1_000_000L;
            head.fail(new DenisTimeoutException("no reply to " + head.command.name + " from " + address + " within " + millis + " ms"));
            close(new DenisConnectionException(DenisException.CLOSED,
                    "connection to " + address + " closed after " + head.command.name + " timed out (" + millis + " ms)"));
        }
    }

    /** Futures of all commands currently in flight (for graceful shutdown). */
    List<CompletableFuture<?>> inFlightFutures() {
        List<CompletableFuture<?>> list = new ArrayList<>();
        for (Command.Pending<?> p : pending) {
            list.add(p.future);
        }
        return list;
    }

    /** Close the socket and fail every in-flight command with {@code cause} (idempotent). */
    void close(DenisException cause) {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        closeCause = cause;
        closeQuietly(socket);
        DenisException failure = cause instanceof DenisConnectionException ? cause : closedError();
        writeLock.lock();
        try {
            Command.Pending<?> p;
            while ((p = pending.poll()) != null) {
                inFlight.decrementAndGet();
                p.fail(failure);
            }
        } finally {
            writeLock.unlock();
        }
        if (listener != null) {
            listener.closed(this, cause);
        }
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
            // closing anyway
        }
    }
}
