package github.hacimertgokhan.denis.cli;

import github.hacimertgokhan.denis.Version;
import github.hacimertgokhan.denis.backup.BackupManager;
import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.denis.security.PasswordHasher;
import github.hacimertgokhan.denis.server.ServerConfig;
import github.hacimertgokhan.denis.storage.StorageEngine;
import github.hacimertgokhan.denis.storage.codec.MutationCodec;
import github.hacimertgokhan.denis.storage.snapshot.SnapshotFile;
import github.hacimertgokhan.denis.storage.wal.WriteAheadLog;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.readers.DenisProperties;
import org.json.JSONArray;
import org.json.JSONObject;
import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;

/**
 * Management command line. Every command works on the files of the
 * installation in the working directory (or where {@code DENIS_CONFIG} points)
 * and, where it makes sense, talks to the running server instead.
 */
@Command(name = "denis", mixinStandardHelpOptions = true, versionProvider = DenisMan.VersionProvider.class,
        description = "Manage a Denis Database installation.",
        subcommands = {DenisMan.Init.class, DenisMan.GroupCommand.class, DenisMan.TokenCommand.class,
                DenisMan.BackupCommand.class, DenisMan.DbCommand.class, DenisMan.Exec.class, CommandLine.HelpCommand.class})
public class DenisMan implements Runnable {

    static final class VersionProvider implements CommandLine.IVersionProvider {
        @Override
        public String[] getVersion() {
            return new String[]{"Denis Database " + Version.get()};
        }
    }

    static ServerConfig config() {
        return ServerConfig.from(new DenisProperties());
    }

    /** Address a local CLI uses to reach the server of this installation. */
    static String localHost(ServerConfig config) {
        String bind = config.bindAddress();
        return bind.equals("0.0.0.0") || bind.equals("::") || bind.isBlank() ? "127.0.0.1" : bind;
    }

    /** Interactive shell: each line is one of the commands above. */
    @Override
    public void run() {
        System.out.println("Denis Database " + Version.get() + " management shell. Type 'help' for commands, 'exit' to leave.");
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        while (true) {
            System.out.print("denis> ");
            System.out.flush();
            String line;
            try {
                line = reader.readLine();
            } catch (IOException e) {
                return;
            }
            if (line == null || line.trim().equalsIgnoreCase("exit") || line.trim().equalsIgnoreCase("quit")
                    || line.trim().equalsIgnoreCase("--exit")) {
                return;
            }
            if (line.isBlank()) {
                continue;
            }
            List<String> words = tokenize(line);
            if (!words.isEmpty() && words.get(0).equals("denis")) {
                words.remove(0);
            }
            new CommandLine(new DenisMan()).execute(words.toArray(new String[0]));
        }
    }

    /** Split a shell line on spaces, honouring single and double quotes. */
    static List<String> tokenize(String line) {
        List<String> words = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        char quote = 0;
        boolean inWord = false;
        for (char c : line.toCharArray()) {
            if (quote != 0) {
                if (c == quote) {
                    quote = 0;
                } else {
                    current.append(c);
                }
            } else if (c == '"' || c == '\'') {
                quote = c;
                inWord = true;
            } else if (Character.isWhitespace(c)) {
                if (inWord) {
                    words.add(current.toString());
                    current.setLength(0);
                    inWord = false;
                }
            } else {
                current.append(c);
                inWord = true;
            }
        }
        if (inWord) {
            words.add(current.toString());
        }
        return words;
    }

    // =================================================================== init

    @Command(name = "init", mixinStandardHelpOptions = true,
            description = "Prepare this directory for a server: write denis.properties and create an admin group.")
    static final class Init implements Callable<Integer> {
        @Option(names = {"-g", "--group"}, defaultValue = "admin", description = "Admin group name (default: ${DEFAULT-VALUE})")
        String group;
        @Option(names = {"-p", "--password"}, description = "Admin password (generated when omitted)")
        String password;
        @Option(names = "--bind", description = "Address to listen on: 127.0.0.1 (local only) or 0.0.0.0 (all interfaces)")
        String bind;
        @Option(names = "--port", description = "TCP port")
        Integer port;
        @Option(names = "--data-dir", description = "Directory for the database files")
        String dataDir;
        @Option(names = "--profile", description = "Tuning preset: default, small (IoT / <512 MB RAM) or server")
        String profile;
        @Option(names = "--force", description = "Rewrite an existing denis.properties")
        boolean force;
        @Option(names = "--json", description = "Machine readable output")
        boolean json;

