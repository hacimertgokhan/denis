package github.hacimertgokhan.proto;

import database.Token;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.pointers.Any;
import org.json.JSONArray;
import org.json.JSONException;

import java.io.BufferedReader;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
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
 * The persisted half of Denis: every project's {@code SET ... -&save} keys and
 * SQL tables.
 *
 * <p>Two files, both next to each other:</p>
 * <ul>
 *   <li>{@code database.bin} — a protobuf <b>snapshot</b> of everything, written
 *       atomically (temp file + rename) every {@code snapshotIntervalMillis}
 *       while there are changes, on {@link #flush()} and on {@link #close()}.</li>
 *   <li>{@code database.journal} — an <b>append-only log</b> of every change
 *       since the last snapshot, one JSON array per line
 *       ({@code ["S",token,key,value]}, {@code ["D",token,key]},
 *       {@code ["T",token]}). Each change is handed to the operating system
 *       right away and {@code fsync}ed every {@code journalSyncMillis}, so a
 *       killed process loses nothing and a power loss loses at most that
 *       window — the same guarantee as Redis {@code appendfsync everysec}.</li>
 * </ul>
 *
 * <p>The whole data set is held in memory: reads never touch the disk. On
 * start-up the snapshot is loaded and the journal replayed. Files written by
 * versions before 0.3 (token {@code "<token>:"}, keys {@code "<token>:<key>"})
 * are normalised on load.</p>
 */
public class ProtoDatabase implements AutoCloseable {
    private static final DenisLogger log = new DenisLogger(ProtoDatabase.class);
    public static final long DEFAULT_FLUSH_INTERVAL_MILLIS = 1_000;
    public static final long DEFAULT_SNAPSHOT_INTERVAL_MILLIS = 30_000;
    public static final String JOURNAL_SUFFIX = ".journal";

    private final Path path;
    private final Path journalPath;
    private final Path oldJournalPath;
    private final long snapshotIntervalMillis;
    private final boolean synchronous;
    private final ConcurrentHashMap<String, ConcurrentHashMap<String, String>> tokens = new ConcurrentHashMap<>();
    private final AtomicBoolean dirty = new AtomicBoolean(false);
    private final AtomicLong flushes = new AtomicLong();
    private final AtomicLong journaled = new AtomicLong();
    private final Object journalLock = new Object();
    private final Object snapshotLock = new Object();
    private final ScheduledExecutorService flusher;
    private FileOutputStream journal;
    private OutputStream journalOut;
    private volatile boolean journalDirty;
    private volatile long lastSnapshotAt = System.currentTimeMillis();

    /** Open (or create) the database, journal fsync and snapshot once per second. */
    public ProtoDatabase(String filePath) throws IOException {
        this(Paths.get(filePath), DEFAULT_FLUSH_INTERVAL_MILLIS);
    }

    /**
     * Journal fsync and snapshot both every {@code flushIntervalMillis};
     * {@code 0} means synchronous: every change is journaled and fsynced at
     * once and the snapshot is written on {@link #close()} / {@link #flush()}.
     */
    public ProtoDatabase(Path path, long flushIntervalMillis) throws IOException {
        this(path, flushIntervalMillis, flushIntervalMillis);
    }

    /**
     * @param journalSyncMillis      how often the journal is fsynced ({@code 0}: on every change)
     * @param snapshotIntervalMillis how often a full snapshot replaces the journal while dirty
     */
    public ProtoDatabase(Path path, long journalSyncMillis, long snapshotIntervalMillis) throws IOException {
        this.path = path;
        this.journalPath = sibling(path, JOURNAL_SUFFIX);
        this.oldJournalPath = sibling(path, JOURNAL_SUFFIX + ".old");
        this.synchronous = journalSyncMillis <= 0;
        this.snapshotIntervalMillis = Math.max(snapshotIntervalMillis, 0);
        load();
        openJournal();
        if (!synchronous) {
            flusher = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "denis-flush");
                t.setDaemon(true);
                return t;
            });
            flusher.scheduleWithFixedDelay(this::tick, journalSyncMillis, journalSyncMillis, TimeUnit.MILLISECONDS);
        } else {
            flusher = null;
        }
    }

    private static Path sibling(Path path, String suffix) {
        Path parent = path.toAbsolutePath().getParent();
        String name = path.getFileName() + suffix;
        return parent == null ? Paths.get(name) : parent.resolve(name);
    }

    public Path getPath() {
        return path;
    }

    public Path getJournalPath() {
        return journalPath;
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

    /** True while changes exist that are not yet in the snapshot (they are in the journal). */
    public boolean isDirty() {
        return dirty.get();
    }

    public long getFlushCount() {
        return flushes.get();
    }

    public long getJournaledCount() {
        return journaled.get();
    }

    // ----------------------------------------------------------------- writes

    public void setData(String token, String key, Any value) {
        setData(token, key, String.valueOf(value.getValue()));
    }

    public void setData(String token, String key, String value) {
        String t = normalizeToken(token);
        tokens.computeIfAbsent(t, x -> new ConcurrentHashMap<>()).put(key, value);
        journal(new JSONArray().put("S").put(t).put(key).put(value));
    }

    /** @return true when the key existed */
    public boolean deleteData(String token, String key) {
        String t = normalizeToken(token);
        Map<String, String> data = tokens.get(t);
        if (data == null || data.remove(key) == null) {
            return false;
        }
        journal(new JSONArray().put("D").put(t).put(key));
        return true;
    }

    /** Drop every persisted key of a project. */
    public boolean deleteToken(String token) {
        String t = normalizeToken(token);
        if (tokens.remove(t) == null) {
            return false;
        }
        journal(new JSONArray().put("T").put(t));
        return true;
    }

    // ---------------------------------------------------------------- journal

    private void openJournal() throws IOException {
        Path parent = journalPath.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        journal = new FileOutputStream(journalPath.toFile(), true);
        journalOut = new java.io.BufferedOutputStream(journal, 64 * 1024);
    }

    private void journal(JSONArray entry) {
        byte[] line = (entry.toString() + "\n").getBytes(StandardCharsets.UTF_8);
        dirty.set(true);
        synchronized (journalLock) {
            try {
                journalOut.write(line);
                journalOut.flush(); // to the kernel: survives a process kill
                journalDirty = true;
                journaled.incrementAndGet();
                if (synchronous) {
                    journal.getFD().sync();
                    journalDirty = false;
                }
            } catch (IOException e) {
                log.error("Could not append to " + journalPath + ": " + e.getMessage());
            }
        }
    }

    /** fsync the journal; the flusher does this every journal interval. */
    public void syncJournal() throws IOException {
        synchronized (journalLock) {
            if (journalDirty) {
                journalOut.flush();
                journal.getFD().sync();
                journalDirty = false;
            }
        }
    }

    private void tick() {
        try {
            syncJournal();
            if (dirty.get() && snapshotIntervalMillis >= 0
                    && System.currentTimeMillis() - lastSnapshotAt >= snapshotIntervalMillis) {
                flush();
            }
        } catch (IOException e) {
            log.error("Could not persist " + path + ": " + e.getMessage());
        }
    }

    private int replay(Path file) throws IOException {
        if (!Files.exists(file)) {
            return 0;
        }
        int applied = 0;
        try (BufferedReader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            String line;
            while ((line = in.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
                JSONArray entry;
                try {
                    entry = new JSONArray(line);
                } catch (JSONException e) {
                    log.warn("Ignoring a truncated journal line in " + file);
                    break;
                }
                String token = entry.getString(1);
                switch (entry.getString(0)) {
                    case "S" -> tokens.computeIfAbsent(token, t -> new ConcurrentHashMap<>()).put(entry.getString(2), entry.getString(3));
                    case "D" -> {
                        Map<String, String> data = tokens.get(token);
                        if (data != null) {
                            data.remove(entry.getString(2));
                        }
                    }
                    case "T" -> tokens.remove(token);
                    default -> log.warn("Unknown journal entry: " + entry.getString(0));
                }
                applied++;
            }
        }
        return applied;
    }

    // ------------------------------------------------------------------- disk

    private void load() throws IOException {
        boolean migrated = false;
        if (Files.exists(path)) {
            Token.Database database;
            try (InputStream in = Files.newInputStream(path)) {
                database = Token.Database.parseFrom(in);
            }
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
        }
        // .old exists only when a snapshot was interrupted; its entries are older than the journal's
        int replayed = replay(oldJournalPath) + replay(journalPath);
        if (replayed > 0) {
            log.info(String.format("Replayed %d journal entries into %s", replayed, path));
            dirty.set(true);
        }
        if (migrated) {
            log.info("database.bin uses the pre-0.3 key layout; it will be rewritten on the next snapshot.");
            dirty.set(true);
        }
    }

    /**
     * Write a full snapshot now and start a fresh journal. Safe at any time:
     * the journal is rotated under the write lock, so no change can fall
     * between the snapshot and the new journal, and the old journal is only
     * deleted after the snapshot is in place (replaying it is harmless).
     */
    public void flush() throws IOException {
        synchronized (snapshotLock) {
            Token.Database.Builder database = Token.Database.newBuilder();
            synchronized (journalLock) {
                dirty.set(false);
                for (Map.Entry<String, ConcurrentHashMap<String, String>> entry : tokens.entrySet()) {
                    if (!entry.getValue().isEmpty()) {
                        database.addTokens(Token.TokenData.newBuilder()
                                .setToken(entry.getKey())
                                .putAllKeyValues(entry.getValue()));
                    }
                }
                journalOut.flush();
                journal.close();
                Files.deleteIfExists(oldJournalPath);
                Files.move(journalPath, oldJournalPath, StandardCopyOption.REPLACE_EXISTING);
                openJournal();
                journalDirty = false;
            }
            Path parent = path.toAbsolutePath().getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Path tmp = sibling(path, ".tmp");
            try (OutputStream out = Files.newOutputStream(tmp)) {
                database.build().writeTo(out);
            }
            try {
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
            }
            Files.deleteIfExists(oldJournalPath);
            lastSnapshotAt = System.currentTimeMillis();
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
        } else {
            syncJournal();
        }
        synchronized (journalLock) {
            journalOut.flush();
            journal.close();
        }
    }

    /** Test hook: drop the file handles without a snapshot, as a killed process would. */
    void abandon() throws IOException {
        if (flusher != null) {
            flusher.shutdownNow();
        }
        synchronized (journalLock) {
            journalOut.flush();
            journal.close();
        }
    }

    /** Old files stored the project as {@code "<token>:"}; the trailing colon is not part of it. */
    private static String normalizeToken(String token) {
        return token.endsWith(":") ? token.substring(0, token.length() - 1) : token;
    }
}
