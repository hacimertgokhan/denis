package github.hacimertgokhan.denis.storage;

import github.hacimertgokhan.denis.storage.wal.FsyncPolicy;

import java.nio.file.Path;
import java.util.Locale;

/**
 * Storage settings; see {@code denis.properties} for the user-facing keys.
 *
 * @param dataDir                  holds {@code snapshot.dat} and {@code wal/}
 * @param persistence              false keeps everything in memory only (no files at all)
 * @param fsync                    when the log is forced to disk
 * @param walSegmentBytes          size at which the log starts a new segment file
 * @param checkpointWalBytes       log volume that triggers a checkpoint (snapshot + log truncation)
 * @param checkpointIntervalMillis a checkpoint is also taken this often when anything changed; 0 = only by size
 * @param compressSnapshots        deflate snapshots (fast level; text-heavy data shrinks 3-10x)
 * @param maxMemoryBytes           upper bound for data held in memory; 0 = unlimited
 * @param eviction                 what happens at the memory limit
 * @param lenientRecovery          keep going past a damaged log segment instead of refusing to start
 * @param walQueueCapacity         records that may wait for the log writer before writers block
 * @param legacyDatabaseFile       Denis 0.0.x {@code database.bin} to import on first start, or null
 */
public record StorageConfig(Path dataDir, boolean persistence, FsyncPolicy fsync, long walSegmentBytes,
                            long checkpointWalBytes, long checkpointIntervalMillis, boolean compressSnapshots,
                            long maxMemoryBytes, Eviction eviction, boolean lenientRecovery, int walQueueCapacity,
                            Path legacyDatabaseFile) {

    /** Behaviour when {@code max-memory} is reached. */
    public enum Eviction {
        /** Refuse writes that need memory. */
        NOEVICTION,
        /** Evict cache-only keys, least recently used first (approximated by sampling). */
        CACHE_LRU;

        public static Eviction parse(String value) {
            if (value == null || value.isBlank()) {
                return CACHE_LRU;
            }
            return switch (value.trim().toLowerCase(Locale.ROOT).replace('_', '-')) {
                case "noeviction", "none", "no" -> NOEVICTION;
                case "cache-lru", "lru", "allkeys-lru", "volatile-lru" -> CACHE_LRU;
                default -> throw new IllegalArgumentException("eviction-policy must be noeviction or cache-lru: " + value);
            };
        }
    }

    /** In-memory only, for tests and embedded use. */
    public static StorageConfig inMemory() {
        return new StorageConfig(null, false, FsyncPolicy.NO, 0, 0, 0, false, 0, Eviction.CACHE_LRU, false, 1024, null);
    }

    /** Durable defaults under {@code dataDir}. */
    public static StorageConfig defaults(Path dataDir) {
        return new StorageConfig(dataDir, true, FsyncPolicy.EVERYSEC, 16L << 20, 64L << 20, 300_000, true,
                0, Eviction.CACHE_LRU, false, 16_384, null);
    }

    public StorageConfig withFsync(FsyncPolicy policy) {
        return new StorageConfig(dataDir, persistence, policy, walSegmentBytes, checkpointWalBytes, checkpointIntervalMillis,
                compressSnapshots, maxMemoryBytes, eviction, lenientRecovery, walQueueCapacity, legacyDatabaseFile);
    }

    public StorageConfig withMaxMemory(long bytes, Eviction policy) {
        return new StorageConfig(dataDir, persistence, fsync, walSegmentBytes, checkpointWalBytes, checkpointIntervalMillis,
                compressSnapshots, bytes, policy, lenientRecovery, walQueueCapacity, legacyDatabaseFile);
    }

    public StorageConfig withCheckpoint(long walBytes, long intervalMillis) {
        return new StorageConfig(dataDir, persistence, fsync, walSegmentBytes, walBytes, intervalMillis,
                compressSnapshots, maxMemoryBytes, eviction, lenientRecovery, walQueueCapacity, legacyDatabaseFile);
    }

    public StorageConfig withLegacyDatabase(Path file) {
        return new StorageConfig(dataDir, persistence, fsync, walSegmentBytes, checkpointWalBytes, checkpointIntervalMillis,
                compressSnapshots, maxMemoryBytes, eviction, lenientRecovery, walQueueCapacity, file);
    }

    public Path snapshotFile() {
        return dataDir.resolve("snapshot.dat");
    }

    public Path walDir() {
        return dataDir.resolve("wal");
    }

    /** Parses sizes such as {@code 512}, {@code 64kb}, {@code 16mb}, {@code 1g}. */
    public static long parseBytes(String value, long fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        String v = value.trim().toLowerCase(Locale.ROOT).replace("_", "");
        long unit = 1;
        if (v.endsWith("b")) {
            v = v.substring(0, v.length() - 1);
        }
        if (v.endsWith("k")) {
            unit = 1024;
        } else if (v.endsWith("m")) {
            unit = 1024 * 1024;
        } else if (v.endsWith("g")) {
            unit = 1024L * 1024 * 1024;
        }
        if (unit != 1) {
            v = v.substring(0, v.length() - 1);
        }
        try {
            return Math.round(Double.parseDouble(v.trim()) * unit);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Not a size: " + value + " (use e.g. 512kb, 64mb, 1g)");
        }
    }
}
