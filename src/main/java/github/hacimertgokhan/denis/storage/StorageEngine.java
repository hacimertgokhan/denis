package github.hacimertgokhan.denis.storage;

import github.hacimertgokhan.denis.storage.codec.Mutation;
import github.hacimertgokhan.denis.storage.codec.MutationCodec;
import github.hacimertgokhan.denis.storage.snapshot.LegacyProtobufReader;
import github.hacimertgokhan.denis.storage.snapshot.SnapshotFile;
import github.hacimertgokhan.denis.storage.table.Index;
import github.hacimertgokhan.denis.storage.table.Table;
import github.hacimertgokhan.denis.storage.table.TableSchema;
import github.hacimertgokhan.denis.storage.wal.FsyncPolicy;
import github.hacimertgokhan.denis.storage.wal.WalReplayer;
import github.hacimertgokhan.denis.storage.wal.WriteAheadLog;
import github.hacimertgokhan.logger.DenisLogger;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.Consumer;
import java.util.function.LongConsumer;

/**
 * The database: keyspaces in memory, made durable by a write-ahead log and
 * periodic snapshots.
 *
 * <h2>Write path</h2>
 * A durable write encodes its log record on the calling thread, then — inside
 * {@code ConcurrentHashMap.compute} for the key, which serialises writers of
 * the same key — queues the record and installs the new slot. Writers of
 * different keys never share a lock; the only shared step is the log queue,
 * drained in batches by one writer thread (group commit).
 *
 * <h2>Checkpoints</h2>
 * A checkpoint rotates the log to segment N, writes every keyspace to a new
 * snapshot while writes continue, and deletes segments older than N. Because
 * mutations are idempotent, whatever the snapshot sees of writes that happen
 * during it is corrected by replaying segment N onwards. The one hazard is a
 * write whose record went into segment N-1 but whose new value was not yet
 * published when the snapshot read the key; an epoch counter (two
 * {@link LongAdder}s, no lock) lets the checkpoint wait for exactly those
 * in-flight writes.
 *
 * <h2>Recovery</h2>
 * Load {@code snapshot.dat}, replay the log from the snapshot's start segment,
 * cut a torn tail off the newest segment. A {@code database.bin} from Denis
 * 0.0.x is imported once and renamed.
 */
public final class StorageEngine implements AutoCloseable {
    private static final DenisLogger log = new DenisLogger(StorageEngine.class);
    private static final CompletableFuture<Void> DONE = CompletableFuture.completedFuture(null);
    /** Keys with this prefix are reserved (the 0.0.x SQL engine stored its tables under it). */
    public static final String RESERVED_PREFIX = "__sql:";

    private final StorageConfig config;
    private final ConcurrentHashMap<String, Keyspace> byName = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Integer, Keyspace> byId = new ConcurrentHashMap<>();
    private final AtomicInteger nextKeyspaceId = new AtomicInteger(1);
    private final LongAdder memory = new LongAdder();
    private final LongConsumer memoryTracker = memory::add;
    private WriteAheadLog wal;

    // epoch guard for fuzzy checkpoints
    private volatile int epoch;
    private final LongAdder[] inFlight = {new LongAdder(), new LongAdder()};

    private final Object checkpointLock = new Object();
    private final long startNanos = System.nanoTime();
    private volatile int lruClock;
    private ScheduledExecutorService maintenance;
    private volatile boolean closed;

    // statistics
    private final LongAdder hits = new LongAdder();
    private final LongAdder misses = new LongAdder();
    private final LongAdder evictions = new LongAdder();
    private final LongAdder expirations = new LongAdder();
    private final AtomicLong durableSinceCheckpoint = new AtomicLong();
    private final AtomicLong checkpoints = new AtomicLong();
    private volatile long lastCheckpointAt;
    private volatile long lastCheckpointMillis;
    private volatile long lastSnapshotBytes;
    private volatile String lastCheckpointError;
    private volatile RecoveryInfo recovery = new RecoveryInfo(0, 0, 0, 0, 0, false, 0);

    /** What {@link #open()} found on disk. */
    public record RecoveryInfo(long snapshotRecords, int walSegments, long walRecords, long truncatedBytes,
                               long millis, boolean migratedLegacy, long legacyKeys) {}

    /** Result of a checkpoint. */
    public record CheckpointInfo(Path snapshot, long bytes, long records, long walStartSegment, long millis) {}

