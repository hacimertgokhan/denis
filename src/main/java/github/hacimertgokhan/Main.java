package github.hacimertgokhan;

import github.hacimertgokhan.denis.CreateSecureToken;
import github.hacimertgokhan.denis.DenisTerminal;
import github.hacimertgokhan.denis.cli.CLIMain;
import github.hacimertgokhan.denis.fingerprint.PawdStore;
import github.hacimertgokhan.denis.language.DenisLanguage;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.denis.server.DenisServer;
import github.hacimertgokhan.denis.server.ServerContext;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.readers.DenisProperties;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;

/**
 * Entry point: {@code denis server} starts the database, {@code denis cli ...}
 * runs the management CLI. Without arguments the server starts.
 */
public class Main {
    // Created lazily so the CLI can lower the log level before log4j initialises.
    private static DenisLogger log;

    public static void main(String[] args) {
        if (args.length > 0) {
            String command = args[0].toLowerCase(Locale.ROOT);
            switch (command) {
                case "cli", "shell", "tools" -> {
                    CLIMain.main(Arrays.copyOfRange(args, 1, args.length));
                    return;
                }
                case "server", "start" -> {
                    startServer();
                    return;
                }
                case "--version", "version", "-v" -> {
                    System.out.println("Denis Database " + getVersion());
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
        startServer();
    }

    private static void startServer() {
        log = new DenisLogger(Main.class);
        DenisProperties properties = new DenisProperties();
        int port = properties.getInt("ddb-port", 5142);
        String host = properties.getProperty("ddb-address", "localhost");
        boolean details = properties.getBoolean("start-with-details", false);
        boolean delogg = properties.getBoolean("use-delogg", false);
        boolean openLogWindow = properties.getBoolean("open-log-terminal", false);

        DenisLanguage language = new DenisLanguage();
        try {
            for (String s : language.getLanguageFile().getList("startup-information")) {
                log.info(s);
            }
            if (details) {
                for (String s : language.getLanguageFile().getList("startup-swd")) {
                    log.info(s.replace("<host>", host).replace("<port>", String.valueOf(port)));
                }
            }
        } catch (IOException e) {
            log.warn("Language file could not be read: " + e.getMessage());
        }

        log.info("Checking pawd.dat file.");
        new PawdStore().loadFromFile();
        bootstrapGroup(properties);

        String token = resolveMainToken(properties);
        try {
            for (String s : language.getLanguageFile().getList("startup-port-and-token-information")) {
                log.info(s.replace("<port>", String.valueOf(port))
                        .replace("<token>", properties.isFromEnvironment("ddb-main-token") ? "(from environment)" : token));
            }
        } catch (IOException e) {
            log.warn("Language file could not be read: " + e.getMessage());
        }

        DenisTerminal activityLog = new DenisTerminal(openLogWindow);
        activityLog.startLogTerminal(null);
        activityLog.writeLog(String.format("Denis %s started at %s", getVersion(), new Date().toString().toLowerCase(Locale.ROOT)));

        DenisServer.Options options = new DenisServer.Options(
                properties.getProperty("bind-address", "0.0.0.0"),
                port,
                properties.getInt("max-connections", 256),
                properties.getInt("max-connections-per-ip", 12),
                properties.getInt("client-idle-timeout-ms", 0));
        long flushInterval = properties.getInt("persist-flush-interval-ms", (int) github.hacimertgokhan.proto.ProtoDatabase.DEFAULT_FLUSH_INTERVAL_MILLIS);

        ServerContext ctx;
        try {
            ctx = ServerContext.open(Path.of(""), flushInterval, delogg ? activityLog : null);
        } catch (IOException e) {
            log.error("Could not open the data files: " + e.getMessage());
            System.exit(1);
            return;
        }
        DenisServer server = new DenisServer(ctx, options);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop();
            activityLog.writeLog(String.format("Denis stopped at %s", new Date().toString().toLowerCase(Locale.ROOT)));
            activityLog.closeLogTerminal();
        }, "denis-shutdown"));
        try {
            server.start();
        } catch (IOException e) {
            log.error("Could not listen on port " + port + ": " + e.getMessage());
            System.exit(1);
            return;
        }
        log.info("Denis " + getVersion() + " ready. Waiting for client connections.");
        server.serve();
    }

    /**
     * Non-interactive provisioning: with {@code DENIS_BOOTSTRAP_GROUP} and
     * {@code DENIS_BOOTSTRAP_GROUP_PASSWORD} set (or the same keys in
     * denis.properties), the group is created on first start so a fresh
     * container accepts {@code LIN} right away. An existing group is left alone.
     */
    private static void bootstrapGroup(DenisProperties properties) {
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
            if (new GroupManager().ensure(group, password)) {
                log.info("Bootstrap group created: " + group);
            } else {
                log.info("Bootstrap group already exists: " + group);
            }
        } catch (IOException | RuntimeException e) {
            log.error("Bootstrap group could not be created: " + e.getMessage());
        }
    }

    private static String resolveMainToken(DenisProperties properties) {
        String token = properties.getProperty("ddb-main-token");
        if (token != null && token.length() == 128) {
            return token;
        }
        if (token != null && !token.isBlank()) {
            log.warn("ddb-main-token must be exactly 128 characters; the configured value is ignored and a new token is generated.");
        }
        String generated = new CreateSecureToken().getToken();
        properties.setProperty("ddb-main-token", generated);
        return generated;
    }

    private static void printUsage() {
        System.out.println("Denis Database " + getVersion());
        System.out.println("Usage:");
        System.out.println("  denis server        Start database server");
        System.out.println("  denis cli           Management CLI (groups, tokens, status, exec, shell)");
        System.out.println("  denis cli --help    Show CLI commands");
        System.out.println("  denis --version     Show version");
    }

    public static String getVersion() {
        String version = Main.class.getPackage().getImplementationVersion();
        return version == null ? "dev" : version;
    }
}
