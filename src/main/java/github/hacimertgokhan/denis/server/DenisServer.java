package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.DenisClient;
import github.hacimertgokhan.logger.DenisLogger;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The TCP front door: accepts connections, enforces the per-IP and global
 * connection limits and hands every socket to a {@link DenisClient} on the
 * worker pool. {@link #stop()} closes the listener, waits briefly for workers
 * and flushes the persisted store through the {@link ServerContext}.
 */
public class DenisServer implements AutoCloseable {
    private static final DenisLogger log = new DenisLogger(DenisServer.class);

    public record Options(String bindAddress, int port, int maxConnections, int maxConnectionsPerIp, int idleTimeoutMillis) {
        public static Options defaults(int port) {
            return new Options("0.0.0.0", port, 256, 12, 0);
        }
    }

    private final ServerContext ctx;
    private final Options options;
    private final ConcurrentHashMap<InetAddress, AtomicInteger> perIp = new ConcurrentHashMap<>();
    private final ExecutorService workers;
    private volatile ServerSocket listener;
    private volatile boolean running;

    public DenisServer(ServerContext ctx, Options options) {
        this.ctx = ctx;
        this.options = options;
        // One blocking thread per connection: the pool is the connection limit.
        // A SynchronousQueue makes the pool grow to maxConnections instead of
        // queueing sockets behind the core threads (an unbounded queue would
        // never start a 5th worker). Idle workers go away after a minute.
        ThreadPoolExecutor pool = new ThreadPoolExecutor(
                Math.min(4, options.maxConnections()), options.maxConnections(),
                60, TimeUnit.SECONDS, new SynchronousQueue<>(),
                r -> {
                    Thread t = new Thread(r, "denis-client");
                    t.setDaemon(true);
                    return t;
                });
        pool.allowCoreThreadTimeOut(true);
        this.workers = pool;
    }

    /** Bind the port; returns once the socket is listening. */
    public void start() throws IOException {
        ServerSocket socket = new ServerSocket();
        socket.setReuseAddress(true);
        socket.bind(new InetSocketAddress(options.bindAddress(), options.port()), 128);
        listener = socket;
        running = true;
        log.info(String.format("Listening on %s:%d (max %d connections, %d per IP)",
                options.bindAddress(), port(), options.maxConnections(), options.maxConnectionsPerIp()));
    }

    /** The bound port (useful when started with port 0). */
    public int port() {
        return listener == null ? options.port() : listener.getLocalPort();
    }

    /** Accept connections until {@link #stop()} is called; blocks the calling thread. */
    public void serve() {
        while (running) {
            Socket socket;
            try {
                socket = listener.accept();
            } catch (SocketException e) {
                if (running) {
                    log.error("Accept failed: " + e.getMessage());
                }
                break;
            } catch (IOException e) {
                log.error("Accept failed: " + e.getMessage());
                continue;
            }
            dispatch(socket);
        }
    }

    private void dispatch(Socket socket) {
        InetAddress address = socket.getInetAddress();
        AtomicInteger count = perIp.computeIfAbsent(address, a -> new AtomicInteger());
        if (count.incrementAndGet() > options.maxConnectionsPerIp()) {
            count.decrementAndGet();
            log.warn("Connection limit reached for IP address: " + address);
            closeQuietly(socket);
            return;
        }
        if (ctx.connectionsOpen() >= options.maxConnections()) {
            release(address, count);
            log.warn("Global connection limit reached; refusing " + address);
            closeQuietly(socket);
            return;
        }
        try {
            socket.setTcpNoDelay(true);
            socket.setKeepAlive(true);
            if (options.idleTimeoutMillis() > 0) {
                socket.setSoTimeout(options.idleTimeoutMillis());
            }
        } catch (SocketException e) {
            log.warn("Could not configure socket: " + e.getMessage());
        }
        ctx.connectionOpened();
        log.info("Client connected: " + address.getHostAddress());
        if (ctx.activityLog() != null) {
            ctx.activityLog().writeLog("Client connected: " + address.getHostAddress());
        }
        try {
            workers.execute(() -> {
                try {
                    new DenisClient(ctx).handleClient(socket);
                } finally {
                    ctx.connectionClosed();
                    release(address, count);
                    closeQuietly(socket);
                }
            });
        } catch (RejectedExecutionException e) {
            ctx.connectionClosed();
            release(address, count);
            closeQuietly(socket);
        }
    }

    private void release(InetAddress address, AtomicInteger count) {
        if (count.decrementAndGet() <= 0) {
            perIp.remove(address, count);
        }
    }

    private static void closeQuietly(Socket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
            // nothing left to do with a socket that will not close
        }
    }

    /** Stop accepting, give in-flight commands a moment, flush the store. */
    public void stop() {
        if (!running) {
            return;
        }
        running = false;
        try {
            if (listener != null) {
                listener.close();
            }
        } catch (IOException e) {
            log.warn("Could not close listener: " + e.getMessage());
        }
        workers.shutdownNow();
        try {
            workers.awaitTermination(3, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        try {
            ctx.close();
        } catch (IOException e) {
            log.error("Could not flush persisted store on shutdown: " + e.getMessage());
        }
    }

    @Override
    public void close() {
        stop();
    }
}
