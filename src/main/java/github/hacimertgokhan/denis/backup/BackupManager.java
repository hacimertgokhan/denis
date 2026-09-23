package github.hacimertgokhan.denis.backup;

import github.hacimertgokhan.denis.storage.StorageEngine;
import github.hacimertgokhan.denis.storage.codec.MutationCodec;
import github.hacimertgokhan.denis.storage.snapshot.SnapshotFile;
import github.hacimertgokhan.denis.storage.wal.WriteAheadLog;
import github.hacimertgokhan.logger.DenisLogger;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Online, verifiable backups.
 *
 * <p>A backup is one zip file:
 * <pre>
 *   manifest.json        format, version, time, sha-256 and size of every other entry
 *   data/snapshot.dat    fresh snapshot (taken by a checkpoint, writers keep going)
 *   data/wal/*.log       log segments written since that snapshot
 *   denis.toml           login groups (password hashes only)
 *   ddb.json             project tokens and owners
 * </pre>
 * The snapshot plus the log segments restore to a single point in time (a
 * segment still being written is simply cut at its last complete record on
 * recovery). Backups are written to a temporary name and renamed when
 * complete, and old ones are pruned to {@code retention}.
 */
public final class BackupManager {
    private static final DenisLogger log = new DenisLogger(BackupManager.class);
    private static final DateTimeFormatter NAME = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS", Locale.ROOT).withZone(ZoneOffset.UTC);
    public static final int FORMAT = 1;

    private final StorageEngine engine;
    private final Path directory;
    private final Path groupsFile;
    private final Path projectsFile;
    private final int retention;
    private final String version;

    /** A backup file. */
    public record BackupInfo(String name, Path path, long bytes, String createdAt) {
        public JSONObject toJson() {
            return new JSONObject().put("name", name).put("path", path.toString()).put("bytes", bytes).put("createdAt", createdAt);
        }
    }

    /** Result of {@link #verify(Path)}. */
    public record Verification(boolean ok, List<String> problems, long snapshotRecords, long walRecords, JSONObject manifest) {}

    public BackupManager(StorageEngine engine, Path directory, Path groupsFile, Path projectsFile, int retention, String version) {
        this.engine = engine;
        this.directory = directory;
        this.groupsFile = groupsFile;
        this.projectsFile = projectsFile;
        this.retention = retention;
        this.version = version;
    }

    public Path directory() {
        return directory;
    }

