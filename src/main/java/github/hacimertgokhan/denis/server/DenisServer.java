package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.logger.DenisLogger;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.StandardSocketOptions;
import java.nio.ByteBuffer;
import java.nio.channels.ClosedChannelException;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Non-blocking TCP server.
 *
 * <p>One acceptor thread hands connections round-robin to a few event loops
 * (by default one per core, at most four). An event loop reads whatever a
 * client sent, executes every complete command line in it, and writes all
 * replies with one system call — so pipelined clients pay one syscall per
 * batch, not per command — and a thousand idle connections cost a thousand
 * small buffers, not a thousand threads.
 *
 * <p>Back-pressure: a client that does not read its replies stops being read
 * once its pending output passes {@code client-output-limit}, and a line
 * longer than {@code max-line-size} closes the connection instead of growing
 * a buffer without bound. Connections are limited globally
 * ({@code max-clients}) and per address ({@code max-connections-per-ip}).
 */
public final class DenisServer implements AutoCloseable {
    private static final DenisLogger log = new DenisLogger(DenisServer.class);
    private static final int INITIAL_BUFFER = 4096;

    private final ServerConfig config;
    private final ServerContext context;
    private final Map<InetAddress, AtomicInteger> perAddress = new ConcurrentHashMap<>();
    private ServerSocketChannel serverChannel;
    private EventLoop[] loops;
    private Thread acceptor;
    private volatile boolean running;
    private int nextLoop;

    public DenisServer(ServerConfig config, ServerContext context) {
        this.config = config;
        this.context = context;
    }

    public void start() throws IOException {
        serverChannel = ServerSocketChannel.open();
        serverChannel.setOption(StandardSocketOptions.SO_REUSEADDR, true);
        serverChannel.bind(new InetSocketAddress(InetAddress.getByName(config.bindAddress()), config.port()), 1024);
        loops = new EventLoop[config.ioThreads()];
        for (int i = 0; i < loops.length; i++) {
            loops[i] = new EventLoop(i);
            loops[i].start();
        }
        running = true;
        acceptor = new Thread(this::acceptLoop, "denis-acceptor");
        acceptor.start();
    }

    /** The bound port (useful with port 0 in tests). */
    public int port() {
        return ((InetSocketAddress) serverChannel.socket().getLocalSocketAddress()).getPort();
    }

    public String address() {
        return config.bindAddress() + ":" + port();
    }

    private void acceptLoop() {
        while (running) {
            SocketChannel channel;
            try {
                channel = serverChannel.accept();
            } catch (ClosedChannelException e) {
                break;
            } catch (IOException e) {
                if (running) {
                    log.warn("Accept failed: " + e.getMessage());
                    pause();
                }
                continue;
            }
            try {
                admit(channel);
            } catch (IOException | RuntimeException e) {
                log.warn("Could not set up connection: " + e.getMessage());
                closeQuietly(channel);
            }
        }
    }

    private void admit(SocketChannel channel) throws IOException {
        InetAddress address = ((InetSocketAddress) channel.getRemoteAddress()).getAddress();
        ServerMetrics metrics = context.metrics();
        String refusal = null;
        AtomicInteger count = perAddress.computeIfAbsent(address, a -> new AtomicInteger());
        if (metrics.connected.get() >= config.maxClients()) {
            refusal = "max number of clients reached";
        } else if (count.incrementAndGet() > config.maxConnectionsPerIp()) {
            count.decrementAndGet();
            refusal = "too many connections from " + address.getHostAddress();
        }
        if (refusal != null) {
            metrics.rejected.increment();
            log.warn("Connection refused: " + refusal);
            // best effort: tell the client why, in both reply formats' spirit
            channel.configureBlocking(true);
            channel.write(ByteBuffer.wrap(("{\"ok\":false,\"error\":\"" + refusal + "\",\"code\":\"LIMIT\"}\n").getBytes(StandardCharsets.UTF_8)));
            closeQuietly(channel);
            return;
        }
        metrics.connected.incrementAndGet();
        metrics.accepted.increment();
        channel.configureBlocking(false);
        channel.setOption(StandardSocketOptions.TCP_NODELAY, true);
        channel.setOption(StandardSocketOptions.SO_KEEPALIVE, true);
        EventLoop loop = loops[nextLoop++ % loops.length];
        loop.register(channel, address);
    }

    private void released(InetAddress address) {
        context.metrics().connected.decrementAndGet();
        AtomicInteger count = perAddress.get(address);
        if (count != null && count.decrementAndGet() <= 0) {
            perAddress.remove(address, count);
        }
    }