        @Override
        public Integer call() throws IOException {
            DenisProperties properties = new DenisProperties();
            Path configFile = properties.getExternalPath();
            Map<String, String> overrides = new LinkedHashMap<>();
            if (bind != null) {
                overrides.put("bind-address", bind);
            }
            if (port != null) {
                overrides.put("ddb-port", String.valueOf(port));
            }
            if (dataDir != null) {
                overrides.put("data-dir", dataDir);
            }
            if (profile != null) {
                switch (profile.toLowerCase(java.util.Locale.ROOT)) {
                    case "small", "iot" -> {
                        overrides.put("io-threads", "1");
                        overrides.put("worker-threads", "2");
                        overrides.put("max-clients", "256");
                        overrides.put("max-memory", "64mb");
                        overrides.put("wal-segment-size", "4mb");
                        overrides.put("checkpoint-wal-size", "16mb");
                        overrides.put("password-iterations", "60000");
                        overrides.put("max-result-rows", "20000");
                    }
                    case "server" -> {
                        overrides.put("io-threads", "0");
                        overrides.put("worker-threads", "0");
                        overrides.put("checkpoint-wal-size", "256mb");
                        overrides.put("wal-segment-size", "64mb");
                    }
                    case "default" -> {
                        // bundled defaults
                    }
                    default -> {
                        System.err.println("Unknown profile: " + profile + " (default, small, server)");
                        return 2;
                    }
                }
            }
            boolean wroteConfig = false;
            if (!Files.exists(configFile) || force) {
                writeConfig(configFile, overrides);
                wroteConfig = true;
            } else if (!overrides.isEmpty()) {
                for (Map.Entry<String, String> e : overrides.entrySet()) {
                    properties.setProperty(e.getKey(), e.getValue());
                }
            }
            ServerConfig config = config();
            GroupManager groups = new GroupManager(config.groupsFile(), new PasswordHasher(config.passwordIterations()));
            GroupManager.CreatedGroup created = null;
            if (!groups.exists(group)) {
                created = groups.create(group, password, true);
            }
            Files.createDirectories(config.storage().dataDir());
            if (json) {
                JSONObject out = new JSONObject()
                        .put("config", configFile.toAbsolutePath().toString())
                        .put("configWritten", wroteConfig)
                        .put("address", config.bindAddress() + ":" + config.port())
                        .put("group", group)
                        .put("groupCreated", created != null);
                if (created != null && created.generatedPassword()) {
                    out.put("password", created.password());
                }
                System.out.println(out);
                return 0;
            }
            System.out.println((wroteConfig ? "Wrote " : "Kept ") + configFile.toAbsolutePath());
            System.out.println("Data directory: " + config.storage().dataDir().toAbsolutePath());
            System.out.println("Listen address: " + config.bindAddress() + ":" + config.port());
            if (created != null) {
                System.out.println("Admin group '" + group + "' created.");
                if (created.generatedPassword()) {
                    System.out.println("  Password: " + created.password() + "   <- shown once, store it safely");
                }
            } else {
                System.out.println("Group '" + group + "' already exists; left unchanged.");
            }
            System.out.println();
            System.out.println("Next: run 'denis server', then connect with Denis Studio or a client using LIN " + group + " <password>.");
            return 0;
        }

        /** Copy the bundled, commented denis.properties and apply overrides in place. */
        static void writeConfig(Path file, Map<String, String> overrides) throws IOException {
            String template;
            try (InputStream in = DenisMan.class.getClassLoader().getResourceAsStream("denis.properties")) {
                template = in == null ? "" : new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
            StringBuilder out = new StringBuilder();
            Map<String, String> pending = new LinkedHashMap<>(overrides);
            for (String line : template.split("\n", -1)) {
                String trimmed = line.trim();
                int eq = trimmed.indexOf('=');
                if (!trimmed.startsWith("#") && eq > 0) {
                    String key = trimmed.substring(0, eq).trim();
                    if (pending.containsKey(key)) {
                        out.append(key).append('=').append(pending.remove(key)).append('\n');
                        continue;
                    }
                }
                out.append(line).append('\n');
            }
            pending.forEach((k, v) -> out.append(k).append('=').append(v).append('\n'));
            Path absolute = file.toAbsolutePath();
            if (absolute.getParent() != null) {
                Files.createDirectories(absolute.getParent());
            }
            Files.writeString(absolute, out.toString().replaceAll("\n+$", "\n"), StandardCharsets.UTF_8);
        }
    }

