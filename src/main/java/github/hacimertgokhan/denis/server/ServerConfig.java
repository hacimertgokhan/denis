package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.storage.StorageConfig;
import github.hacimertgokhan.denis.storage.wal.FsyncPolicy;
import github.hacimertgokhan.readers.DenisProperties;

import java.nio.file.Path;

/**
 * Everything the server needs from {@code denis.properties} / the environment,
 * parsed and validated once at start-up. Relative paths are resolved against
 * {@code DENIS_HOME} (see {@link DenisProperties#home()}). See the bundled
 * {@code denis.properties} for documentation of every key.
 */
public record ServerConfig(
        String bindAddress,
        int port,
        int maxClients,
        int maxConnectionsPerIp,
        int maxLineBytes,
        int ioThreads,
        int workerThreads,
        int workerQueue,
        int clientTimeoutSeconds,
        long outputBufferLimit,
        boolean logCommands,
        int loginMaxFailures,
        int loginLockoutSeconds,
        int passwordIterations,
        boolean enforceOwnership,
        int maxResultRows,
        int keysLimit,
        Path groupsFile,
        Path projectsFile,
        Path backupDir,
        int backupIntervalMinutes,
        int backupRetention,
        StorageConfig storage,
        String mainToken) {

    public static ServerConfig from(DenisProperties p) {
        int cores = Runtime.getRuntime().availableProcessors();
        Path dataDir = p.path("data-dir", "data");
        // keys of Denis 0.3-0.5 keep working: an upgraded container or .env needs no changes.
        // They are not in the bundled defaults, so they are only present when someone set them.
        long flushMs = p.getInt("persist-flush-interval-ms", -1);
        String fsync = p.getProperty("fsync");
        if (flushMs >= 0) {
            fsync = flushMs == 0 ? "always" : "everysec";
        }
        int snapshotMs = p.getInt("persist-snapshot-interval-ms", -1);
        int idleMs = p.getInt("client-idle-timeout-ms", -1);
        int legacyMaxConnections = p.getInt("max-connections", -1);
        boolean persistence = !p.getProperty("persistence", "on").trim().equalsIgnoreCase("off")
                && !p.getProperty("persistence", "on").trim().equalsIgnoreCase("false");
        StorageConfig storage = new StorageConfig(
                dataDir,
                persistence,
                FsyncPolicy.parse(fsync == null || fsync.isBlank() ? "everysec" : fsync),
                StorageConfig.parseBytes(p.getProperty("wal-segment-size"), 16L << 20),
                StorageConfig.parseBytes(p.getProperty("checkpoint-wal-size"), 64L << 20),
                snapshotMs > 0
                        ? snapshotMs : p.getInt("checkpoint-interval-seconds", 300) * 1000L,
                p.getBoolean("snapshot-compression", true),
                StorageConfig.parseBytes(p.getProperty("max-memory"), 0),
                StorageConfig.Eviction.parse(p.getProperty("eviction-policy", "cache-lru")),
                p.getProperty("recovery", "strict").trim().equalsIgnoreCase("lenient"),
                p.getInt("wal-queue-size", 16_384),
                p.path("legacy-database-file", "database.bin"));

        int io = p.getInt("io-threads", 0);
        int workers = p.getInt("worker-threads", 0);
        String backupDir = p.getProperty("backup-dir", "");
        return new ServerConfig(
                p.getProperty("bind-address", "127.0.0.1").trim(),
                require(p.getInt("ddb-port", 5142), 0, 65535, "ddb-port"),
                Math.max(1, legacyMaxConnections > 0
                        ? legacyMaxConnections : p.getInt("max-clients", 10_000)),
                Math.max(1, p.getInt("max-connections-per-ip", 64)),
                (int) Math.min(Integer.MAX_VALUE - 1024, StorageConfig.parseBytes(p.getProperty("max-line-size"), 8L << 20)),
                // measured: one loop per two cores up to 8 (more loops add contention, not throughput)
                io > 0 ? io : Math.max(1, Math.min(cores / 2, 8)),
                workers > 0 ? workers : Math.max(2, Math.min(cores, 8)),
                Math.max(16, p.getInt("worker-queue-size", 1024)),
                Math.max(0, idleMs > 0
                        ? Math.max(1, idleMs / 1000) : p.getInt("client-timeout-seconds", 0)),
                StorageConfig.parseBytes(p.getProperty("client-output-limit"), 64L << 20),
                p.getBoolean("send-client-actions", false),
                p.getInt("login-max-failures", 10),
                Math.max(1, p.getInt("login-lockout-seconds", 60)),
                p.getInt("password-iterations", 210_000),
                p.getBoolean("enforce-project-ownership", true),
                p.getInt("max-result-rows", 100_000),
                Math.max(1, p.getInt("keys-limit", 100_000)),
                p.path("groups-file", "denis.toml"),
                p.path("projects-file", "ddb.json"),
                backupDir.isBlank() ? dataDir.resolve("backups") : p.home().resolve(backupDir),
                Math.max(0, p.getInt("backup-interval-minutes", 0)),
                Math.max(0, p.getInt("backup-retention", 7)),
                storage,
                p.getProperty("ddb-main-token", ""));
    }

    public ServerConfig withMainToken(String token) {
        return new ServerConfig(bindAddress, port, maxClients, maxConnectionsPerIp, maxLineBytes, ioThreads, workerThreads,
                workerQueue, clientTimeoutSeconds, outputBufferLimit, logCommands, loginMaxFailures, loginLockoutSeconds,
                passwordIterations, enforceOwnership, maxResultRows, keysLimit, groupsFile, projectsFile, backupDir,
                backupIntervalMinutes, backupRetention, storage, token);
    }

    private static int require(int value, int min, int max, String key) {
        if (value < min || value > max) {
            throw new IllegalArgumentException(key + " must be between " + min + " and " + max + ", got " + value);
        }
        return value;
    }
}