    private static void pause() {
        try {
            Thread.sleep(50);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void closeQuietly(SocketChannel channel) {
        try {
            channel.close();
        } catch (IOException ignored) {
            // already gone
        }
    }

    @Override
    public void close() {
        running = false;
        try {
            if (serverChannel != null) {
                serverChannel.close();
            }
        } catch (IOException ignored) {
            // shutting down
        }
        if (acceptor != null) {
            try {
                acceptor.join(2000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        if (loops != null) {
            for (EventLoop loop : loops) {
                loop.shutdown();
            }
            for (EventLoop loop : loops) {
                try {
                    loop.join(5000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    // =================================================================== event loop

    private final class EventLoop extends Thread {
        private final Selector selector;
        private final ConcurrentLinkedQueue<Runnable> tasks = new ConcurrentLinkedQueue<>();
        private final Set<Connection> connections = new HashSet<>();
        private volatile boolean active = true;
        private long lastHousekeeping = System.nanoTime();

        EventLoop(int index) throws IOException {
            super("denis-io-" + index);
            setDaemon(true);
            selector = Selector.open();
        }

        void register(SocketChannel channel, InetAddress address) {
            execute(() -> {
                try {
                    Connection connection = new Connection(this, channel, address);
                    connection.key = channel.register(selector, SelectionKey.OP_READ, connection);
                    connections.add(connection);
                } catch (IOException e) {
                    closeQuietly(channel);
                    released(address);
                }
            });
        }

        void execute(Runnable task) {
            tasks.add(task);
            selector.wakeup();
        }

        void shutdown() {
            active = false;
            selector.wakeup();
        }

        @Override
        public void run() {
            while (active) {
                try {
                    selector.select(1000);
                    Runnable task;
                    while ((task = tasks.poll()) != null) {
                        task.run();
                    }
                    for (SelectionKey key : selector.selectedKeys()) {
                        Connection connection = (Connection) key.attachment();
                        if (connection == null || !key.isValid()) {
                            continue;
                        }
                        try {
                            if (key.isWritable()) {
                                connection.onWritable();
                            }
                            if (key.isValid() && key.isReadable()) {
                                connection.onReadable();
                            }
                        } catch (IOException | RuntimeException e) {
                            connection.close();
                        }
                    }
                    selector.selectedKeys().clear();
                    housekeeping();
                } catch (IOException | RuntimeException e) {
                    log.error("Event loop error: " + e.getMessage(), e);
                }
            }
            for (Connection connection : new ArrayList<>(connections)) {
                connection.close();
            }
            try {
                selector.close();
            } catch (IOException ignored) {
                // shutting down
            }
        }

        private void housekeeping() {
            long now = System.nanoTime();
            if (now - lastHousekeeping < 1_000_000_000L) {
                return;
            }
            lastHousekeeping = now;
            if (getName().endsWith("-0")) {
                context.metrics().sample();
            }
            if (config.clientTimeoutSeconds() > 0) {
                long limit = config.clientTimeoutSeconds() * 1_000_000_000L;
                List<Connection> idle = new ArrayList<>();
                for (Connection c : connections) {
                    if (!c.waiting && now - c.lastActivity > limit) {
                        idle.add(c);
                    }
                }
                idle.forEach(Connection::close);
            }
        }
    }

    // =================================================================== connection

    private final class Connection {
        private final EventLoop loop;
        private final SocketChannel channel;
        private final InetAddress address;
        private final Session session;
        private SelectionKey key;
        private ByteBuffer in = ByteBuffer.allocate(INITIAL_BUFFER);
        private ByteBuffer out = ByteBuffer.allocate(INITIAL_BUFFER);
        /** Start of the unprocessed input in {@code in} (bytes before it are consumed). */
        private int readIndex;
        /** Where to continue searching for the next newline. */
        private int scanIndex;
        private boolean waiting;
        private boolean closeAfterFlush;
        private boolean closed;
        private long lastActivity = System.nanoTime();

        Connection(EventLoop loop, SocketChannel channel, InetAddress address) {
            this.loop = loop;
            this.channel = channel;
            this.address = address;
            this.session = new Session(context, address.getHostAddress());
        }

        void onReadable() throws IOException {
            if (!in.hasRemaining()) {
                growInput();
            }
            int n = channel.read(in);
            if (n < 0) {
                close();
                return;
            }
            if (n == 0) {
                return;
            }
            lastActivity = System.nanoTime();
            context.metrics().bytesIn.add(n);
            process();
        }

        /** Execute every complete line that is buffered, then flush the replies. */
        private void process() throws IOException {
            byte[] buf = in.array();
            while (!waiting && !closeAfterFlush) {
                int end = in.position();
                int newline = -1;
                for (int i = scanIndex; i < end; i++) {
                    if (buf[i] == '\n') {
                        newline = i;
                        break;
                    }
                }
                if (newline < 0) {
                    scanIndex = end;
                    if (end - readIndex > config.maxLineBytes()) {
                        append("{\"ok\":false,\"error\":\"line longer than max-line-size (" + config.maxLineBytes() + " bytes)\",\"code\":\"LIMIT\"}");
                        closeAfterFlush = true;
                    }
                    break;
                }
                int lineEnd = newline > readIndex && buf[newline - 1] == '\r' ? newline - 1 : newline;
                String line = new String(buf, readIndex, lineEnd - readIndex, StandardCharsets.UTF_8);
                readIndex = newline + 1;
                scanIndex = readIndex;
                apply(session.handle(line));
                if (out.position() > config.outputBufferLimit()) {
                    break;
                }
            }
            compactInput();
            flush();
        }

        private void apply(Reply reply) {
            if (reply.deferred() != null) {
                waiting = true;
                updateInterest();
                reply.deferred().whenComplete((line, error) -> loop.execute(() -> {
                    if (closed) {
                        return;
                    }
                    append(error == null ? line : "{\"ok\":false,\"error\":\"internal error\",\"code\":\"INTERNAL\"}");
                    waiting = false;
                    try {
                        process();
                    } catch (IOException | RuntimeException e) {
                        close();
                    }
                }));
                return;
            }
            if (reply.line() != null) {
                append(reply.line());
            }
            if (reply.close()) {
                closeAfterFlush = true;
            }
        }

        private void append(String line) {
            byte[] bytes = line.getBytes(StandardCharsets.UTF_8);
            ensureOutput(bytes.length + 1);
            out.put(bytes);
            out.put((byte) '\n');
        }

        private void ensureOutput(int extra) {
            if (out.remaining() >= extra) {
                return;
            }
            int capacity = out.capacity();
            while (capacity - out.position() < extra) {
                capacity <<= 1;
            }
            ByteBuffer bigger = ByteBuffer.allocate(capacity);
            out.flip();
            bigger.put(out);
            out = bigger;
        }

        private void growInput() {
            int capacity = Math.min(in.capacity() << 1, config.maxLineBytes() + INITIAL_BUFFER);
            if (capacity <= in.capacity()) {
                capacity = in.capacity() + INITIAL_BUFFER;
            }
            ByteBuffer bigger = ByteBuffer.allocate(capacity);
            in.flip();
            bigger.put(in);
            in = bigger;
        }

        /** Drop consumed input; shrink a buffer that grew for one large line. */
        private void compactInput() {
            if (readIndex == 0) {
                return;
            }
            int remaining = in.position() - readIndex;
            if (remaining == 0 && in.capacity() > 64 * 1024) {
                in = ByteBuffer.allocate(INITIAL_BUFFER);
            } else {
                System.arraycopy(in.array(), readIndex, in.array(), 0, remaining);
                in.position(remaining);
            }
            scanIndex -= readIndex;
            readIndex = 0;
        }

        void onWritable() throws IOException {
            flush();
            if (!waiting && !closed && in.position() > readIndex) {
                process();
            }
        }

        private void flush() throws IOException {
            if (closed) {
                return;
            }
            if (out.position() > 0) {
                out.flip();
                int written = channel.write(out);
                context.metrics().bytesOut.add(written);
                out.compact();
                if (out.position() == 0 && out.capacity() > 64 * 1024) {
                    out = ByteBuffer.allocate(INITIAL_BUFFER);
                }
            }
            if (closeAfterFlush && out.position() == 0) {
                close();
                return;
            }
            updateInterest();
        }

        private void updateInterest() {
            if (closed || key == null || !key.isValid()) {
                return;
            }
            int ops = 0;
            if (out.position() > 0) {
                ops |= SelectionKey.OP_WRITE;
            }
            // stop reading while a slow command runs or the client is not reading its replies
            if (!waiting && !closeAfterFlush && out.position() <= config.outputBufferLimit()) {
                ops |= SelectionKey.OP_READ;
            }
            if (key.interestOps() != ops) {
                key.interestOps(ops);
            }
        }

        void close() {
            if (closed) {
                return;
            }
            closed = true;
            loop.connections.remove(this);
            if (key != null) {
                key.cancel();
            }
            closeQuietly(channel);
            released(address);
        }
    }
}
