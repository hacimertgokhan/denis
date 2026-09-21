package github.hacimertgokhan.denis.cli;

import github.hacimertgokhan.denis.DenisClient;
import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.readers.DenisProperties;
import org.json.JSONArray;
import org.json.JSONObject;
import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Mixin;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;

/**
 * {@code denis cli ...} — management from the command line.
 *
 * <pre>
 *   group   create | list | test | delete      login groups in denis.toml (local files)
 *   token   list | create | delete             project tokens in ddb.json (local files)
 *   config                                     effective configuration and where each value comes from
 *   status                                     PING / INFO of a running server
 *   exec    "GET key" ["SET k v" ...]          run commands against a running server
 *   shell                                      interactive session with a running server
 * </pre>
 *
 * Connection options can also come from the environment:
 * {@code DENIS_HOST, DENIS_PORT, DENIS_GROUP, DENIS_PASSWORD, DENIS_TOKEN}.
 */
@Command(name = "denis cli", mixinStandardHelpOptions = true, versionProvider = DenisMan.Version.class,
        description = "Manage Denis Database: local files (groups, tokens, config) and a running server (status, exec, shell).",
        subcommands = {DenisMan.GroupCommand.class, DenisMan.TokenCommand.class, DenisMan.ConfigCommand.class,
                DenisMan.StatusCommand.class, DenisMan.ExecCommand.class, DenisMan.ShellCommand.class,
                CommandLine.HelpCommand.class})
public class DenisMan implements Runnable {

    @Override
    public void run() {
        CommandLine.usage(this, System.out);
    }

    static class Version implements CommandLine.IVersionProvider {
        @Override
        public String[] getVersion() {
            String version = DenisMan.class.getPackage().getImplementationVersion();
            return new String[]{"Denis Database " + (version == null ? "dev" : version)};
        }
    }

    /** Options shared by every command that talks to a running server. */
    static class Connection {
        @Option(names = {"-H", "--host"}, defaultValue = "${env:DENIS_HOST:-127.0.0.1}", description = "Server host (env DENIS_HOST, default ${DEFAULT-VALUE})")
        String host;
        @Option(names = {"-P", "--port"}, defaultValue = "${env:DENIS_PORT:-5142}", description = "Server port (env DENIS_PORT, default ${DEFAULT-VALUE})")
        int port;
        @Option(names = {"-g", "--group"}, defaultValue = "${env:DENIS_GROUP}", description = "Login group (env DENIS_GROUP)")
        String group;
        @Option(names = {"-p", "--password"}, defaultValue = "${env:DENIS_PASSWORD}", description = "Group password (env DENIS_PASSWORD)")
        String password;
        @Option(names = {"-t", "--token"}, defaultValue = "${env:DENIS_TOKEN}", description = "Project token (env DENIS_TOKEN)")
        String token;
        @Option(names = {"--create-project"}, description = "Create a new project with AUTH CREATE instead of --token")
        boolean createProject;
        @Option(names = {"--timeout"}, defaultValue = "10000", description = "Socket timeout in ms (default ${DEFAULT-VALUE})")
        int timeoutMillis;
        @Option(names = {"--json"}, description = "Print the server's raw JSON replies")
        boolean json;

        RemoteSession open(boolean needProject) throws IOException {
            RemoteSession session = new RemoteSession(host, port, timeoutMillis);
            try {
                if (group != null) {
                    if (password == null) {
                        throw new IOException("--password is required with --group");
                    }
                    session.login(group, password);
                }
                if (needProject || token != null || createProject) {
                    if (group == null) {
                        throw new IOException("--group and --password are required to select a project");
                    }
                    session.auth(createProject ? null : token);
                }
            } catch (IOException e) {
                session.close();
                throw e;
            }
            return session;
        }

        void print(JSONObject reply) {
            System.out.println(json ? reply.toString() : ReplyRenderer.render(reply));
        }
    }

    // ------------------------------------------------------------------ groups

    @Command(name = "group", description = "Manage login groups (LIN) in denis.toml.", mixinStandardHelpOptions = true)
    static class GroupCommand implements Callable<Integer> {
        @Parameters(index = "0", paramLabel = "<create|list|test|delete>", description = "Action")
        String action;
        @Parameters(index = "1", arity = "0..1", paramLabel = "<name>", description = "Group name")
        String name;
        @Parameters(index = "2", arity = "0..1", paramLabel = "<password>", description = "Password (test only)")
        String testPassword;
        @Option(names = {"-p", "--password"}, paramLabel = "<password>", description = "Password for create; generated when omitted")
        String password;
        @Option(names = {"--json"}, description = "Machine readable output")
        boolean json;