    /** Take a backup now. Serialised: two concurrent calls produce two consecutive backups. */
    public synchronized BackupInfo create() throws IOException {
        Files.createDirectories(directory);
        Instant now = Instant.now();
        String name = "denis-" + NAME.format(now) + ".zip";
        Path target = directory.resolve(name);
        while (Files.exists(target)) {
            // names sort chronologically, which retention relies on
            now = now.plusMillis(1);
            name = "denis-" + NAME.format(now) + ".zip";
            target = directory.resolve(name);
        }
        Instant createdAt = now;
        Path tmp = directory.resolve(name + ".tmp");
        Path scratch = null;
        try {
            if (engine.config().persistence()) {
                // the checkpoint lock keeps the snapshot and its log segments in place while they are copied
                engine.checkpointThen(checkpoint -> {
                    List<Path> segments = new ArrayList<>();
                    for (long id : WriteAheadLog.listSegments(engine.config().walDir())) {
                        if (id >= checkpoint.walStartSegment()) {
                            segments.add(WriteAheadLog.segmentPath(engine.config().walDir(), id));
                        }
                    }
                    writeZip(tmp, checkpoint.snapshot(), segments, checkpoint.walStartSegment(), createdAt);
                    return null;
                });
            } else {
                scratch = Files.createTempFile(directory, "snapshot", ".dat");
                SnapshotFile.write(scratch, 0, true, engine::emitState);
                writeZip(tmp, scratch, List.of(), 0, createdAt);
            }
            try (var ch = java.nio.channels.FileChannel.open(tmp, java.nio.file.StandardOpenOption.WRITE)) {
                ch.force(true);
            }
            try {
                Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, target);
            }
        } catch (IOException | RuntimeException e) {
            Files.deleteIfExists(tmp);
            throw e;
        } finally {
            if (scratch != null) {
                Files.deleteIfExists(scratch);
            }
        }
        prune();
        BackupInfo info = new BackupInfo(name, target, Files.size(target), createdAt.toString());
        log.info("Backup created: " + target + " (" + info.bytes() + " bytes)");
        return info;
    }

    private void writeZip(Path tmp, Path snapshot, List<Path> segments, long walStart, Instant now) throws IOException {
        JSONArray files = new JSONArray();
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(tmp))) {
            // the snapshot is already deflated; the log compresses well
            zip.setLevel(Deflater.NO_COMPRESSION);
            files.put(add(zip, "data/snapshot.dat", snapshot));
            zip.setLevel(Deflater.BEST_SPEED);
            for (Path segment : segments) {
                files.put(add(zip, "data/wal/" + segment.getFileName(), segment));
            }
            if (groupsFile != null && Files.exists(groupsFile)) {
                files.put(add(zip, "denis.toml", groupsFile));
            }
            if (projectsFile != null && Files.exists(projectsFile)) {
                files.put(add(zip, "ddb.json", projectsFile));
            }
            JSONObject manifest = new JSONObject()
                    .put("format", FORMAT)
                    .put("server", "denis")
                    .put("version", version)
                    .put("createdAt", now.toString())
                    .put("walStart", walStart)
                    .put("files", files);
            zip.putNextEntry(new ZipEntry("manifest.json"));
            zip.write(manifest.toString(2).getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
    }

    private static JSONObject add(ZipOutputStream zip, String entryName, Path file) throws IOException {
        zip.putNextEntry(new ZipEntry(entryName));
        MessageDigest sha = sha256();
        long bytes = 0;
        try (InputStream in = new DigestInputStream(new BufferedInputStream(Files.newInputStream(file), 64 * 1024), sha)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) {
                zip.write(buffer, 0, n);
                bytes += n;
            }
        }
        zip.closeEntry();
        return new JSONObject().put("name", entryName).put("bytes", bytes).put("sha256", HexFormat.of().formatHex(sha.digest()));
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public List<BackupInfo> list() throws IOException {
        return list(directory);
    }

    public static List<BackupInfo> list(Path directory) throws IOException {
        List<BackupInfo> result = new ArrayList<>();
        if (!Files.isDirectory(directory)) {
            return result;
        }
        try (DirectoryStream<Path> files = Files.newDirectoryStream(directory, "denis-*.zip")) {
            for (Path file : files) {
                result.add(new BackupInfo(file.getFileName().toString(), file, Files.size(file),
                        Files.getLastModifiedTime(file).toInstant().toString()));
            }
        }
        result.sort((a, b) -> a.name().compareTo(b.name()));
        return result;
    }

    private void prune() throws IOException {
        if (retention <= 0) {
            return;
        }
        List<BackupInfo> all = list();
        for (int i = 0; i < all.size() - retention; i++) {
            Files.deleteIfExists(all.get(i).path());
            log.info("Old backup removed: " + all.get(i).name());
        }
    }

    // ------------------------------------------------------------------ verify / restore

    /** Check checksums and that the snapshot and log segments decode completely. */
    public static Verification verify(Path zipFile) throws IOException {
        List<String> problems = new ArrayList<>();
        Map<String, String> actual = new LinkedHashMap<>();
        JSONObject manifest = null;
        long snapshotRecords = 0;
        long walRecords = 0;
        Path work = Files.createTempDirectory("denis-verify");
        try {
            try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(zipFile))) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    String entryName = entry.getName();
                    if (entryName.equals("manifest.json")) {
                        manifest = new JSONObject(new String(zip.readAllBytes(), StandardCharsets.UTF_8));
                        continue;
                    }
                    Path out = safeResolve(work, entryName);
                    Files.createDirectories(out.getParent());
                    MessageDigest sha = sha256();
                    try (OutputStream o = Files.newOutputStream(out)) {
                        byte[] buffer = new byte[64 * 1024];
                        int n;
                        while ((n = zip.read(buffer)) > 0) {
                            sha.update(buffer, 0, n);
                            o.write(buffer, 0, n);
                        }
                    }
                    actual.put(entryName, HexFormat.of().formatHex(sha.digest()));
                }
            }
            if (manifest == null) {
                problems.add("manifest.json is missing");
                return new Verification(false, problems, 0, 0, null);
            }
            JSONArray files = manifest.optJSONArray("files");
            for (int i = 0; files != null && i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                String entryName = f.getString("name");
                String got = actual.get(entryName);
                if (got == null) {
                    problems.add(entryName + " is missing");
                } else if (!got.equalsIgnoreCase(f.getString("sha256"))) {
                    problems.add(entryName + " checksum mismatch");
                }
            }
            Path snapshot = work.resolve("data/snapshot.dat");
            if (Files.exists(snapshot)) {
                try {
                    snapshotRecords = SnapshotFile.read(snapshot, m -> { }).records();
                } catch (IOException e) {
                    problems.add("snapshot: " + e.getMessage());
                }
            } else {
                problems.add("data/snapshot.dat is missing");
            }
            Path walDir = work.resolve("data/wal");
            List<Long> segments = WriteAheadLog.listSegments(walDir);
            for (int i = 0; i < segments.size(); i++) {
                Path segment = WriteAheadLog.segmentPath(walDir, segments.get(i));
                try (InputStream in = new BufferedInputStream(Files.newInputStream(segment))) {
                    MutationCodec.RecordReader reader = new MutationCodec.RecordReader(in);
                    try {
                        while (reader.next() != null) {
                            walRecords++;
                        }
                    } catch (EOFException | RuntimeException e) {
                        if (i < segments.size() - 1) {
                            problems.add(segment.getFileName() + ": " + e.getMessage());
                        }
                    }
                }
            }
            return new Verification(problems.isEmpty(), problems, snapshotRecords, walRecords, manifest);
        } finally {
            deleteTree(work);
        }
    }

    /**
     * Restore a backup into an installation that is not running. The current
     * data directory and config files are moved aside (never deleted).
     *
     * @return the directory the previous state was moved to
     */
    public static Path restore(Path zipFile, Path dataDir, Path groupsFile, Path projectsFile) throws IOException {
        Verification verification = verify(zipFile);
        if (!verification.ok()) {
            throw new IOException("Backup failed verification: " + String.join("; ", verification.problems()));
        }
        Path base = dataDir.toAbsolutePath().getParent();
        Path aside = base.resolve("before-restore-" + NAME.format(Instant.now()));
        Files.createDirectories(aside);
        if (Files.exists(dataDir)) {
            Files.move(dataDir, aside.resolve(dataDir.getFileName()));
        }
        if (groupsFile != null && Files.exists(groupsFile)) {
            Files.copy(groupsFile, aside.resolve(groupsFile.getFileName()));
        }
        if (projectsFile != null && Files.exists(projectsFile)) {
            Files.copy(projectsFile, aside.resolve(projectsFile.getFileName()));
        }
        Files.createDirectories(dataDir.resolve("wal"));
        try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(zipFile))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String entryName = entry.getName();
                Path target;
                if (entryName.startsWith("data/")) {
                    target = safeResolve(dataDir, entryName.substring("data/".length()));
                } else if (entryName.equals("denis.toml") && groupsFile != null) {
                    target = groupsFile;
                } else if (entryName.equals("ddb.json") && projectsFile != null) {
                    target = projectsFile;
                } else {
                    continue;
                }
                Path parent = target.toAbsolutePath().getParent();
                if (parent != null) {
                    Files.createDirectories(parent);
                }
                Files.copy(zip, target, StandardCopyOption.REPLACE_EXISTING);
            }
        }
        return aside;
    }

    /** Resolve an archive entry below {@code root}, refusing "zip slip" paths. */
    private static Path safeResolve(Path root, String entryName) throws IOException {
        Path resolved = root.resolve(entryName).normalize();
        if (!resolved.startsWith(root.normalize())) {
            throw new IOException("Unsafe path in backup: " + entryName);
        }
        return resolved;
    }

    private static void deleteTree(Path root) {
        try (var walk = Files.walk(root)) {
            walk.sorted((a, b) -> b.getNameCount() - a.getNameCount()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException ignored) {
                    // best effort cleanup of a temp directory
                }
            });
        } catch (IOException ignored) {
            // nothing to clean up
        }
    }
}