    // =================================================================== groups

    @Command(name = "group", mixinStandardHelpOptions = true, description = "Manage login groups (LIN).")
    static final class GroupCommand implements Callable<Integer> {
        @Parameters(index = "0", paramLabel = "<action>", description = "create | list | test | delete | passwd | grant | revoke")
        String action;
        @Parameters(index = "1", arity = "0..1", paramLabel = "<name>", description = "Group name")
        String name;
        @Parameters(index = "2", arity = "0..1", paramLabel = "<value>", description = "Password (test) or accessibility value (grant/revoke)")
        String value;
        @Option(names = {"-p", "--password"}, description = "Password for create/passwd; generated when omitted")
        String password;
        @Option(names = "--admin", description = "Create the group as an admin group")
        boolean admin;
        @Option(names = "--json", description = "Machine readable output")
        boolean json;

        @Override
        public Integer call() {
            ServerConfig config = config();
            GroupManager manager = new GroupManager(config.groupsFile(), new PasswordHasher(config.passwordIterations()));
            try {
                switch (action.toLowerCase(java.util.Locale.ROOT)) {
                    case "create" -> {
                        if (name == null) {
                            System.err.println("Usage: denis cli group create <name> [-p <password>] [--admin] [--json]");
                            return 2;
                        }
                        GroupManager.CreatedGroup created = manager.create(name, password, admin);
                        if (json) {
                            System.out.println(new JSONObject().put("group", created.name()).put("password", created.password())
                                    .put("generated", created.generatedPassword()).put("admin", admin));
                        } else if (created.generatedPassword()) {
                            System.out.printf("Group %s created%s.%n # Password: %s%n", created.name(), admin ? " (admin)" : "", created.password());
                        } else {
                            System.out.printf("Group %s created%s.%n", created.name(), admin ? " (admin)" : "");
                        }
                        return 0;
                    }
                    case "list" -> {
                        List<GroupManager.GroupInfo> groups = manager.groups();
                        if (json) {
                            JSONArray array = new JSONArray();
                            groups.forEach(g -> array.put(new JSONObject().put("group", g.name()).put("admin", g.admin())
                                    .put("accessibility", new JSONArray(g.accessibility()))));
                            System.out.println(array);
                        } else if (groups.isEmpty()) {
                            System.out.println("No groups found.");
                        } else {
                            groups.forEach(g -> System.out.println(g.name() + (g.admin() ? "  (admin)" : "")));
                        }
                        return 0;
                    }
                    case "test" -> {
                        if (name == null || value == null) {
                            System.err.println("Usage: denis cli group test <name> <password>");
                            return 2;
                        }
                        boolean ok = manager.login(name, value).ok();
                        if (json) {
                            System.out.println(new JSONObject().put("group", name).put("ok", ok));
                        } else {
                            System.out.println(ok ? "Test successful." : "Login failed: unknown group or wrong password.");
                        }
                        return ok ? 0 : 1;
                    }
                    case "delete" -> {
                        requireName();
                        boolean deleted = manager.delete(name);
                        System.out.println(deleted ? "Group " + name + " deleted." : "Group " + name + " not found.");
                        return deleted ? 0 : 1;
                    }
                    case "passwd" -> {
                        requireName();
                        String next = password == null ? PasswordHasher.newPassword() : password;
                        manager.setPassword(name, next);
                        System.out.println(password == null ? "New password for " + name + ": " + next : "Password of " + name + " changed.");
                        return 0;
                    }
                    case "grant", "revoke" -> {
                        requireName();
                        if (value == null) {
                            System.err.println("Usage: denis cli group " + action + " <name> <value>   (e.g. admin)");
                            return 2;
                        }
                        boolean changed = action.equalsIgnoreCase("grant") ? manager.grant(name, value) : manager.revoke(name, value);
                        System.out.println(changed ? "Done." : "Nothing to change.");
                        return 0;
                    }
                    default -> {
                        System.err.println("Unknown action: " + action + " (create|list|test|delete|passwd|grant|revoke)");
                        return 2;
                    }
                }
            } catch (IllegalArgumentException | IllegalStateException e) {
                System.err.println(e.getMessage());
                return 1;
            } catch (IOException e) {
                System.err.println("Could not write " + config.groupsFile() + ": " + e.getMessage());
                return 1;
            }
        }

