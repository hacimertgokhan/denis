package github.hacimertgokhan.proto;

import database.Token;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProtoDatabaseTest {
    @TempDir
    Path dir;

    @Test
    void roundTripsThroughTheFile() throws IOException {
        Path file = dir.resolve("database.bin");
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            db.setData("t1", "a", "1");
            db.setData("t1", "b", "two words");
            db.setData("t2", "a", "other project");
            // synchronous mode: every change is in the fsynced journal at once, the snapshot comes on close
            assertTrue(Files.size(db.getJournalPath()) > 0);
        }
        assertTrue(Files.exists(file));
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            assertEquals("1", db.getData("t1", "a"));
            assertEquals("two words", db.getData("t1", "b"));
            assertEquals("other project", db.getData("t2", "a"));
            assertNull(db.getData("t1", "missing"));
            assertNull(db.getData("nope", "a"));
            assertEquals(3, db.keyCount());
            assertEquals(2, db.keyCount("t1"));
            assertTrue(db.deleteData("t1", "a"));
            assertFalse(db.deleteData("t1", "a"));
        }
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            assertFalse(db.exists("t1", "a"));
            assertTrue(db.exists("t1", "b"));
        }
    }

    @Test
    void writeBehindFlushesOnCloseAndOnInterval() throws Exception {
        Path file = dir.resolve("database.bin");
        try (ProtoDatabase db = new ProtoDatabase(file, 50)) {
            db.setData("t", "k", "v");
            assertTrue(db.isDirty());
            // The dirty flag is cleared before the flush counter moves, so wait on the counter.
            long deadline = System.currentTimeMillis() + 5_000;
            while (db.getFlushCount() == 0 && System.currentTimeMillis() < deadline) {
                Thread.sleep(10);
            }
            assertEquals(1, db.getFlushCount(), "the flusher should have written the file once");
            assertFalse(db.isDirty());
            db.setData("t", "k2", "v2");
        }
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            assertEquals("v2", db.getData("t", "k2"));
        }
        assertFalse(Files.exists(dir.resolve("database.bin.tmp")));
    }

    @Test
    void journalSurvivesAnUncleanStop() throws IOException {
        Path file = dir.resolve("database.bin");
        // long intervals: nothing is snapshotted, everything sits in the journal
        ProtoDatabase crashed = new ProtoDatabase(file, 60_000, 60_000);
        crashed.setData("t", "a", "1");
        crashed.setData("t", "b", "2");
        crashed.deleteData("t", "a");
        crashed.setData("u", "x", "y");
        crashed.deleteToken("u");
        assertFalse(Files.exists(file), "no snapshot yet");
        assertTrue(Files.size(crashed.getJournalPath()) > 0);
        crashed.abandon();
        // a new instance on the same files is what a restart after SIGKILL sees
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            assertNull(db.getData("t", "a"));
            assertEquals("2", db.getData("t", "b"));
            assertEquals(0, db.keyCount("u"));
            assertTrue(db.isDirty(), "replayed entries are snapshotted on close");
        }
        assertTrue(Files.exists(file));
        assertEquals(0, Files.size(dir.resolve("database.bin.journal")), "close leaves an empty journal");
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            assertEquals("2", db.getData("t", "b"));
        }
    }

    @Test
    void truncatedJournalLineAndInterruptedSnapshotAreRecovered() throws IOException {
        Path file = dir.resolve("database.bin");
        Files.writeString(dir.resolve("database.bin.journal.old"), "[\"S\",\"t\",\"old\",\"v\"]\n");
        Files.writeString(dir.resolve("database.bin.journal"), "[\"S\",\"t\",\"new\",\"v\"]\n[\"S\",\"t\",\"cut");
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            assertEquals("v", db.getData("t", "old"));
            assertEquals("v", db.getData("t", "new"));
            assertNull(db.getData("t", "cut"));
        }
        assertFalse(Files.exists(dir.resolve("database.bin.journal.old")), "consumed by the snapshot");
    }

    @Test
    void migratesThePre030Layout() throws IOException {
        Path file = dir.resolve("database.bin");
        Token.Database old = Token.Database.newBuilder()
                .addTokens(Token.TokenData.newBuilder()
                        .setToken("abc:")
                        .putKeyValues("abc:greeting", "hello")
                        .putKeyValues("plain", "kept"))
                .build();
        try (OutputStream out = Files.newOutputStream(file)) {
            old.writeTo(out);
        }
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            assertEquals("hello", db.getData("abc", "greeting"));
            assertEquals("hello", db.getData("abc:", "greeting"));
            assertEquals("kept", db.getData("abc", "plain"));
            assertTrue(db.isDirty(), "migrated data is written back in the new layout");
            db.flush();
        }
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            assertFalse(db.isDirty());
            assertEquals(List.of("greeting", "plain"), db.findToken("abc").keySet().stream().sorted().toList());
        }
    }

    @Test
    void concurrentWritersDoNotLoseUpdates() throws Exception {
        Path file = dir.resolve("database.bin");
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try (ProtoDatabase db = new ProtoDatabase(file, 20)) {
            List<Future<?>> tasks = new java.util.ArrayList<>();
            for (int t = 0; t < 8; t++) {
                int thread = t;
                tasks.add(pool.submit(() -> {
                    for (int i = 0; i < 500; i++) {
                        db.setData("p" + (thread % 2), "k" + thread + "-" + i, String.valueOf(i));
                    }
                }));
            }
            for (Future<?> task : tasks) {
                task.get(30, TimeUnit.SECONDS);
            }
            assertEquals(4_000, db.keyCount());
        } finally {
            pool.shutdownNow();
        }
        try (ProtoDatabase db = new ProtoDatabase(file, 0)) {
            assertEquals(4_000, db.keyCount());
            assertEquals("499", db.getData("p1", "k7-499"));
        }
    }
}
