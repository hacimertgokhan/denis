package github.hacimertgokhan.denis.storage;

import github.hacimertgokhan.denis.storage.codec.ByteSink;
import github.hacimertgokhan.denis.storage.wal.FsyncPolicy;
import github.hacimertgokhan.denis.storage.wal.WriteAheadLog;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StorageEngineTest {
    @TempDir
    Path dir;

    private StorageConfig config() {
        return StorageConfig.defaults(dir.resolve("data")).withCheckpoint(0, 0);
    }

    private StorageEngine open(StorageConfig config) throws IOException {
        return new StorageEngine(config).open();
    }

    private static String value(StorageEngine engine, String project, String key) {
        Keyspace ks = engine.findKeyspace(project);
        if (ks == null) {
            return null;
        }
        Slot slot = engine.read(ks, key);
        if (slot == null) {
            return null;
        }
        return slot.cache() != null ? slot.cache() : slot.persistent();
    }

    @Test
    void cacheAndDurableLayers() throws IOException {
        try (StorageEngine engine = open(config())) {
            Keyspace ks = engine.keyspace("p");
            engine.put(ks, "c", "cache-only", true, false, 0).join();
            engine.put(ks, "d", "durable", true, true, 0).join();
            assertEquals("cache-only", value(engine, "p", "c"));
            assertEquals(1, ks.persistentKeyCount());
            assertEquals(2, ks.cacheKeyCount());

            // HEAVEN drops the cache layer only
            engine.clearCache(ks);
            assertNull(value(engine, "p", "c"));
            assertEquals("durable", value(engine, "p", "d"));

            // delete of the durable layer only
            assertTrue(engine.delete(ks, "d", false, true).existed());
            assertNull(value(engine, "p", "d"));
        }
    }

    @Test
    void recoversAfterCrashWithoutCheckpoint() throws IOException {
        StorageConfig config = config();
        StorageEngine engine = open(config);
        Keyspace ks = engine.keyspace("p");
        for (int i = 0; i < 500; i++) {
            engine.put(ks, "k" + i, "v" + i, true, true, 0);
        }
        engine.put(ks, "volatile", "x", true, false, 0);
        engine.delete(ks, "k5", true, true);
        engine.sync();
        // copy the directory as a crash would leave it, before close() writes a snapshot
        Path crashed = dir.resolve("crashed");
        copyTree(config.dataDir(), crashed);
        engine.close();

        try (StorageEngine recovered = open(StorageConfig.defaults(crashed).withCheckpoint(0, 0))) {
            assertEquals("v0", value(recovered, "p", "k0"));
            assertEquals("v499", value(recovered, "p", "k499"));
            assertNull(value(recovered, "p", "k5"));
            assertNull(value(recovered, "p", "volatile"), "cache-only data is not durable");
            assertEquals(499, recovered.findKeyspace("p").persistentKeyCount());
            // keyspace definition + 500 puts + 1 delete
            assertEquals(502, recovered.recoveryInfo().walRecords());
        }
    }

    @Test
    void tornTailIsCutAndEverythingBeforeItSurvives() throws IOException {
        StorageConfig config = config();
        StorageEngine engine = open(config);
        Keyspace ks = engine.keyspace("p");
        engine.put(ks, "a", "1", true, true, 0);
        engine.put(ks, "b", "2", true, true, 0);
        engine.sync();
        Path crashed = dir.resolve("crashed");
        copyTree(config.dataDir(), crashed);
        engine.close();

        // append half a record to the newest segment, as a power cut mid-write would
        List<Long> segments = WriteAheadLog.listSegments(crashed.resolve("wal"));
        Path last = WriteAheadLog.segmentPath(crashed.resolve("wal"), segments.get(segments.size() - 1));
        byte[] garbage = new ByteSink().writeVarInt(500).writeInt(12345).writeBytes("partial".getBytes(StandardCharsets.UTF_8)).toByteArray();
        Files.write(last, garbage, StandardOpenOption.APPEND);
        long before = Files.size(last);

        try (StorageEngine recovered = open(StorageConfig.defaults(crashed).withCheckpoint(0, 0))) {
            assertEquals("1", value(recovered, "p", "a"));
            assertEquals("2", value(recovered, "p", "b"));
            assertEquals(garbage.length, recovered.recoveryInfo().truncatedBytes());
        }
        assertTrue(Files.size(last) < before);
    }

    @Test
    void damageInAnOlderSegmentStopsRecovery() throws IOException {
        StorageConfig config = config();
        StorageEngine engine = open(config);
        Keyspace ks = engine.keyspace("p");
        engine.put(ks, "a", "1", true, true, 0);
        engine.sync();
        Path crashed = dir.resolve("crashed");
        copyTree(config.dataDir(), crashed);
        engine.close();
        List<Long> segments = WriteAheadLog.listSegments(crashed.resolve("wal"));
        Path first = WriteAheadLog.segmentPath(crashed.resolve("wal"), segments.get(0));
        byte[] bytes = Files.readAllBytes(first);
        bytes[bytes.length - 1] ^= 0x55;
        Files.write(first, bytes);
        // a newer segment exists after it
        Files.write(WriteAheadLog.segmentPath(crashed.resolve("wal"), segments.get(segments.size() - 1) + 1), new byte[0]);

        assertThrows(IOException.class, () -> open(StorageConfig.defaults(crashed).withCheckpoint(0, 0)));
    }

    @Test
    void checkpointReplacesLogWithSnapshot() throws IOException {
        StorageConfig config = config();
        try (StorageEngine engine = open(config)) {
            Keyspace ks = engine.keyspace("p");
            for (int i = 0; i < 2000; i++) {
                engine.put(ks, "k" + i, "value-" + i, true, true, 0);
            }
            StorageEngine.CheckpointInfo info = engine.checkpoint();
            assertTrue(Files.exists(info.snapshot()));
            assertEquals(2001, info.records(), "one keyspace definition + 2000 keys");
            // only the fresh segment remains
            assertEquals(1, WriteAheadLog.listSegments(config.walDir()).size());
        }
        try (StorageEngine engine = open(config)) {
            assertEquals("value-1999", value(engine, "p", "k1999"));
            assertEquals(2000, engine.findKeyspace("p").persistentKeyCount());
        }
    }

    /**
     * Writers never stop while checkpoints run. After a crash (no final
     * checkpoint) every key must hold the last value its writer wrote: this is
     * what the epoch guard around fuzzy checkpoints is for.
     */
    @Test
    void checkpointsUnderConcurrentWritesLoseNothing() throws Exception {
        StorageConfig config = config().withFsync(FsyncPolicy.NO);
        StorageEngine engine = open(config);
        Keyspace ks = engine.keyspace("p");
        int writers = 8;
        int keysPerWriter = 50;
        ConcurrentHashMap<String, String> expected = new ConcurrentHashMap<>();
        AtomicBoolean stop = new AtomicBoolean();
        CountDownLatch done = new CountDownLatch(writers);
        List<Throwable> failures = new ArrayList<>();
        for (int w = 0; w < writers; w++) {
            int id = w;
            Thread t = new Thread(() -> {
                try {
                    long n = 0;
                    while (!stop.get()) {
                        String key = "w" + id + ":" + (n % keysPerWriter);
                        String v = Long.toString(n++);
                        if (n % 7 == 0) {
                            engine.delete(ks, key, true, true);
                            expected.remove(key);
                        } else {
                            engine.put(ks, key, v, true, true, 0);
                            expected.put(key, v);
                        }
                    }
                } catch (Throwable e) {
                    synchronized (failures) {
                        failures.add(e);
                    }
                } finally {
                    done.countDown();
                }
            });
            t.start();
        }
        for (int i = 0; i < 15; i++) {
            engine.checkpoint();
            Thread.sleep(10);
        }
        stop.set(true);
        done.await();
        assertTrue(failures.isEmpty(), failures.toString());
        engine.sync();
        Path crashed = dir.resolve("crashed");
        copyTree(config.dataDir(), crashed);
        engine.close();

        try (StorageEngine recovered = open(StorageConfig.defaults(crashed).withCheckpoint(0, 0))) {
            Keyspace r = recovered.findKeyspace("p");
            assertNotNull(r);
            assertEquals(expected.size(), r.persistentKeyCount());
            expected.forEach((key, v) -> assertEquals(v, value(recovered, "p", key), key));
        }
    }

    @Test
    void ttlExpiresTheCacheValueOnly() throws Exception {
        try (StorageEngine engine = new StorageEngine(StorageConfig.inMemory()).open()) {
            Keyspace ks = engine.keyspace("p");
            engine.put(ks, "session", "abc", true, false, 50);
            engine.put(ks, "both", "durable", true, true, 0);
            assertTrue(engine.expire(ks, "both", 50));
            assertTrue(engine.ttl(ks, "session") > 0);
            assertEquals(-2, engine.ttl(ks, "missing"));
            assertTrue(engine.ttl(ks, "both") > 0);
            Thread.sleep(120);
            assertNull(value(engine, "p", "session"));
            assertEquals("durable", value(engine, "p", "both"), "the durable value outlives the cache TTL");
            assertEquals(-2, engine.ttl(ks, "session"));
        }
    }

    @Test
    void incrIsAtomicAcrossThreads() throws Exception {
        try (StorageEngine engine = new StorageEngine(StorageConfig.inMemory()).open()) {
            Keyspace ks = engine.keyspace("p");
            Thread[] threads = new Thread[8];
            for (int i = 0; i < threads.length; i++) {
                threads[i] = new Thread(() -> {
                    for (int j = 0; j < 10_000; j++) {
                        engine.incr(ks, "counter", 1, false);
                    }
                });
                threads[i].start();
            }
            for (Thread t : threads) {
                t.join();
            }
            assertEquals("80000", value(engine, "p", "counter"));
            engine.put(ks, "text", "abc", true, false, 0);
            StorageException e = assertThrows(StorageException.class, () -> engine.incr(ks, "text", 1, false));
            assertEquals("TYPE", e.code());
        }
    }

    @Test
    void memoryLimitEvictsCacheKeysButNeverDurableOnes() throws IOException {
        StorageConfig config = StorageConfig.inMemory().withMaxMemory(200_000, StorageConfig.Eviction.CACHE_LRU);
        try (StorageEngine engine = new StorageEngine(config).open()) {
            Keyspace ks = engine.keyspace("p");
            for (int i = 0; i < 100; i++) {
                engine.put(ks, "durable" + i, "x".repeat(100), true, true, 0);
            }
            for (int i = 0; i < 5000; i++) {
                engine.put(ks, "cache" + i, "y".repeat(100), true, false, 0);
            }
            assertTrue(engine.usedMemory() <= 200_000, "used " + engine.usedMemory());
            assertTrue(engine.stats().evictions() > 0);
            for (int i = 0; i < 100; i++) {
                assertEquals("x".repeat(100), value(engine, "p", "durable" + i));
            }
        }
    }

    @Test
    void noevictionRefusesWritesAtTheLimit() throws IOException {
        StorageConfig config = StorageConfig.inMemory().withMaxMemory(50_000, StorageConfig.Eviction.NOEVICTION);
        try (StorageEngine engine = new StorageEngine(config).open()) {
            Keyspace ks = engine.keyspace("p");
            StorageException e = assertThrows(StorageException.class, () -> {
                for (int i = 0; i < 10_000; i++) {
                    engine.put(ks, "k" + i, "v".repeat(100), true, false, 0);
                }
            });
            assertEquals("OOM", e.code());
        }
    }

    @Test
    void reservedKeysAreRefused() throws IOException {
        try (StorageEngine engine = new StorageEngine(StorageConfig.inMemory()).open()) {
            StorageException e = assertThrows(StorageException.class,
                    () -> engine.put(engine.keyspace("p"), "__sql:x", "y", true, false, 0));
            assertEquals("RESERVED", e.code());
        }
    }

    @Test
    void keysListingHonoursPatternAndLayer() throws IOException {
        try (StorageEngine engine = new StorageEngine(StorageConfig.inMemory()).open()) {
            Keyspace ks = engine.keyspace("p");
            engine.put(ks, "user:1", "a", true, true, 0);
            engine.put(ks, "user:2", "b", true, false, 0);
            engine.put(ks, "order:1", "c", true, false, 0);
            assertEquals(2, engine.keys(ks, "user:*", StorageEngine.Layer.ANY, 100).size());
            assertEquals(List.of("user:1"), engine.keys(ks, "user:*", StorageEngine.Layer.PERSISTENT, 100));
            assertEquals(1, engine.keys(ks, "*", StorageEngine.Layer.ANY, 1).size());
        }
    }

    @Test
    void droppedKeyspaceStaysDroppedAfterRestart() throws IOException {
        StorageConfig config = config();
        try (StorageEngine engine = open(config)) {
            Keyspace ks = engine.keyspace("gone");
            engine.put(ks, "a", "1", true, true, 0);
            engine.put(engine.keyspace("kept"), "b", "2", true, true, 0);
            engine.dropKeyspace("gone").join();
            assertFalse(engine.keyspaces().stream().anyMatch(k -> k.name().equals("gone")));
        }
        try (StorageEngine engine = open(config)) {
            assertNull(engine.findKeyspace("gone"));
            assertEquals("2", value(engine, "kept", "b"));
        }
    }

    @Test
    void legacyDatabaseBinIsImportedOnce() throws IOException {
        // protobuf: Database{ tokens: [TokenData{ token: "tok:", keyValues: {"tok:greeting": "hello"} }] }
        byte[] entry = concat(field(1, "tok:greeting"), field(2, "hello"));
        byte[] tokenData = concat(field(1, "tok:"), field(2, entry));
        byte[] database = field(1, tokenData);
        Path legacy = dir.resolve("database.bin");
        Files.write(legacy, database);

        StorageConfig config = config().withLegacyDatabase(legacy);
        try (StorageEngine engine = open(config)) {
            assertEquals("hello", value(engine, "tok", "greeting"));
            assertTrue(engine.recoveryInfo().migratedLegacy());
        }
        assertFalse(Files.exists(legacy));
        assertTrue(Files.exists(dir.resolve("database.bin.migrated")));
        try (StorageEngine engine = open(config)) {
            assertEquals("hello", value(engine, "tok", "greeting"));
        }
    }

    /** Denis 0.3-0.5: snapshot + JSON journal, SQL tables as __sql: keys. */
    @Test
    void releases03To05AreImportedWithJournalAndTables() throws IOException {
        byte[] entries = new byte[0];
        String[][] snapshot = {
                {"a", "1"},
                {"__sql:t:schema", "[{\"name\":\"id\",\"type\":\"INT\"},{\"name\":\"name\",\"type\":\"TEXT\"}]"},
                {"__sql:t:seq", "2"},
                {"__sql:t:row:1", "{\"id\":1,\"name\":\"Ada\",\"_rowid\":1}"}};
        for (String[] kv : snapshot) {
            entries = concat(entries, field(2, concat(field(1, kv[0]), field(2, kv[1]))));
        }
        Path legacy = dir.resolve("database.bin");
        Files.write(legacy, field(1, concat(field(1, "tok"), entries)));
        Files.writeString(dir.resolve("database.bin.journal"), String.join("\n",
                "[\"S\",\"tok\",\"b\",\"2\"]",
                "[\"D\",\"tok\",\"a\"]",
                "[\"S\",\"tok\",\"__sql:t:row:2\",\"{\\\"id\\\":2,\\\"name\\\":\\\"Grace\\\",\\\"_rowid\\\":2}\"]",
                "[\"S\",\"tok\",\"c\",\"torn") + "\n");

        StorageConfig config = config().withLegacyDatabase(legacy);
        try (StorageEngine engine = open(config)) {
            assertNull(value(engine, "tok", "a"), "deleted by the journal");
            assertEquals("2", value(engine, "tok", "b"));
            assertNull(value(engine, "tok", "c"), "the torn last journal line is ignored");
            var table = engine.findKeyspace("tok").table("t");
            assertNotNull(table, "__sql: keys became a real table");
            assertEquals(2, table.rowCount());
            assertEquals("Grace", table.row(2)[1]);
            assertEquals(1L, table.row(1)[0], "values take the declared column type");
            assertNull(value(engine, "tok", "__sql:t:seq"), "no __sql: keys remain");
        }
        assertTrue(Files.exists(dir.resolve("database.bin.migrated")));
        assertTrue(Files.exists(dir.resolve("database.bin.journal.migrated")));
        try (StorageEngine engine = open(config)) {
            assertEquals(2, engine.findKeyspace("tok").table("t").rowCount(), "survives the restart after migration");
        }
    }

    private static byte[] field(int number, String text) {
        return field(number, text.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] field(int number, byte[] bytes) {
        return new ByteSink().writeVarInt(number << 3 | 2).writeVarInt(bytes.length).writeBytes(bytes).toByteArray();
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    static void copyTree(Path from, Path to) throws IOException {
        try (var walk = Files.walk(from)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                Path target = to.resolve(from.relativize(p).toString());
                if (Files.isDirectory(p)) {
                    Files.createDirectories(target);
                } else {
                    try (FileChannel in = FileChannel.open(p, StandardOpenOption.READ)) {
                        Files.createDirectories(target.getParent());
                        try (FileChannel out = FileChannel.open(target, StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
                            in.transferTo(0, in.size(), out);
                        }
                    }
                }
            }
        }
    }
}