        private void requireName() {
            if (name == null) {
                throw new IllegalArgumentException("Usage: denis cli group " + action + " <name>");
            }
        }
    }

    // =================================================================== tokens

    @Command(name = "token", mixinStandardHelpOptions = true, description = "Manage project tokens.")
    static final class TokenCommand implements Callable<Integer> {
        @Parameters(index = "0", arity = "0..1", paramLabel = "<action>", description = "list | create | delete")
        String action;
        @Parameters(index = "1", arity = "0..1", paramLabel = "<token>", description = "Token (delete)")
        String token;
        @Option(names = "-l", description = "List tokens (same as 'list')")
        boolean list;
        @Option(names = "-c", description = "Create a token (same as 'create')")
        boolean create;
        @Option(names = "-d", paramLabel = "<token>", description = "Delete a token")
        String delete;
        @Option(names = "--owner", description = "Owning group of a created token (default: none, usable by every group)")
        String owner;

        @Override
        public Integer call() throws IOException {
            ServerConfig config = config();
            ProjectRegistry registry = new ProjectRegistry(config.projectsFile());
            String act = action != null ? action : list ? "list" : create ? "create" : delete != null ? "delete" : "";
            switch (act) {
                case "list" -> {
                    List<ProjectRegistry.Project> projects = registry.list();
                    if (projects.isEmpty()) {
                        System.out.println("No tokens found.");
                    }
                    projects.forEach(p -> System.out.println(p.token() + (p.owner().isEmpty() ? "" : "  (owner: " + p.owner() + ")")));
                    return 0;
                }
                case "create" -> {
                    System.out.println(registry.create(owner));
                    return 0;
                }
                case "delete" -> {
                    String target = token != null ? token : delete;
                    if (target == null) {
                        System.err.println("Usage: denis cli token delete <token>");
                        return 2;
                    }
                    boolean removed = registry.delete(target);
                    System.out.println(removed ? "Token deleted. (Its data is removed when the server next runs AUTH DELETE, or stays until then.)"
                            : "Token not found.");
                    return removed ? 0 : 1;
                }
                default -> {
                    System.err.println("Usage: denis cli token <list|create|delete>");
                    return 2;
                }
            }
        }
    }

    // =================================================================== backups

    @Command(name = "backup", mixinStandardHelpOptions = true, description = "Create, list, verify and restore backups.")
    static final class BackupCommand implements Callable<Integer> {
        @Parameters(index = "0", paramLabel = "<action>", description = "create | list | verify | restore")
        String action;
        @Parameters(index = "1", arity = "0..1", paramLabel = "<file>", description = "Backup file (verify/restore)")
        String file;
        @Option(names = {"-g", "--group"}, description = "Admin group, when the server is running (env DENIS_GROUP)")
        String group;
        @Option(names = {"-p", "--password"}, description = "Its password (env DENIS_PASSWORD)")
        String password;
        @Option(names = "--yes", description = "Do not ask before restoring")
        boolean yes;