        @Override
        public Integer call() {
            GroupManager manager = new GroupManager();
            try {
                switch (action.toLowerCase(Locale.ROOT)) {
                    case "create" -> {
                        if (name == null) {
                            System.err.println("Usage: denis cli group create <name> [-p <password>] [--json]");
                            return 2;
                        }
                        GroupManager.CreatedGroup created = manager.create(name, password);
                        if (json) {
                            System.out.println(new JSONObject()
                                    .put("group", created.name())
                                    .put("password", created.password())
                                    .put("generated", created.generatedPassword()));
                        } else if (created.generatedPassword()) {
                            System.out.printf("Group %s created.%n # Password: %s%n", created.name(), created.password());
                        } else {
                            System.out.printf("Group %s created.%n", created.name());
                        }
                        return 0;
                    }
                    case "list" -> {
                        List<String> groups = manager.list();
                        if (json) {
                            System.out.println(new JSONArray(groups));
                        } else if (groups.isEmpty()) {
                            System.out.println("No groups found.");
                        } else {
                            groups.forEach(System.out::println);
                        }
                        return 0;
                    }
                    case "test" -> {
                        if (name == null || testPassword == null) {
                            System.err.println("Usage: denis cli group test <name> <password>");
                            return 2;
                        }
                        boolean ok = manager.verify(name, testPassword);
                        if (json) {
                            System.out.println(new JSONObject().put("group", name).put("ok", ok));
                        } else {
                            System.out.println(ok ? "Test successful." : "Login failed: unknown group or wrong password.");
                        }
                        return ok ? 0 : 1;
                    }
                    case "delete" -> {
                        if (name == null) {
                            System.err.println("Usage: denis cli group delete <name>");
                            return 2;
                        }
                        boolean deleted = manager.delete(name);
                        if (json) {
                            System.out.println(new JSONObject().put("group", name).put("deleted", deleted));
                        } else {
                            System.out.println(deleted ? "Group " + name + " deleted." : "Group not found: " + name);
                        }
                        return deleted ? 0 : 1;
                    }
                    default -> {
                        System.err.println("Unknown action: " + action + " (create|list|test|delete)");
                        return 2;
                    }
                }
            } catch (IllegalArgumentException | IllegalStateException e) {
                System.err.println(e.getMessage());
                return 1;
            } catch (IOException e) {
                System.err.println("Could not write denis.toml: " + e.getMessage());
                return 1;
            }
        }
    }

    // ------------------------------------------------------------------ tokens

    @Command(name = "token", description = "Manage project tokens (AUTH) in ddb.json.", mixinStandardHelpOptions = true)
    static class TokenCommand implements Callable<Integer> {
        @Parameters(index = "0", arity = "0..1", paramLabel = "<list|create|delete>", description = "Action")
        String action;
        @Parameters(index = "1", arity = "0..1", paramLabel = "<token>", description = "Token (delete only)")
        String token;
        @Option(names = {"-l"}, hidden = true)
        boolean legacyList;
        @Option(names = {"-c"}, hidden = true)
        boolean legacyCreate;
        @Option(names = {"--json"}, description = "Machine readable output")
        boolean json;

        @Override
        public Integer call() throws IOException {
            String verb = action != null ? action.toLowerCase(Locale.ROOT) : legacyCreate ? "create" : "list";
            ProjectRegistry registry = new ProjectRegistry("ddb.json");
            switch (verb) {
                case "list" -> {
                    List<String> tokens = registry.list();
                    if (json) {
                        System.out.println(new JSONArray(tokens));
                    } else if (tokens.isEmpty()) {
                        System.out.println("No tokens found.");
                    } else {
                        tokens.forEach(System.out::println);
                    }
                    return 0;
                }
                case "create" -> {
                    String created = registry.create();
                    System.out.println(json ? new JSONObject().put("token", created).toString() : created);
                    return 0;
                }
                case "delete" -> {
                    if (token == null) {
                        System.err.println("Usage: denis cli token delete <token>");
                        return 2;
                    }
                    boolean deleted = registry.delete(token);
                    if (json) {
                        System.out.println(new JSONObject().put("token", token).put("deleted", deleted));
                    } else {
                        System.out.println(deleted ? "Token deleted." : "Token not found.");
                    }
                    return deleted ? 0 : 1;
                }
                default -> {
                    System.err.println("Unknown action: " + verb + " (list|create|delete)");
                    return 2;
                }
            }
        }
    }

    // ------------------------------------------------------------------ config

    @Command(name = "config", description = "Show the effective configuration and where each value comes from.", mixinStandardHelpOptions = true)
    static class ConfigCommand implements Runnable {
        private static final String[] KEYS = {"ddb-port", "ddb-address", "bind-address", "ddb-main-token", "language",
                "max-connections", "max-connections-per-ip", "client-idle-timeout-ms", "persist-flush-interval-ms", "persist-snapshot-interval-ms",
                "send-client-actions", "use-delogg", "open-log-terminal", "bootstrap-group", "bootstrap-group-password"};

        @Option(names = {"--json"}, description = "Machine readable output")
        boolean json;

