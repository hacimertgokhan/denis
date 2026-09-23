package github.hacimertgokhan;

import github.hacimertgokhan.denis.CreateSecureToken;
import github.hacimertgokhan.denis.Version;
import github.hacimertgokhan.denis.backup.BackupManager;
import github.hacimertgokhan.denis.cli.CLIMain;
import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.denis.security.LoginGuard;
import github.hacimertgokhan.denis.security.PasswordHasher;
import github.hacimertgokhan.denis.server.DenisServer;
import github.hacimertgokhan.denis.server.ServerConfig;
import github.hacimertgokhan.denis.server.ServerContext;
import github.hacimertgokhan.denis.server.ServerMetrics;
import github.hacimertgokhan.denis.sql.SqlEngine;
import github.hacimertgokhan.denis.storage.StorageEngine;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.readers.DenisProperties;

import java.io.IOException;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Entry point: {@code denis server}, {@code denis cli ...}, {@code denis init}, {@code denis --version}. */
public class Main {

    public static void main(String[] args) {
        if (args.length > 0) {
            String command = args[0].toLowerCase(Locale.ROOT);
            switch (command) {
                case "cli", "shell", "tools" -> {
                    CLIMain.main(Arrays.copyOfRange(args, 1, args.length));
                    return;
                }
                case "init", "backup", "db", "group", "token" -> {
                    CLIMain.main(args);
                    return;
                }
                case "server", "start" -> {
                    exitOnError(runServer());
                    return;
                }
                case "--version", "version", "-v" -> {
                    System.out.println("Denis Database " + Version.get());
                    return;
                }
                case "--help", "help", "-h" -> {
                    printUsage();
                    return;
                }
                default -> {
                    System.err.println("Unknown command: " + args[0]);
                    printUsage();
                    System.exit(2);
                }
            }
        }
        exitOnError(runServer());
    }

    /** A clean stop returns normally (the JVM is already shutting down); failures exit non-zero. */
    private static void exitOnError(int code) {
        if (code != 0) {
            System.exit(code);
        }
    }

    private static void printUsage() {
        System.out.println("Denis Database " + Version.get());
        System.out.println("Usage:");
        System.out.println("  denis init                 Create a configuration and an admin group (first run)");
        System.out.println("  denis server               Start the database server");
        System.out.println("  denis backup <create|list|verify|restore>");
        System.out.println("  denis db <verify|compact>  Offline checks of the data directory");
        System.out.println("  denis cli [--help]         Management commands (groups, tokens, interactive shell)");
        System.out.println("  denis --version            Show version");
    }