        @Override
        public Integer call() throws IOException {
            ServerConfig config = config();
            boolean running = RemoteClient.isServerRunning(localHost(config), config.port());
            switch (action.toLowerCase(java.util.Locale.ROOT)) {
                case "create" -> {
                    if (running) {
                        return remoteBackup(config);
                    }
                    DenisLogger.configure("warn", null);
                    try (StorageEngine engine = new StorageEngine(config.storage()).open()) {
                        BackupManager manager = new BackupManager(engine, config.backupDir(), config.groupsFile(),
                                config.projectsFile(), config.backupRetention(), Version.get());
                        BackupManager.BackupInfo info = manager.create();
                        System.out.println("Backup created: " + info.path().toAbsolutePath() + " (" + info.bytes() + " bytes)");
                    }
                    return 0;
                }
                case "list" -> {
                    List<BackupManager.BackupInfo> backups = BackupManager.list(config.backupDir());
                    if (backups.isEmpty()) {
                        System.out.println("No backups in " + config.backupDir().toAbsolutePath());
                    }
                    backups.forEach(b -> System.out.printf("%s  %,d bytes  %s%n", b.name(), b.bytes(), b.createdAt()));
                    return 0;
                }
                case "verify" -> {
                    Path zip = resolve(config);
                    BackupManager.Verification v = BackupManager.verify(zip);
                    if (v.ok()) {
                        System.out.printf("OK: %s (snapshot %d records, log %d records, created %s)%n", zip.getFileName(),
                                v.snapshotRecords(), v.walRecords(), v.manifest().optString("createdAt"));
                        return 0;
                    }
                    System.out.println("DAMAGED: " + zip.getFileName());
                    v.problems().forEach(p -> System.out.println("  - " + p));
                    return 1;
                }
                case "restore" -> {
                    if (running) {
                        System.err.println("Stop the server before restoring (it is answering on port " + config.port() + ").");
                        return 1;
                    }
                    Path zip = resolve(config);
                    if (!yes) {
                        System.out.print("Restore " + zip.getFileName() + "? The current data is moved aside, not deleted. [y/N] ");
                        String answer = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
                        if (answer == null || !answer.trim().toLowerCase(java.util.Locale.ROOT).startsWith("y")) {
                            System.out.println("Cancelled.");
                            return 1;
                        }
                    }
                    Path aside = BackupManager.restore(zip, config.storage().dataDir(), config.groupsFile(), config.projectsFile());
                    System.out.println("Restored. Previous state kept in " + aside.toAbsolutePath());
                    return 0;
                }
                default -> {
                    System.err.println("Unknown action: " + action + " (create|list|verify|restore)");
                    return 2;
                }
            }
        }

        private Path resolve(ServerConfig config) throws IOException {
            if (file == null) {
                throw new IOException("Name the backup file (see 'denis backup list')");
            }
            Path path = Paths.get(file);
            if (!Files.exists(path)) {
                path = config.backupDir().resolve(file);
            }
            if (!Files.exists(path)) {
                throw new IOException("Backup not found: " + file);
            }
            return path;
        }

        private int remoteBackup(ServerConfig config) throws IOException {
            String g = group != null ? group : System.getenv("DENIS_GROUP");
            String p = password != null ? password : System.getenv("DENIS_PASSWORD");
            if (g == null || p == null) {
                System.err.println("The server is running: give an admin group with -g/-p (or DENIS_GROUP/DENIS_PASSWORD) for an online backup.");
                return 2;
            }
            try (RemoteClient client = RemoteClient.connect(localHost(config), config.port(), 5000)) {
                client.login(g, p);
                JSONObject reply = client.call("BACKUP");
                if (!reply.optBoolean("ok")) {
                    System.err.println("Backup failed: " + reply.optString("error"));
                    return 1;
                }
                System.out.println("Backup created: " + reply.optString("path") + " (" + reply.optLong("bytes") + " bytes)");
                return 0;
            }
        }
    }

    // =================================================================== data directory

    @Command(name = "db", mixinStandardHelpOptions = true, description = "Check or compact the data directory.")
    static final class DbCommand implements Callable<Integer> {
        @Parameters(index = "0", paramLabel = "<action>", description = "verify | compact")
        String action;

