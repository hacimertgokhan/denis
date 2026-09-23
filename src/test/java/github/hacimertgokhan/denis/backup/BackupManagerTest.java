package github.hacimertgokhan.denis.backup;

import github.hacimertgokhan.denis.sql.SqlEngine;
import github.hacimertgokhan.denis.storage.Keyspace;
import github.hacimertgokhan.denis.storage.Slot;
import github.hacimertgokhan.denis.storage.StorageConfig;
import github.hacimertgokhan.denis.storage.StorageEngine;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BackupManagerTest {
    @TempDir
    Path dir;

    @Test
    void backupVerifyRestoreRoundTrip() throws Exception {
        Path dataDir = dir.resolve("data");
        Path groups = dir.resolve("denis.toml");
        Path projects = dir.resolve("ddb.json");
        Files.writeString(groups, "[g]\ngroup = \"g\"\n");
        Files.writeString(projects, "{\"tokens\":[\"p\"]}");
        StorageConfig config = StorageConfig.defaults(dataDir).withCheckpoint(0, 0);

        Path backupFile;
        try (StorageEngine engine = new StorageEngine(config).open()) {
            Keyspace ks = engine.keyspace("p");
            SqlEngine sql = new SqlEngine(engine, 1000);
            engine.put(ks, "kept", "before-backup", true, true, 0);
            sql.execute(ks, "CREATE TABLE t (id INT PRIMARY KEY)", null);
            sql.execute(ks, "INSERT INTO t VALUES (1), (2)", null);
            BackupManager backups = new BackupManager(engine, dir.resolve("backups"), groups, projects, 2, "test");
            Path first = backups.create().path();
            engine.put(ks, "later", "after-first-backup", true, true, 0);
            backups.create();
            backupFile = backups.create().path();
            assertEquals(2, backups.list().size(), "retention keeps the newest two");
            assertFalse(Files.exists(first), "the oldest backup was pruned");
            assertEquals(backupFile, backups.list().get(1).path());
        }

        BackupManager.Verification verification = BackupManager.verify(backupFile);
        assertTrue(verification.ok(), verification.problems().toString());

        Files.writeString(groups, "changed");
        Path aside = BackupManager.restore(backupFile, dataDir, groups, projects);
        assertTrue(Files.isDirectory(aside.resolve("data")), "old data is kept, not deleted");
        assertTrue(Files.readString(groups).contains("[g]"));
        try (StorageEngine engine = new StorageEngine(config).open()) {
            Keyspace ks = engine.findKeyspace("p");
            Slot slot = engine.read(ks, "kept");
            assertEquals("before-backup", slot.persistent());
            assertEquals("after-first-backup", engine.read(ks, "later").persistent());
            assertEquals(2L, new SqlEngine(engine, 1000).execute(ks, "SELECT COUNT(*) FROM t", null).rows().get(0)[0]);
        }
    }

    @Test
    void tamperedBackupFailsVerificationAndIsNotRestored() throws Exception {
        StorageConfig config = StorageConfig.defaults(dir.resolve("data")).withCheckpoint(0, 0);
        Path original;
        try (StorageEngine engine = new StorageEngine(config).open()) {
            engine.put(engine.keyspace("p"), "k", "v", true, true, 0);
            original = new BackupManager(engine, dir.resolve("backups"), null, null, 0, "test").create().path();
        }
        // rewrite the archive with one flipped byte in the snapshot
        Path tampered = dir.resolve("tampered.zip");
        try (ZipInputStream in = new ZipInputStream(Files.newInputStream(original));
             ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(tampered))) {
            ZipEntry entry;
            while ((entry = in.getNextEntry()) != null) {
                byte[] bytes = in.readAllBytes();
                if (entry.getName().equals("data/snapshot.dat")) {
                    bytes[bytes.length / 2] ^= 0x01;
                }
                out.putNextEntry(new ZipEntry(entry.getName()));
                out.write(bytes);
                out.closeEntry();
            }
        }
        BackupManager.Verification verification = BackupManager.verify(tampered);
        assertFalse(verification.ok());
        assertTrue(verification.problems().stream().anyMatch(p -> p.contains("checksum")), verification.problems().toString());
        assertThrows(java.io.IOException.class, () -> BackupManager.restore(tampered, dir.resolve("data"), null, null));
        assertTrue(Files.exists(dir.resolve("data/snapshot.dat")), "a refused restore leaves the data alone");
    }

    @Test
    void inMemoryServersCanBeBackedUpToo() throws Exception {
        try (StorageEngine engine = new StorageEngine(StorageConfig.inMemory()).open()) {
            engine.put(engine.keyspace("p"), "k", "v", true, true, 0);
            Path file = new BackupManager(engine, dir.resolve("backups"), null, null, 0, "test").create().path();
            assertTrue(BackupManager.verify(file).ok());
            assertEquals(2, BackupManager.verify(file).snapshotRecords());
        }
    }
}