    /** Start the server and block until it is stopped. @return process exit code */
    public static int runServer() {
        DenisProperties properties = new DenisProperties();
        String logFile = properties.getProperty("log-file", "logs/denis.log");
        DenisLogger.configure(properties.getProperty("log-level", "info"),
                logFile.isBlank() || logFile.equalsIgnoreCase("none") ? null : properties.home().resolve(logFile).toString());
        DenisLogger log = new DenisLogger(Main.class);
        ServerConfig config;
        try {
            config = ServerConfig.from(properties);
        } catch (IllegalArgumentException e) {
            log.error("Invalid configuration: " + e.getMessage());
            return 2;
        }
        String mainToken = config.mainToken();
        if (mainToken == null || mainToken.isBlank()) {
            // ADMIN commands need a main token; generated once and kept in denis.properties, never logged
            mainToken = new CreateSecureToken().getToken();
            properties.setProperty("ddb-main-token", mainToken);
            config = config.withMainToken(mainToken);
            log.info("Generated the main token for ADMIN commands (ddb-main-token in " + properties.getExternalPath().toAbsolutePath() + ")");
        } else if (mainToken.length() < 32) {
            log.warn("ddb-main-token is shorter than 32 characters; ADMIN commands are only as safe as this token");
        }
        log.info("Denis Database " + Version.get() + " starting (Java " + System.getProperty("java.version") + ", "
                + Runtime.getRuntime().availableProcessors() + " cpus, heap max " + (Runtime.getRuntime().maxMemory() >> 20) + " MB)");

        StorageEngine storage = new StorageEngine(config.storage());
        try {
            storage.open();
        } catch (IOException | RuntimeException e) {
            log.error("Cannot open the data directory " + config.storage().dataDir().toAbsolutePath() + ": " + e.getMessage());
            return 1;
        }
        StorageEngine.RecoveryInfo recovery = storage.recoveryInfo();
        if (config.storage().persistence()) {
            log.info(String.format("Data directory %s: %d snapshot records, %d log records in %d segment(s), recovered in %d ms%s",
                    config.storage().dataDir().toAbsolutePath(), recovery.snapshotRecords(), recovery.walRecords(),
                    recovery.walSegments(), recovery.millis(),
                    recovery.truncatedBytes() > 0 ? " (" + recovery.truncatedBytes() + " bytes of an interrupted write discarded)" : ""));
            log.info("Durability: fsync=" + config.storage().fsync().configName()
                    + ", checkpoint every " + (config.storage().checkpointWalBytes() >> 20) + " MB of log or "
                    + config.storage().checkpointIntervalMillis() / 1000 + " s");
        } else {
            log.warn("Persistence is off: all data lives in memory and is lost on restart");
        }
        if (config.storage().maxMemoryBytes() > 0) {
            log.info("Memory limit: " + (config.storage().maxMemoryBytes() >> 20) + " MB, eviction " + config.storage().eviction());
        }

        GroupManager groups = new GroupManager(config.groupsFile(), new PasswordHasher(config.passwordIterations()));
        ProjectRegistry projects = new ProjectRegistry(config.projectsFile());
        bootstrapGroup(properties, groups, log);
        long orphaned = storage.keyspaces().stream().filter(ks -> !projects.exists(ks.name())).count();
        if (orphaned > 0) {
            // data is never deleted automatically: a missing or replaced ddb.json must not wipe projects
            log.warn(orphaned + " project(s) in the data directory have no token in " + config.projectsFile()
                    + "; restore the file or re-create the tokens to reach their data");
        }
        if (groups.list().isEmpty()) {
            log.warn("No login group exists yet. Run 'denis init' (or 'denis cli group create <name> --admin') to create one.");
        }

        AtomicInteger workerId = new AtomicInteger();
        ThreadPoolExecutor workers = new ThreadPoolExecutor(config.workerThreads(), config.workerThreads(), 60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(config.workerQueue()), r -> {
            Thread t = new Thread(r, "denis-worker-" + workerId.incrementAndGet());
            t.setDaemon(true);
            return t;
        });
        workers.allowCoreThreadTimeOut(true);

        BackupManager backups = new BackupManager(storage, config.backupDir(), config.groupsFile(), config.projectsFile(),
                config.backupRetention(), Version.get());
        ServerMetrics metrics = new ServerMetrics();
        ServerContext context = new ServerContext(config, storage, new SqlEngine(storage, config.maxResultRows()), groups, projects,
                backups, new LoginGuard(config.loginMaxFailures(), config.loginLockoutSeconds() * 1000L), metrics, workers, Version.get());

        DenisServer server = new DenisServer(config, context);
        try {
            server.start();
        } catch (IOException e) {
            log.error("Cannot listen on " + config.bindAddress() + ":" + config.port() + ": " + e.getMessage()
                    + " (is another server running on this port?)");
            storage.close();
            return 1;
        }
        log.info("Listening on " + server.address() + " (" + config.ioThreads() + " io thread(s), "
                + config.workerThreads() + " worker thread(s))");
        if (config.bindAddress().equals("127.0.0.1") || config.bindAddress().equals("localhost")) {
            log.info("Only local clients can connect; set bind-address=0.0.0.0 (DENIS_BIND_ADDRESS) to accept remote connections");
        }

        ScheduledExecutorService scheduler = null;
        if (config.backupIntervalMinutes() > 0) {
            scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "denis-backup");
                t.setDaemon(true);
                return t;
            });
            scheduler.scheduleWithFixedDelay(() -> {
                try {
                    backups.create();
                } catch (IOException | RuntimeException e) {
                    log.error("Scheduled backup failed: " + e.getMessage());
                }
            }, config.backupIntervalMinutes(), config.backupIntervalMinutes(), TimeUnit.MINUTES);
            log.info("Backups every " + config.backupIntervalMinutes() + " min to " + config.backupDir().toAbsolutePath()
                    + " (keeping " + config.backupRetention() + ")");
        }

        CountDownLatch stopped = new CountDownLatch(1);
        ScheduledExecutorService backupScheduler = scheduler;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            log.info("Shutting down...");
            server.close();
            if (backupScheduler != null) {
                backupScheduler.shutdownNow();
            }
            workers.shutdown();
            try {
                workers.awaitTermination(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            storage.close();
            log.info("Denis stopped");
            stopped.countDown();
        }, "denis-shutdown"));
        try {
            stopped.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return 0;
    }

    /**
     * Non-interactive provisioning: with {@code DENIS_BOOTSTRAP_GROUP} and
     * {@code DENIS_BOOTSTRAP_GROUP_PASSWORD} set (or the same keys in
     * denis.properties), the group is created as an admin group on first start
     * so a fresh container accepts {@code LIN} right away. An existing group is
     * left alone.
     */
    private static void bootstrapGroup(DenisProperties properties, GroupManager groups, DenisLogger log) {
        String group = properties.getProperty("bootstrap-group");
        if (group == null || group.isBlank()) {
            return;
        }
        String password = properties.getProperty("bootstrap-group-password");
        if (password == null || password.isBlank()) {
            log.error("bootstrap-group is set but bootstrap-group-password is empty; group not created.");
            return;
        }
        try {
            if (groups.ensure(group, password, true)) {
                log.info("Bootstrap group created: " + group + " (admin)");
            } else if (groups.find(group) != null && !groups.find(group).admin()) {
                // groups made by 0.3-0.6 predate admin roles; the bootstrap group is the operator's
                groups.grant(group, GroupManager.ADMIN);
                log.info("Bootstrap group " + group + " is now an admin group");
            } else {
                log.info("Bootstrap group already exists: " + group);
            }
        } catch (IOException | RuntimeException e) {
            log.error("Bootstrap group could not be created: " + e.getMessage());
        }
    }
}