        @Override
        public void run() {
            DenisProperties properties = new DenisProperties();
            JSONObject all = new JSONObject();
            for (String key : KEYS) {
                String value = properties.getProperty(key);
                boolean secret = key.contains("token") || key.contains("password");
                String shown = value == null || value.isBlank() ? "" : secret ? "***" : value;
                String source = properties.isFromEnvironment(key) ? "env"
                        : value == null || value.isBlank() ? "unset" : "file";
                if (json) {
                    all.put(key, new JSONObject().put("value", shown).put("source", source));
                } else {
                    System.out.printf("%-28s %-40s (%s)%n", key, shown, source);
                }
            }
            if (json) {
                System.out.println(all.put("configFile", properties.getExternalPath().toAbsolutePath().toString()));
            } else {
                System.out.println("config file: " + properties.getExternalPath().toAbsolutePath());
            }
        }
    }

    // ------------------------------------------------------------------ status

    @Command(name = "status", description = "PING a running server; with --group/--password also show INFO.", mixinStandardHelpOptions = true)
    static class StatusCommand implements Callable<Integer> {
        @Mixin
        Connection connection;

        @Override
        public Integer call() {
            try (RemoteSession session = connection.open(false)) {
                JSONObject ping = session.send("PING");
                if (!ping.optBoolean("ok")) {
                    connection.print(ping);
                    return 1;
                }
                if (connection.group == null) {
                    connection.print(ping.put("message", "PONG from " + connection.host + ":" + connection.port));
                    return 0;
                }
                connection.print(session.send("INFO"));
                return 0;
            } catch (IOException e) {
                System.err.println("error: " + e.getMessage());
                return 1;
            }
        }
    }

    // -------------------------------------------------------------------- exec

    @Command(name = "exec", description = "Run one or more protocol commands against a running server.", mixinStandardHelpOptions = true)
    static class ExecCommand implements Callable<Integer> {
        @Mixin
        Connection connection;
        @Parameters(arity = "1..*", paramLabel = "<command>", description = "Protocol lines, e.g. \"SET greeting hello\" \"GET greeting\" \"SELECT * FROM users\"")
        List<String> commands;

        @Override
        public Integer call() {
            try (RemoteSession session = connection.open(true)) {
                int failed = 0;
                for (String command : commands) {
                    JSONObject reply = session.send(command);
                    if (!reply.optBoolean("ok")) {
                        failed++;
                    }
                    connection.print(reply);
                }
                return failed == 0 ? 0 : 1;
            } catch (IOException e) {
                System.err.println("error: " + e.getMessage());
                return 1;
            }
        }
    }

    // ------------------------------------------------------------------- shell

    @Command(name = "shell", description = "Interactive session with a running server (type .help for hints).", mixinStandardHelpOptions = true)
    static class ShellCommand implements Callable<Integer> {
        @Mixin
        Connection connection;

        @Override
        public Integer call() {
            try (RemoteSession session = connection.open(false)) {
                boolean loggedIn = connection.group != null;
                String project = session.token();
                System.out.println("Denis shell — connected to " + connection.host + ":" + connection.port
                        + (loggedIn ? " as " + connection.group : " (not logged in; use LIN <group> <password>)"));
                System.out.println("Type HELP for server commands, .help for shell hints, .exit to quit.");
                BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
                while (true) {
                    System.out.print(prompt(connection.group, project));
                    System.out.flush();
                    String line = in.readLine();
                    if (line == null) {
                        break;
                    }
                    line = line.trim();
                    if (line.isEmpty()) {
                        continue;
                    }
                    if (line.equals(".exit") || line.equalsIgnoreCase("EXIT") || line.equalsIgnoreCase("QUIT")) {
                        break;
                    }
                    if (line.equals(".help")) {
                        System.out.println(".exit         leave the shell\n.json on|off  raw JSON replies\n.commands     server command reference");
                        continue;
                    }
                    if (line.startsWith(".json")) {
                        connection.json = !line.endsWith("off");
                        System.out.println("json " + (connection.json ? "on" : "off"));
                        continue;
                    }
                    if (line.equals(".commands")) {
                        for (DenisClient.CommandDoc doc : DenisClient.COMMANDS) {
                            System.out.printf("%-56s %s%n", doc.usage(), doc.description());
                        }
                        continue;
                    }
                    JSONObject reply = session.send(line);
                    connection.print(reply);
                    String upper = line.toUpperCase(Locale.ROOT);
                    if (reply.optBoolean("ok") && upper.startsWith("AUTH ")) {
                        project = reply.has("token") ? project : line.substring(5).trim();
                    }
                }
                return 0;
            } catch (IOException e) {
                System.err.println("error: " + e.getMessage());
                return 1;
            }
        }

        private static String prompt(String group, String project) {
            StringBuilder p = new StringBuilder("denis");
            if (group != null) {
                p.append('[').append(group);
                if (project != null) {
                    p.append('/').append(project, 0, Math.min(8, project.length())).append('…');
                }
                p.append(']');
            }
            return p.append("> ").toString();
        }
    }
}