    /** Result of a delete: whether anything existed, and when it is durable. */
    public record DeleteResult(boolean existed, CompletableFuture<Void> durable) {}

    /** Result of INCR. */
    public record IncrResult(long value, CompletableFuture<Void> durable) {}

    /** Which layers a key listing looks at. */
    public enum Layer { ANY, CACHE, PERSISTENT }

    public StorageEngine(StorageConfig config) {
        this.config = config;
    }

    // ------------------------------------------------------------------ lifecycle

    /** Recover from disk (when persistence is on) and start background maintenance. */
    public StorageEngine open() throws IOException {
        long started = System.nanoTime();
        long snapshotRecords = 0;
        WalReplayer.Result replay = new WalReplayer.Result(0, 0, 0, 0, 0);
        boolean migrated = false;
        long legacyKeys = 0;
        if (config.persistence()) {
            Files.createDirectories(config.dataDir());
            Files.createDirectories(config.walDir());
            long walStart = 0;
            Path snapshot = config.snapshotFile();
            Files.deleteIfExists(snapshot.resolveSibling(snapshot.getFileName() + ".tmp"));
            if (Files.exists(snapshot)) {
                SnapshotFile.Info info = SnapshotFile.read(snapshot, this::apply);
                walStart = info.walStart();
                snapshotRecords = info.records();
                lastCheckpointAt = info.createdAtMillis();
                lastSnapshotBytes = info.fileBytes();
            }
            replay = WalReplayer.replay(config.walDir(), walStart, config.lenientRecovery(), this::apply);

            Path legacy = config.legacyDatabaseFile();
            if (legacy != null && Files.exists(legacy) && !Files.exists(snapshot) && replay.records() == 0) {
                legacyKeys = importLegacy(legacy);
                migrated = true;
            }
            wal = new WriteAheadLog(config.walDir(), config.fsync(), config.walSegmentBytes(), config.walQueueCapacity());
            if (migrated) {
                checkpoint();
                Path renamed = legacy.resolveSibling(legacy.getFileName() + ".migrated");
                Files.move(legacy, renamed, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                log.info(String.format("Imported %d keys from %s (renamed to %s)", legacyKeys, legacy, renamed.getFileName()));
            }
        }
        long millis = (System.nanoTime() - started) / 1_000_000;
        recovery = new RecoveryInfo(snapshotRecords, replay.segments(), replay.records(), replay.truncatedBytes(), millis,
                migrated, legacyKeys);
        startMaintenance();
        return this;
    }

    private long importLegacy(Path legacy) throws IOException {
        Map<String, Map<String, String>> data = LegacyProtobufReader.read(legacy);
        long count = 0;
        for (Map.Entry<String, Map<String, String>> project : data.entrySet()) {
            Keyspace ks = keyspace(project.getKey());
            for (Map.Entry<String, String> entry : project.getValue().entrySet()) {
                apply(new Mutation.Put(ks.id(), entry.getKey(), entry.getValue()));
                count++;
            }
        }
        return count;
    }

    private void startMaintenance() {
        maintenance = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "denis-maintenance");
            t.setDaemon(true);
            t.setPriority(Thread.NORM_PRIORITY - 1);
            return t;
        });
        maintenance.scheduleWithFixedDelay(this::tick, 100, 100, TimeUnit.MILLISECONDS);
        if (config.persistence()) {
            maintenance.scheduleWithFixedDelay(this::maybeCheckpoint, 1, 1, TimeUnit.SECONDS);
        }
    }

    private void tick() {
        try {
            lruClock = (int) ((System.nanoTime() - startNanos) / 1_000_000_000L);
            sweepExpired();
        } catch (Throwable t) {
            log.error("Maintenance error: " + t.getMessage(), t);
        }
    }

    private void maybeCheckpoint() {
        if (closed) {
            return;
        }
        try {
            if (!wal.isHealthy()) {
                if (wal.recover()) {
                    log.info("Storage recovered; taking a checkpoint to cover writes made while the log was down");
                    checkpoint();
                }
                return;
            }
            if (durableSinceCheckpoint.get() == 0) {
                return;
            }
            boolean bySize = config.checkpointWalBytes() > 0 && wal.totalBytes() >= config.checkpointWalBytes();
            boolean byTime = config.checkpointIntervalMillis() > 0
                    && System.currentTimeMillis() - lastCheckpointAt >= config.checkpointIntervalMillis();
            if (bySize || byTime) {
                checkpoint();
            }
        } catch (Throwable t) {
            lastCheckpointError = t.getMessage();
            log.error("Checkpoint failed: " + t.getMessage());
        }
    }

    @Override
    public void close() {
        if (closed) {
            return;
        }
        closed = true;
        if (maintenance != null) {
            maintenance.shutdownNow();
        }
        if (config.persistence() && wal != null) {
            try {
                if (wal.isHealthy() && durableSinceCheckpoint.get() > 0) {
                    checkpoint();
                }
            } catch (IOException | RuntimeException e) {
                log.error("Final checkpoint failed; the log will be replayed on next start: " + e.getMessage());
            }
            wal.close();
        }
    }

    public StorageConfig config() {
        return config;
    }

    public RecoveryInfo recoveryInfo() {
        return recovery;
    }

    // ------------------------------------------------------------------ keyspaces

    /** The keyspace of a project, created in memory on first use. */
    public Keyspace keyspace(String name) {
        Keyspace existing = byName.get(name);
        if (existing != null) {
            return existing;
        }
        return byName.computeIfAbsent(name, n -> {
            Keyspace ks = new Keyspace(nextKeyspaceId.getAndIncrement(), n);
            byId.put(ks.id(), ks);
            memory.add(256);
            return ks;
        });
    }

    public Keyspace findKeyspace(String name) {
        return byName.get(name);
    }

    public Collection<Keyspace> keyspaces() {
        return byName.values();
    }

    /** Remove a keyspace with all keys and tables, durably. */
    public CompletableFuture<Void> dropKeyspace(String name) {
        Keyspace ks = byName.get(name);
        if (ks == null) {
            return DONE;
        }
        int e = enterWrite();
        try {
            CompletableFuture<Void> durable = DONE;
            if (ks.defined) {
                durable = logRecord(MutationCodec.encodeRecord(new Mutation.DropKeyspace(ks.id())));
            }
            removeKeyspace(ks);
            return durable;
        } finally {
            exitWrite(e);
        }
    }

    private void removeKeyspace(Keyspace ks) {
        ks.dropped = true;
        byName.remove(ks.name(), ks);
        byId.remove(ks.id(), ks);
        long freed = 256;
        for (Map.Entry<String, Slot> entry : ks.slots.entrySet()) {
            freed += Slot.cost(entry.getKey(), entry.getValue());
        }
        for (Table table : ks.tables.values()) {
            table.release();
        }
        memory.add(-freed);
    }

    private void ensureDefined(Keyspace ks) {
        if (ks.defined || !config.persistence()) {
            return;
        }
        synchronized (ks) {
            if (!ks.defined) {
                logRecord(MutationCodec.encodeRecord(new Mutation.DefineKeyspace(ks.id(), ks.name())));
                ks.defined = true;
            }
        }
    }

    // ------------------------------------------------------------------ key-value

    private long now() {
        return System.currentTimeMillis();
    }

    /**
     * Current slot of a key with an expired cache value already removed, or
     * null. Counts a hit or miss and refreshes the LRU clock.
     */
    public Slot read(Keyspace ks, String key) {
        Slot slot = ks.slots.get(key);
        if (slot != null && slot.cacheExpired(now())) {
            expireCache(ks, key);
            slot = ks.slots.get(key);
        }
        if (slot == null) {
            misses.increment();
            return null;
        }
        hits.increment();
        slot.access = lruClock;
        return slot;
    }

    /**
     * Write a value.
     *
     * @param cache      set the cache layer
     * @param durable    set the durable layer (logged)
     * @param ttlMillis  cache TTL; 0 = none (a previous TTL is cleared, as SET does in Redis)
     * @return completes when the write is as durable as the fsync policy promises
     */
    public CompletableFuture<Void> put(Keyspace ks, String key, String value, boolean cache, boolean durable, long ttlMillis) {
        checkKey(key);
        checkAlive(ks);
        if (durable) {
            requireDurability();
            ensureDefined(ks);
        }
        reserveMemory(Slot.cost(key, new Slot(value, durable ? value : null, 0, 0)));
        byte[] record = durable && config.persistence()
                ? MutationCodec.encodeRecord(new Mutation.Put(ks.id(), key, value)) : null;
        long expireAt = cache && ttlMillis > 0 ? now() + ttlMillis : 0;
        @SuppressWarnings("unchecked")
        CompletableFuture<Void>[] result = new CompletableFuture[]{DONE};
        int e = enterWrite();
        try {
            ks.slots.compute(key, (k, old) -> {
                String newCache = cache ? value : (old == null ? null : old.cache);
                String newPersistent = durable ? value : (old == null ? null : old.persistent);
                long newExpire = cache ? expireAt : (old == null ? 0 : old.expireAt);
                Slot next = new Slot(newCache, newPersistent, newExpire, lruClock);
                if (record != null) {
                    result[0] = logRecord(record);
                }
                track(ks, k, old, next);
                return next;
            });
        } finally {
            exitWrite(e);
        }
        if (durable) {
            durableSinceCheckpoint.incrementAndGet();
        }
        if (expireAt > 0) {
            ks.ttlKeys.add(key);
        }
        return result[0];
    }

    /** Delete from the given layers. */
    public DeleteResult delete(Keyspace ks, String key, boolean cache, boolean durable) {
        checkAlive(ks);
        if (durable) {
            Slot current = ks.slots.get(key);
            if (current != null && current.persistent != null) {
                requireDurability();
            }
        }
        boolean[] existed = {false};
        @SuppressWarnings("unchecked")
        CompletableFuture<Void>[] result = new CompletableFuture[]{DONE};
        int e = enterWrite();
        try {
            ks.slots.computeIfPresent(key, (k, old) -> {
                String newCache = cache ? null : old.cache;
                String newPersistent = durable ? null : old.persistent;
                if ((cache && old.cache != null) || (durable && old.persistent != null)) {
                    existed[0] = true;
                }
                if (durable && old.persistent != null && config.persistence()) {
                    result[0] = logRecord(MutationCodec.encodeRecord(new Mutation.Delete(ks.id(), k)));
                    durableSinceCheckpoint.incrementAndGet();
                }
                Slot next = newCache == null && newPersistent == null ? null
                        : new Slot(newCache, newPersistent, old.expireAt, old.access);
                track(ks, k, old, next);
                return next;
            });
        } finally {
            exitWrite(e);
        }
        if (cache) {
            ks.ttlKeys.remove(key);
        }
        return new DeleteResult(existed[0], result[0]);
    }

    /**
     * Atomically add {@code delta} to an integer value. Reads the cache value,
     * falling back to the durable one; writes the cache and, with
     * {@code durable}, the durable layer.
     */
    public IncrResult incr(Keyspace ks, String key, long delta, boolean durable) {
        checkKey(key);
        checkAlive(ks);
        if (durable) {
            requireDurability();
            ensureDefined(ks);
        }
        reserveMemory(Slot.cost(key, new Slot("0000000000", null, 0, 0)));
        long[] value = {0};
        @SuppressWarnings("unchecked")
        CompletableFuture<Void>[] result = new CompletableFuture[]{DONE};
        long now = now();
        int e = enterWrite();
        try {
            ks.slots.compute(key, (k, old) -> {
                String current = null;
                if (old != null) {
                    current = old.cache != null && !old.cacheExpired(now) ? old.cache : old.persistent;
                }
                long base;
                try {
                    base = current == null ? 0 : Long.parseLong(current.trim());
                } catch (NumberFormatException ex) {
                    throw new StorageException("TYPE", "value of " + k + " is not an integer");
                }
                long next;
                try {
                    next = Math.addExact(base, delta);
                } catch (ArithmeticException ex) {
                    throw new StorageException("TYPE", "increment would overflow");
                }
                value[0] = next;
                String text = Long.toString(next);
                String persistent = durable ? text : (old == null ? null : old.persistent);
                long expireAt = old != null && !old.cacheExpired(now) ? old.expireAt : 0;
                Slot slot = new Slot(text, persistent, expireAt, lruClock);
                if (durable && config.persistence()) {
                    result[0] = logRecord(MutationCodec.encodeRecord(new Mutation.Put(ks.id(), k, text)));
                }
                track(ks, k, old, slot);
                return slot;
            });
        } finally {
            exitWrite(e);
        }
        if (durable) {
            durableSinceCheckpoint.incrementAndGet();
        }
        return new IncrResult(value[0], result[0]);
    }

    /** Set or clear ({@code ttlMillis <= 0}) the TTL of the cache value. @return false when there is no cache value */
    public boolean expire(Keyspace ks, String key, long ttlMillis) {
        boolean[] done = {false};
        long expireAt = ttlMillis > 0 ? now() + ttlMillis : 0;
        long now = now();
        ks.slots.computeIfPresent(key, (k, old) -> {
            if (old.cache == null || old.cacheExpired(now)) {
                return old;
            }
            done[0] = true;
            return new Slot(old.cache, old.persistent, expireAt, old.access);
        });
        if (done[0]) {
            if (expireAt > 0) {
                ks.ttlKeys.add(key);
            } else {
                ks.ttlKeys.remove(key);
            }
        }
        return done[0];
    }

    /** Remaining cache TTL in ms: -2 when there is no cache value, -1 when it does not expire. */
    public long ttl(Keyspace ks, String key) {
        Slot slot = read(ks, key);
        if (slot == null || slot.cache == null) {
            return -2;
        }
        if (slot.expireAt == 0) {
            return -1;
        }
        return Math.max(0, slot.expireAt - now());
    }

    /** HEAVEN: drop the cache layer of every key (durable values stay). @return cache values removed */
    public long clearCache(Keyspace ks) {
        long removed = 0;
        for (String key : ks.slots.keySet()) {
            boolean[] had = {false};
            ks.slots.computeIfPresent(key, (k, old) -> {
                if (old.cache == null) {
                    return old;
                }
                had[0] = true;
                Slot next = old.persistent == null ? null : new Slot(null, old.persistent, 0, old.access);
                track(ks, k, old, next);
                return next;
            });
            if (had[0]) {
                removed++;
            }
        }
        ks.ttlKeys.clear();
        return removed;
    }

    private void expireCache(Keyspace ks, String key) {
        long now = now();
        boolean[] expired = {false};
        ks.slots.computeIfPresent(key, (k, old) -> {
            if (!old.cacheExpired(now)) {
                return old;
            }
            expired[0] = true;
            Slot next = old.persistent == null ? null : new Slot(null, old.persistent, 0, old.access);
            track(ks, k, old, next);
            return next;
        });
        if (expired[0]) {
            expirations.increment();
            ks.ttlKeys.remove(key);
        }
    }

    private void sweepExpired() {
        long now = now();
        for (Keyspace ks : byName.values()) {
            if (ks.ttlKeys.isEmpty()) {
                continue;
            }
            List<String> due = new ArrayList<>();
            ks.forEachTtlKey(256, key -> {
                Slot slot = ks.slots.get(key);
                if (slot == null || slot.cache == null || slot.expireAt == 0) {
                    ks.ttlKeys.remove(key);
                } else if (slot.cacheExpired(now)) {
                    due.add(key);
                }
            });
            for (String key : due) {
                expireCache(ks, key);
            }
        }
    }

    /** Keys matching {@code pattern} in the given layer, at most {@code limit}. */
    public List<String> keys(Keyspace ks, String pattern, Layer layer, int limit) {
        Glob glob = new Glob(pattern);
        long now = now();
        List<String> keys = new ArrayList<>();
        for (Map.Entry<String, Slot> entry : ks.slots.entrySet()) {
            Slot slot = entry.getValue();
            boolean cacheLive = slot.cache != null && !slot.cacheExpired(now);
            boolean present = switch (layer) {
                case ANY -> cacheLive || slot.persistent != null;
                case CACHE -> cacheLive;
                case PERSISTENT -> slot.persistent != null;
            };
            if (present && glob.matches(entry.getKey())) {
                keys.add(entry.getKey());
                if (keys.size() >= limit) {
                    break;
                }
            }
        }
        return keys;
    }

    /** Visit every live entry (DUMP / backup export). */
    public void forEach(Keyspace ks, java.util.function.BiConsumer<String, Slot> action) {
        long now = now();
        for (Map.Entry<String, Slot> entry : ks.slots.entrySet()) {
            Slot slot = entry.getValue();
            if (slot.cacheExpired(now) && slot.persistent == null) {
                continue;
            }
            action.accept(entry.getKey(), slot);
        }
    }

    private static void checkAlive(Keyspace ks) {
        if (ks.dropped) {
            throw new StorageException("NOPROJECT", "the project was deleted");
        }
    }

    private static void checkKey(String key) {
        if (key.startsWith(RESERVED_PREFIX)) {
            throw new StorageException("RESERVED", "keys starting with " + RESERVED_PREFIX + " are reserved");
        }
    }

    private void track(Keyspace ks, String key, Slot old, Slot next) {
        memory.add(Slot.cost(key, next) - Slot.cost(key, old));
        boolean oldCache = old != null && old.cache != null;
        boolean newCache = next != null && next.cache != null;
        boolean oldPersistent = old != null && old.persistent != null;
        boolean newPersistent = next != null && next.persistent != null;
        if (oldCache != newCache) {
            ks.cacheKeys.add(newCache ? 1 : -1);
        }
        if (oldPersistent != newPersistent) {
            ks.persistentKeys.add(newPersistent ? 1 : -1);
        }
    }

    // ------------------------------------------------------------------ tables

    /**
     * Log a table mutation. The SQL engine calls this while holding the
     * table's write lock (or, for CREATE/DROP, inside the keyspace's table map
     * update) and applies the change to memory right after.
     */
    public CompletableFuture<Void> logTableMutation(Keyspace ks, Mutation mutation) {
        checkAlive(ks);
        if (!config.persistence()) {
            return DONE;
        }
        requireDurability();
        ensureDefined(ks);
        durableSinceCheckpoint.incrementAndGet();
        return logRecord(MutationCodec.encodeRecord(mutation));
    }

    /** Memory accounting hook for new tables. */
    public LongConsumer memoryTracker() {
        return memoryTracker;
    }

    public Table newTable(String name, TableSchema schema) {
        return new Table(name, schema, memoryTracker);
    }

    // ------------------------------------------------------------------ memory

    public long usedMemory() {
        return memory.sum();
    }

    /**
     * Make room for {@code bytes} under {@code max-memory}: evict cache-only
     * keys when the policy allows, refuse the write otherwise.
     */
    public void reserveMemory(long bytes) {
        long max = config.maxMemoryBytes();
        if (max <= 0 || memory.sum() + bytes <= max) {
            return;
        }
        if (config.eviction() == StorageConfig.Eviction.CACHE_LRU) {
            int rounds = 0;
            while (memory.sum() + bytes > max && rounds++ < 128) {
                if (!evictOne()) {
                    break;
                }
            }
        }
        if (memory.sum() + bytes > max) {
            throw new StorageException("OOM", "max-memory reached (" + max + " bytes) and nothing can be evicted");
        }
    }

    private boolean evictOne() {
        long now = now();
        Map.Entry<String, Slot> best = null;
        Keyspace owner = null;
        for (Keyspace ks : byName.values()) {
            Map.Entry<String, Slot> candidate = ks.evictionCandidate(8, now);
            if (candidate != null && (best == null || candidate.getValue().access < best.getValue().access)) {
                best = candidate;
                owner = ks;
            }
        }
        if (best == null) {
            return false;
        }
        String key = best.getKey();
        Slot expected = best.getValue();
        Keyspace ks = owner;
        boolean[] removed = {false};
        ks.slots.computeIfPresent(key, (k, old) -> {
            if (old != expected || !old.evictable()) {
                return old;
            }
            removed[0] = true;
            track(ks, k, old, null);
            return null;
        });
        if (removed[0]) {
            evictions.increment();
            ks.ttlKeys.remove(key);
        }
        return true;
    }

    // ------------------------------------------------------------------ durability

    private void requireDurability() {
        if (config.persistence() && wal != null && !wal.isHealthy()) {
            IOException failure = wal.failure();
            throw new StorageException("PERSISTENCE",
                    "persistence is unavailable (" + (failure == null ? "closed" : failure.getMessage()) + "); durable writes are refused");
        }
    }

    private CompletableFuture<Void> logRecord(byte[] record) {
        if (!config.persistence() || wal == null) {
            return DONE;
        }
        if (config.fsync() == FsyncPolicy.ALWAYS) {
            return wal.append(record).thenApply(segment -> null);
        }
        try {
            wal.appendNoWait(record);
        } catch (IOException e) {
            throw new StorageException("PERSISTENCE", "persistence is unavailable: " + e.getMessage(), e);
        }
        return DONE;
    }

    private int enterWrite() {
        while (true) {
            int e = epoch;
            LongAdder counter = inFlight[e & 1];
            counter.increment();
            if (epoch == e) {
                return e;
            }
            counter.decrement();
        }
    }

    private void exitWrite(int e) {
        inFlight[e & 1].decrement();
    }

    /** Wait until everything logged so far is on stable storage. */
    public void sync() throws IOException {
        if (!config.persistence() || wal == null) {
            return;
        }
        await(wal.sync(), "sync");
    }

    /**
     * Write a snapshot and drop the log segments it covers. Writers are not
     * blocked; only one checkpoint runs at a time.
     */
    public CheckpointInfo checkpoint() throws IOException {
        if (!config.persistence()) {
            throw new IOException("persistence is disabled");
        }
        synchronized (checkpointLock) {
            long started = System.nanoTime();
            CompletableFuture<Long> rotated = wal.rotate();
            int old = epoch;
            epoch = old + 1;
            while (inFlight[old & 1].sum() != 0) {
                Thread.onSpinWait();
            }
            long walStart = await(rotated, "log rotation");
            long before = durableSinceCheckpoint.get();
            SnapshotFile.Info info = SnapshotFile.write(config.snapshotFile(), walStart, config.compressSnapshots(), this::emitState);
            wal.deleteSegmentsBefore(walStart);
            durableSinceCheckpoint.addAndGet(-before);
            long millis = (System.nanoTime() - started) / 1_000_000;
            checkpoints.incrementAndGet();
            lastCheckpointAt = info.createdAtMillis();
            lastCheckpointMillis = millis;
            lastSnapshotBytes = info.fileBytes();
            lastCheckpointError = null;
            log.debug(String.format("Checkpoint: %d records, %d bytes, %d ms", info.records(), info.fileBytes(), millis));
            return new CheckpointInfo(config.snapshotFile(), info.fileBytes(), info.records(), walStart, millis);
        }
    }

    /** Work done while a fresh checkpoint is guaranteed to stay current (no other checkpoint can run). */
    @FunctionalInterface
    public interface CheckpointAction<T> {
        T run(CheckpointInfo checkpoint) throws IOException;
    }

    /**
     * Take a checkpoint and run {@code action} before any other checkpoint may
     * replace the snapshot or delete log segments; used by online backups.
     */
    public <T> T checkpointThen(CheckpointAction<T> action) throws IOException {
        synchronized (checkpointLock) {
            return action.run(checkpoint());
        }
    }

    private static <T> T await(CompletableFuture<T> future, String what) throws IOException {
        try {
            return future.get(60, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException(what + " interrupted", e);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            throw cause instanceof IOException io ? io : new IOException(what + " failed: " + cause.getMessage(), cause);
        } catch (TimeoutException e) {
            throw new IOException(what + " timed out", e);
        }
    }

    /** Every durable fact as mutations; the body of a snapshot. */
    public void emitState(Consumer<Mutation> sink) {
        List<Keyspace> spaces = new ArrayList<>(byId.values());
        spaces.sort(Comparator.comparingInt(Keyspace::id));
        for (Keyspace ks : spaces) {
            sink.accept(new Mutation.DefineKeyspace(ks.id(), ks.name()));
            for (Map.Entry<String, Slot> entry : ks.slots.entrySet()) {
                String persistent = entry.getValue().persistent;
                if (persistent != null) {
                    sink.accept(new Mutation.Put(ks.id(), entry.getKey(), persistent));
                }
            }
            for (Table table : ks.tables.values()) {
                table.lock().readLock().lock();
                try {
                    sink.accept(new Mutation.CreateTable(ks.id(), table.name(), table.schema().toJson()));
                    for (Map.Entry<Long, Object[]> row : table.rows().entrySet()) {
                        sink.accept(new Mutation.PutRow(ks.id(), table.name(), row.getKey(), row.getValue()));
                    }
                    for (Index index : table.explicitIndexes()) {
                        sink.accept(new Mutation.CreateIndex(ks.id(), table.name(), index.name(), index.column(), index.unique()));
                    }
                } finally {
                    table.lock().readLock().unlock();
                }
            }
        }
    }

    /** Apply a logged mutation to memory (recovery and replication path; single threaded). */
    public void apply(Mutation mutation) {
        if (mutation instanceof Mutation.Put m) {
            Keyspace ks = byId.get(m.keyspace());
            if (ks != null) {
                ks.slots.compute(m.key(), (k, old) -> {
                    Slot next = new Slot(old == null ? null : old.cache, m.value(), old == null ? 0 : old.expireAt, 0);
                    track(ks, k, old, next);
                    return next;
                });
            }
        } else if (mutation instanceof Mutation.PutRow m) {
            Table table = table(m.keyspace(), m.table());
            if (table != null) {
                table.put(m.rowId(), m.values());
            }
        } else if (mutation instanceof Mutation.Delete m) {
            Keyspace ks = byId.get(m.keyspace());
            if (ks != null) {
                ks.slots.computeIfPresent(m.key(), (k, old) -> {
                    Slot next = old.cache == null ? null : new Slot(old.cache, null, old.expireAt, old.access);
                    track(ks, k, old, next);
                    return next;
                });
            }
        } else if (mutation instanceof Mutation.DeleteRow m) {
            Table table = table(m.keyspace(), m.table());
            if (table != null) {
                table.remove(m.rowId());
            }
        } else if (mutation instanceof Mutation.DefineKeyspace m) {
            Keyspace previous = byName.get(m.name());
            if (previous != null && previous.id() != m.keyspace()) {
                removeKeyspace(previous);
            }
            Keyspace ks = byId.computeIfAbsent(m.keyspace(), id -> new Keyspace(id, m.name()));
            ks.defined = true;
            byName.put(m.name(), ks);
            nextKeyspaceId.accumulateAndGet(m.keyspace() + 1, Math::max);
        } else if (mutation instanceof Mutation.DropKeyspace m) {
            Keyspace ks = byId.get(m.keyspace());
            if (ks != null) {
                removeKeyspace(ks);
            }
        } else if (mutation instanceof Mutation.CreateTable m) {
            Keyspace ks = byId.get(m.keyspace());
            if (ks != null) {
                Table previous = ks.tables.put(m.table(), newTable(m.table(), TableSchema.fromJson(m.schemaJson())));
                if (previous != null) {
                    previous.release();
                }
            }
        } else if (mutation instanceof Mutation.AlterTable m) {
            Table table = table(m.keyspace(), m.table());
            if (table != null) {
                table.alter(TableSchema.fromJson(m.schemaJson()));
            }
        } else if (mutation instanceof Mutation.DropTable m) {
            Keyspace ks = byId.get(m.keyspace());
            Table removed = ks == null ? null : ks.tables.remove(m.table());
            if (removed != null) {
                removed.release();
            }
        } else if (mutation instanceof Mutation.CreateIndex m) {
            Table table = table(m.keyspace(), m.table());
            if (table != null && table.index(m.name()) == null) {
                table.createIndex(m.name(), m.column(), m.unique());
            }
        } else if (mutation instanceof Mutation.DropIndex m) {
            Table table = table(m.keyspace(), m.table());
            if (table != null) {
                table.dropIndex(m.name());
            }
        }
    }

    private Table table(int keyspace, String name) {
        Keyspace ks = byId.get(keyspace);
        return ks == null ? null : ks.tables.get(name);
    }

    // ------------------------------------------------------------------ statistics

    /** Counters for INFO. */
    public record Stats(long usedMemory, long maxMemory, String eviction, long keyspaces, long keys, long cacheKeys,
                        long persistentKeys, long tables, long hits, long misses, long evictions, long expirations,
                        boolean persistence, String fsync, boolean healthy, long walBytes, long walSegment,
                        long walRecords, long walFsyncs, long walBatches, int walQueued, long checkpoints,
                        String lastCheckpointAt, long lastCheckpointMillis, long lastSnapshotBytes,
                        long changesSinceCheckpoint, String lastError) {}

    public Stats stats() {
        long keys = 0;
        long cacheKeys = 0;
        long persistentKeys = 0;
        long tables = 0;
        for (Keyspace ks : byName.values()) {
            keys += ks.slots.size();
            cacheKeys += ks.cacheKeys.sum();
            persistentKeys += ks.persistentKeys.sum();
            tables += ks.tables.size();
        }
        boolean persistent = config.persistence() && wal != null;
        IOException failure = persistent ? wal.failure() : null;
        return new Stats(memory.sum(), config.maxMemoryBytes(), config.eviction().name().toLowerCase(java.util.Locale.ROOT).replace('_', '-'),
                byName.size(), keys, cacheKeys, persistentKeys, tables, hits.sum(), misses.sum(), evictions.sum(),
                expirations.sum(), config.persistence(), config.fsync().configName(), !persistent || wal.isHealthy(),
                persistent ? wal.totalBytes() : 0, persistent ? wal.currentSegment() : 0,
                persistent ? wal.appendedRecords() : 0, persistent ? wal.fsyncCount() : 0,
                persistent ? wal.batchCount() : 0, persistent ? wal.queued() : 0, checkpoints.get(),
                lastCheckpointAt == 0 ? null : Instant.ofEpochMilli(lastCheckpointAt).toString(), lastCheckpointMillis,
                lastSnapshotBytes, durableSinceCheckpoint.get(),
                failure != null ? failure.getMessage() : lastCheckpointError);
    }
}