        @Override
        public Integer call() throws IOException {
            ServerConfig config = config();
            Path dataDir = config.storage().dataDir();
            switch (action.toLowerCase(java.util.Locale.ROOT)) {
                case "verify" -> {
                    boolean ok = true;
                    Path snapshot = config.storage().snapshotFile();
                    if (Files.exists(snapshot)) {
                        try {
                            SnapshotFile.Info info = SnapshotFile.read(snapshot, m -> { });
                            System.out.printf("snapshot.dat: OK, %d records, %,d bytes, log from segment %d%n",
                                    info.records(), info.fileBytes(), info.walStart());
                        } catch (IOException e) {
                            System.out.println("snapshot.dat: DAMAGED - " + e.getMessage());
                            ok = false;
                        }
                    } else {
                        System.out.println("snapshot.dat: none yet");
                    }
                    List<Long> segments = WriteAheadLog.listSegments(config.storage().walDir());
                    for (int i = 0; i < segments.size(); i++) {
                        Path segment = WriteAheadLog.segmentPath(config.storage().walDir(), segments.get(i));
                        long records = 0;
                        String problem = null;
                        try (InputStream in = new BufferedInputStream(Files.newInputStream(segment))) {
                            MutationCodec.RecordReader reader = new MutationCodec.RecordReader(in);
                            try {
                                while (reader.next() != null) {
                                    records++;
                                }
                            } catch (EOFException | RuntimeException e) {
                                problem = e.getMessage();
                            }
                        }
                        boolean last = i == segments.size() - 1;
                        if (problem == null) {
                            System.out.printf("%s: OK, %d records%n", segment.getFileName(), records);
                        } else if (last) {
                            System.out.printf("%s: %d records, incomplete last record (normal after a crash; cut on next start)%n",
                                    segment.getFileName(), records);
                        } else {
                            System.out.printf("%s: DAMAGED after %d records - %s%n", segment.getFileName(), records, problem);
                            ok = false;
                        }
                    }
                    System.out.println(ok ? "Data directory " + dataDir.toAbsolutePath() + " is consistent."
                            : "Problems found. Restore a backup, or start once with recovery=lenient.");
                    return ok ? 0 : 1;
                }
                case "compact" -> {
                    if (RemoteClient.isServerRunning(localHost(config), config.port())) {
                        System.err.println("The server is running; it compacts by itself (or send SAVE as an admin).");
                        return 1;
                    }
                    DenisLogger.configure("warn", null);
                    try (StorageEngine engine = new StorageEngine(config.storage()).open()) {
                        StorageEngine.CheckpointInfo info = engine.checkpoint();
                        System.out.printf("Compacted: snapshot %,d bytes, %d records, log reset.%n", info.bytes(), info.records());
                    }
                    return 0;
                }
                default -> {
                    System.err.println("Unknown action: " + action + " (verify|compact)");
                    return 2;
                }
            }
        }
    }

    // =================================================================== remote commands

    @Command(name = "exec", mixinStandardHelpOptions = true,
            description = "Send commands to the running server, e.g. denis cli exec -g admin -p secret INFO")
    static final class Exec implements Callable<Integer> {
        @Option(names = {"-g", "--group"}, description = "Group (env DENIS_GROUP)")
        String group;
        @Option(names = {"-p", "--password"}, description = "Password (env DENIS_PASSWORD)")
        String password;
        @Option(names = {"-t", "--token"}, description = "Project token to AUTH with first")
        String token;
        @Option(names = {"-H", "--host"}, description = "Server host (default: this installation)")
        String host;
        @Option(names = "--port", description = "Server port (default: this installation)")
        Integer port;
        @Parameters(paramLabel = "<command>", description = "Commands, one per argument (quote commands with spaces)")
        List<String> commands = new ArrayList<>();

        @Override
        public Integer call() throws IOException {
            ServerConfig config = config();
            String g = group != null ? group : System.getenv("DENIS_GROUP");
            String p = password != null ? password : System.getenv("DENIS_PASSWORD");
            try (RemoteClient client = RemoteClient.connect(host != null ? host : localHost(config),
                    port != null ? port : config.port(), 5000)) {
                if (g != null && p != null) {
                    client.login(g, p);
                }
                if (token != null) {
                    JSONObject auth = client.call("AUTH " + token);
                    if (!auth.optBoolean("ok")) {
                        System.err.println(auth.optString("error"));
                        return 1;
                    }
                }
                int status = 0;
                for (String command : commands) {
                    String reply = client.callRaw(command);
                    System.out.println(reply);
                    if (reply.startsWith("{\"ok\":false")) {
                        status = 1;
                    }
                }
                return status;
            }
        }
    }
}
