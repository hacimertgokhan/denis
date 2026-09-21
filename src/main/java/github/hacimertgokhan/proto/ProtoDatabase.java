package github.hacimertgokhan.proto;

import database.Token;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.pointers.Any;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * The persisted half of Denis: every project's {@code SET ... -&save} keys,
 * stored in one protobuf file ({@code database.bin}).
 *
 * <p>The whole file is held in memory, so reads never touch the disk and writes
 * only mark the store dirty. A daemon thread flushes dirty state every
 * {@code flushIntervalMillis} (and {@link #close()} / {@link #flush()} force it),
 * writing to a temporary file that is then atomically moved over the real one —
 * a crash mid-write cannot leave a truncated database behind. Before 0.3.0
 * every {@code GET} parsed the file and every {@code SET -&save} rewrote it,
 * with no locking between connections.</p>
 *
 * <p>On disk the layout is {@code token -> (key -> value)} with bare keys.
 * Files written by older versions used {@code "<token>:"} as the token and the
 * prefixed {@code "<token>:<key>"} as the key; both are normalised on load and
 * written back in the new layout on the next flush.</p>
 */
public class ProtoDatabase implements AutoCloseable {
    private static final DenisLogger log = new DenisLogger(ProtoDatabase.class);
    public static final long DEFAULT_FLUSH_INTERVAL_MILLIS = 1_000;

    private final Path path;
    private final ConcurrentHashMap<String, ConcurrentHashMap<String, String>> tokens = new ConcurrentHashMap<>();
    private final AtomicBoolean dirty = new AtomicBoolean(false);
    private final AtomicLong flushes = new AtomicLong();
    private final Object flushLock = new Object();
    private final ScheduledExecutorService flusher;

    /** Open (or create) the database file and flush dirty state once per second. */
    public ProtoDatabase(String filePath) throws IOException {
        this(Paths.get(filePath), DEFAULT_FLUSH_INTERVAL_MILLIS);
    }

    /**
     * @param flushIntervalMillis how often dirty state is written; {@code 0} means
     *                            synchronous writes (every change is flushed at once)
     */
    public ProtoDatabase(Path path, long flushIntervalMillis) throws IOException {
        this.path = path;
        load();
        if (flushIntervalMillis > 0) {
            flusher = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "denis-flush");
                t.setDaemon(true);
                return t;
            });
            flusher.scheduleWithFixedDelay(this::flushIfDirty, flushIntervalMillis, flushIntervalMillis, TimeUnit.MILLISECONDS);
        } else {
            flusher = null;
        }
    }

    public Path getPath() {
        return path;
    }

    // ------------------------------------------------------------------ reads

    public String getData(String token, String key) {
        Map<String, String> data = tokens.get(normalizeToken(token));
        return data == null ? null : data.get(key);
    }

    public boolean exists(String token, String key) {
        Map<String, String> data = tokens.get(normalizeToken(token));
        return data != null && data.containsKey(key);
    }

    /** Snapshot of a project's persisted keys; empty when the project has none. */
    public Map<String, String> findToken(String token) {
        Map<String, String> data = tokens.get(normalizeToken(token));
        return data == null ? Collections.emptyMap() : new HashMap<>(data);
    }

    public int tokenCount() {
        return tokens.size();
    }

    public long keyCount() {
        long n = 0;
        for (Map<String, String> data : tokens.values()) {
            n += data.size();
        }
        return n;
    }

    public long keyCount(String token) {
        Map<String, String> data = tokens.get(normalizeToken(token));
        return data == null ? 0 : data.size();
    }

    public boolean isDirty() {
        return dirty.get();
    }

    public long getFlushCount() {
        return flushes.get();
    }

    // ----------------------------------------------------------------- writes

    public void setData(String token, String key, Any value) {
        setData(token, key, String.valueOf(value.getValue()));
    }

    public void setData(String token, String key, String value) {
        tokens.computeIfAbsent(normalizeToken(token), t -> new ConcurrentHashMap<>()).put(key, value);
        markDirty();
    }

    /** @return true when the key existed */
    public boolean deleteData(String token, String key) {
        Map<String, String> data = tokens.get(normalizeToken(token));
        if (data == null || data.remove(key) == null) {
            return false;
        }
        markDirty();
        return true;
    }

    /** Drop every persisted key of a project. */
    public boolean deleteToken(String token) {
        if (tokens.remove(normalizeToken(token)) == null) {
            return false;
        }
        markDirty();
        return true;
    }

    private void markDirty() {
        dirty.set(true);
        if (flusher == null) {
            flushIfDirty();
        }
    }

    // ------------------------------------------------------------------- disk

    private void load() throws IOException {
        if (!Files.exists(path)) {
            return;
        }
        Token.Database database;
        try (InputStream in = Files.newInputStream(path)) {
            database = Token.Database.parseFrom(in);
        }
        boolean migrated = false;
        for (Token.TokenData tokenData : database.getTokensList()) {
            String token = normalizeToken(tokenData.getToken());
            migrated |= !token.equals(tokenData.getToken());
            ConcurrentHashMap<String, String> data = tokens.computeIfAbsent(token, t -> new ConcurrentHashMap<>());
            String prefix = token + ":";
            for (Map.Entry<String, String> entry : tokenData.getKeyValuesMap().entrySet()) {
                String key = entry.getKey();
                if (key.startsWith(prefix)) {
                    key = key.substring(prefix.length());
                    migrated = true;
                }
                data.put(key, entry.getValue());
            }
        }
        if (migrated) {
            log.info("database.bin uses the pre-0.3 key layout; it will be rewritten on the next flush.");
            dirty.set(true);
        }
    }

    private void flushIfDirty() {
        if (!dirty.get()) {
            return;
        }
        try {
            flush();
        } catch (IOException e) {
            log.error("Could not flush " + path + ": " + e.getMessage());
        }
    }

    /** Write the current state to disk now, whether or not anything changed. */
    public void flush() throws IOException {
        synchronized (flushLock) {
            dirty.set(false);
            Token.Database.Builder database = Token.Database.newBuilder();
            for (Map.Entry<String, ConcurrentHashMap<String, String>> entry : tokens.entrySet()) {
                if (entry.getValue().isEmpty()) {
                    continue;
                }
                database.addTokens(Token.TokenData.newBuilder()
                        .setToken(entry.getKey())
                        .putAllKeyValues(entry.getValue()));
            }
            Path parent = path.toAbsolutePath().getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Path tmp = parent == null ? Paths.get(path.getFileName() + ".tmp") : parent.resolve(path.getFileName() + ".tmp");
            try (OutputStream out = Files.newOutputStream(tmp)) {
                database.build().writeTo(out);
            }
            try {
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
            }
            flushes.incrementAndGet();
        }
    }

    @Override
    public void close() throws IOException {
        if (flusher != null) {
            flusher.shutdownNow();
        }
        if (dirty.get()) {
            flush();
        }
    }

    /** Old files stored the project as {@code "<token>:"}; the trailing colon is not part of it. */
    private static String normalizeToken(String token) {
        return token.endsWith(":") ? token.substring(0, token.length() - 1) : token;
    }
}
