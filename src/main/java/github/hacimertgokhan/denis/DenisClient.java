package github.hacimertgokhan.denis;

import github.hacimertgokhan.denis.client.ClientStates;
import github.hacimertgokhan.denis.server.ProjectStore;
import github.hacimertgokhan.denis.server.ServerContext;
import github.hacimertgokhan.denis.sql.SqlQueryEngine;
import github.hacimertgokhan.denis.sql.SqlResult;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.readers.DenisProperties;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * One TCP client session. The wire protocol is line based: one line in, one
 * line out. In {@code text} mode replies are the human readable lines Denis
 * always had; in {@code json} mode every reply is exactly one JSON object per
 * line ({@code {"ok":true|false,...}}), which is what the client libraries and
 * the MCP server use. {@code HELP} lists every command with its usage.
 *
 * <pre>
 *   no login    PING, MODE json|text, HELP, EXIT
 *   LIN         LIN &lt;group&gt; &lt;password&gt;
 *   logged in   AUTH CREATE | AUTH &lt;token&gt;, INFO
 *   project     GET SET DEL UPDATE EXISTS KEYS MGET HEAVEN SAVE, SQL ... / SHOW TABLES / DESCRIBE
 * </pre>
 */
public class DenisClient {
    private static final DenisLogger log = new DenisLogger(DenisClient.class);
    private static final boolean CLIENT_ACTIONS = new DenisProperties().getBoolean("send-client-actions", true);
    private static final int MAX_LINE_LENGTH = 1 << 20;

    /** Command reference, served by {@code HELP} and reused by the CLI and the MCP server. */
    public static final List<CommandDoc> COMMANDS = List.of(
            new CommandDoc("PING", "PING", "Liveness check; needs no login. Replies PONG.", false, false),
            new CommandDoc("MODE", "MODE <json|text>", "Reply format for this connection (default: text).", false, false),
            new CommandDoc("HELP", "HELP", "List every command with its usage.", false, false),
            new CommandDoc("EXIT", "EXIT", "Close the connection.", false, false),
            new CommandDoc("LIN", "LIN <group> <password>", "Log in with a group from denis.toml.", false, false),
            new CommandDoc("AUTH", "AUTH CREATE | AUTH <token>", "Create a project (key namespace) or select one by token.", true, false),
            new CommandDoc("INFO", "INFO", "Server statistics: version, uptime, connections, key counts.", true, false),
            new CommandDoc("GET", "GET <key> [-&from-cache | -&from-protobuff] [-&asa-json]", "Read a key (cache first, then the persisted store).", true, true),
            new CommandDoc("SET", "SET <key> <value> [-&save] [-&cache] [-&protobuff]", "Write a key to the cache; -&save also persists it.", true, true),
            new CommandDoc("UPDATE", "UPDATE <key> <value>", "Cache-only overwrite.", true, true),
            new CommandDoc("DEL", "DEL <key> [-&cache] [-&protobuff]", "Delete a key from the cache and/or the persisted store (default: both).", true, true),
            new CommandDoc("EXISTS", "EXISTS <key>", "Whether a key exists in the cache or the persisted store.", true, true),
            new CommandDoc("MGET", "MGET <key> [<key> ...]", "Read several keys at once.", true, true),
            new CommandDoc("KEYS", "KEYS [pattern]", "List the project's keys; pattern supports * and ? (default *).", true, true),
            new CommandDoc("HEAVEN", "HEAVEN", "Drop every cached key of the project (persisted keys stay).", true, true),
            new CommandDoc("SAVE", "SAVE", "Flush the persisted store to disk now.", true, true),
            new CommandDoc("SQL", "SQL <statement>  (the SQL prefix is optional)",
                    "CREATE TABLE, INSERT, SELECT (WHERE/ORDER BY/LIMIT), UPDATE, DELETE, DROP TABLE, SHOW TABLES, DESCRIBE <table>.", true, true)
    );

    public record CommandDoc(String name, String usage, String description, boolean needsLogin, boolean needsProject) {
        public JSONObject toJson() {
            return new JSONObject()
                    .put("name", name)
                    .put("usage", usage)
                    .put("description", description)
                    .put("needsLogin", needsLogin)
                    .put("needsProject", needsProject);
        }
    }

    private final ServerContext ctx;
    private ProjectStore project;
    private String group;
    private ClientStates state = ClientStates.INITIAL;
    private boolean jsonMode = false;

    public DenisClient(ServerContext ctx) {
        this.ctx = ctx;
    }

    public ClientStates getCurrentClientState() {
        return state;
    }

    public String getProjectToken() {
        return project == null ? null : project.token();
    }

    // ------------------------------------------------------------------ replies

    private void ok(PrintWriter out, String message) {
        if (jsonMode) {
            out.println(new JSONObject().put("ok", true).put("message", message));
        } else {
            out.println(String.format("[Info - %s]: %s", new Date(), message));
        }
    }

    private void error(PrintWriter out, String message) {
        if (jsonMode) {
            out.println(new JSONObject().put("ok", false).put("error", message));
        } else {
            out.println(String.format("[Error - %s]: %s", new Date(), message));
        }
    }

    private void usage(PrintWriter out, String usage) {
        if (jsonMode) {
            error(out, usage);
        } else {
            out.println(usage);
        }
    }

    private void json(PrintWriter out, JSONObject json, String text) {
        if (jsonMode) {
            out.println(json.put("ok", true));
        } else {
            out.println(text);
        }
    }

    /** A value reply (GET): the raw value in text mode, {@code {"ok":true,"key":..,"data":..}} in json mode. */
    private void value(PrintWriter out, String key, String data) {
        if (jsonMode) {
            out.println(new JSONObject().put("ok", true).put("key", key).put("data", data));
        } else {
            out.println(data);
        }
    }

    private void notFound(PrintWriter out, String key) {
        if (jsonMode) {
            out.println(new JSONObject().put("ok", false).put("key", key).put("error", "not found"));
        } else {
            out.println(String.format("err: %s not found in cache or protobuff", key));
        }
    }

    // ------------------------------------------------------------------ session

    public void handleClient(Socket socket) {
        if (socket == null || socket.isClosed()) {
            return;
        }
        String peer = socket.getInetAddress().getHostAddress();
        try (BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
             PrintWriter out = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true)) {
            String line;
            while ((line = in.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
                if (line.length() > MAX_LINE_LENGTH) {
                    error(out, "line too long");
                    break;
                }
                if (CLIENT_ACTIONS) {
                    String action = String.format("[CLIENT] %s action: %s", peer, describe(line));
                    if (ctx.activityLog() != null) {
                        ctx.activityLog().writeLog(action);
                    }
                    log.info(action);
                }
                boolean keepOpen;
                try {
                    keepOpen = handleLine(line, out);
                } catch (RuntimeException e) {
                    // A bug in one handler must not take the connection down silently.
                    log.error("Command failed for " + peer + " (" + describe(line) + "): " + e);
                    error(out, "internal error: " + e.getMessage());
                    keepOpen = true;
                }
                if (!keepOpen) {
                    break;
                }
            }
        } catch (java.net.SocketTimeoutException e) {
            log.info("Idle connection closed: " + peer);
        } catch (IOException e) {
            log.error("Error handling client " + peer + ": " + e.getMessage());
        }
    }

    /** Never echo credentials into the logs. */
    static String describe(String line) {
        String[] parts = line.split(" ", 2);
        String command = parts[0].toUpperCase(Locale.ROOT);
        if (command.equals("LIN") || command.equals("AUTH")) {
            return command + " ***";
        }
        return line;
    }

    /** @return false when the connection should be closed. */
    public boolean handleLine(String inputLine, PrintWriter out) {
        ctx.commandHandled();
        String[] parts = inputLine.trim().split(" ", 3);
        String command = parts[0].toUpperCase(Locale.ROOT);

        switch (command) {
            case "EXIT", "QUIT" -> {
                ok(out, "Bye.");
                return false;
            }
            case "PING" -> {
                if (jsonMode) {
                    ok(out, "PONG");
                } else {
                    out.println("PONG");
                }
                return true;
            }
            case "MODE" -> {
                String mode = parts.length > 1 ? parts[1].toLowerCase(Locale.ROOT) : "";
                switch (mode) {
                    case "json" -> {
                        jsonMode = true;
                        ok(out, "mode json");
                    }
                    case "text" -> {
                        jsonMode = false;
                        ok(out, "mode text");
                    }
                    default -> usage(out, "USAGE: MODE <json|text>");
                }
                return true;
            }
            case "HELP" -> {
                handleHelp(out);
                return true;
            }
            default -> {
                // authenticated flow below
            }
        }

        if (state == ClientStates.INITIAL) {
            if (!command.equals("LIN")) {
                error(out, "Please login first using LIN command");
                return true;
            }
            if (parts.length < 3) {
                usage(out, "USAGE: LIN <Group> <Password>");
                return true;
            }
            if (ctx.groups().verify(parts[1], parts[2])) {
                group = parts[1];
                state = ClientStates.LOGGED_IN;
                ok(out, "Logged in to group: " + parts[1]);
            } else {
                error(out, "Login failed: unknown group or wrong password");
            }
            return true;
        }

        switch (command) {
            case "LIN" -> {
                ok(out, "Already logged in to group: " + group);
                return true;
            }
            case "AUTH" -> {
                handleAuth(out, parts);
                return true;
            }
            case "INFO" -> {
                handleInfo(out);
                return true;
            }
            default -> {
                // project commands below
            }
        }

        if (project == null) {
            error(out, "Please authenticate first using AUTH command");
            return true;
        }

        if (SqlQueryEngine.isSqlCommand(inputLine)) {
            SqlResult result = new SqlQueryEngine(project).execute(inputLine);
            out.println(jsonMode ? result.toJson().toString() : result.toText());
            return true;
        }

        String key = parts.length > 1 ? parts[1] : null;
        switch (command) {
            case "GET" -> handleGet(out, key, parts);
            case "SET" -> handleSet(out, key, parts);
            case "DEL" -> handleDel(out, key, parts);
            case "UPDATE" -> {
                if (parts.length >= 3) {
                    project.setCached(key, parts[2]);
                    ok(out, "Ok.");
                } else {
                    usage(out, "USAGE: UPDATE <key> <newValue>");
                }
            }
            case "EXISTS" -> {
                if (key == null) {
                    usage(out, "USAGE: EXISTS <key>");
                } else {
                    boolean exists = project.exists(key);
                    json(out, new JSONObject().put("key", key).put("exists", exists), exists ? "1" : "0");
                }
            }
            case "MGET" -> handleMget(out, inputLine);
            case "KEYS" -> {
                List<String> keys = project.keys(key);
                json(out, new JSONObject().put("keys", new JSONArray(keys)).put("count", keys.size()),
                        keys.isEmpty() ? "(empty)" : String.join("\n", keys));
            }
            case "HEAVEN" -> {
                int removed = project.clearCache();
                if (jsonMode) {
                    out.println(new JSONObject().put("ok", true).put("message", "Ok.").put("removed", removed));
                } else {
                    ok(out, "Ok.");
                }
            }
            case "SAVE" -> {
                try {
                    ctx.persistence().flush();
                    ok(out, "Saved.");
                } catch (IOException e) {
                    error(out, "Could not write persisted store: " + e.getMessage());
                }
            }
            default -> error(out, "Unknown command: " + command + " (try HELP)");
        }
        return true;
    }

    // ----------------------------------------------------------------- handlers

    private void handleHelp(PrintWriter out) {
        if (jsonMode) {
            JSONArray commands = new JSONArray();
            COMMANDS.forEach(c -> commands.put(c.toJson()));
            out.println(new JSONObject().put("ok", true).put("commands", commands));
            return;
        }
        StringBuilder text = new StringBuilder("Denis commands:");
        for (CommandDoc c : COMMANDS) {
            text.append("\n  ").append(String.format("%-56s %s", c.usage(), c.description()));
        }
        out.println(text);
    }

    private void handleAuth(PrintWriter out, String[] parts) {
        if (parts.length < 2) {
            usage(out, "USAGE: AUTH <CREATE|token>");
            return;
        }
        if (parts[1].equalsIgnoreCase("CREATE")) {
            try {
                String token = ctx.projects().create();
                if (jsonMode) {
                    out.println(new JSONObject().put("ok", true).put("message", "Project created").put("token", token));
                } else {
                    ok(out, "Project created! Token: " + token);
                }
            } catch (IOException e) {
                log.error("Error saving new token: " + e.getMessage());
                error(out, "Could not create project");
            }
            return;
        }
        String token = parts[1];
        if (ctx.projects().exists(token)) {
            project = ctx.project(token);
            state = ClientStates.AUTHENTICATED;
            ok(out, "Authenticated to project: " + token);
        } else {
            error(out, "Cannot auth with: " + token);
        }
    }

    private void handleInfo(PrintWriter out) {
        JSONObject info = new JSONObject()
                .put("version", version())
                .put("uptimeSeconds", ctx.uptimeSeconds())
                .put("startedAt", ctx.startedAt().toString())
                .put("connections", new JSONObject().put("open", ctx.connectionsOpen()).put("total", ctx.connectionsTotal()))
                .put("commandsTotal", ctx.commandsTotal())
                .put("cacheKeys", ctx.store().size())
                .put("persistedKeys", ctx.persistence().keyCount())
                .put("persistedDirty", ctx.persistence().isDirty())
                .put("projects", ctx.projects().size())
                .put("group", group);
        if (project != null) {
            info.put("project", new JSONObject()
                    .put("cachedKeys", project.cachedCount())
                    .put("persistedKeys", project.persistedCount()));
        }
        Runtime rt = Runtime.getRuntime();
        info.put("memory", new JSONObject()
                .put("usedMb", (rt.totalMemory() - rt.freeMemory()) / 1024 / 1024)
                .put("maxMb", rt.maxMemory() / 1024 / 1024));
        if (jsonMode) {
            out.println(info.put("ok", true));
        } else {
            StringBuilder text = new StringBuilder();
            for (String name : info.keySet()) {
                text.append(name).append(": ").append(info.get(name)).append('\n');
            }
            out.print(text);
            out.flush();
        }
    }

    private static boolean hasFlag(String[] flags, String flag) {
        return Arrays.stream(flags).anyMatch(s -> s.equalsIgnoreCase(flag));
    }

    private static boolean isFlag(String word) {
        return word.startsWith("-&");
    }

    private void handleGet(PrintWriter out, String key, String[] parts) {
        if (key == null) {
            usage(out, "USAGE: GET <key> [-&from-cache,-&from-protobuff] [-&asa-json]");
            return;
        }
        String[] flags = parts.length > 2 ? parts[2].split(" ") : new String[0];
        boolean fromCache = hasFlag(flags, "-&from-cache");
        boolean asJson = hasFlag(flags, "-&asa-json");
        boolean fromPersisted = hasFlag(flags, "-&from-protobuff");

        String data;
        if (fromPersisted) {
            data = project.getPersisted(key);
            if (data == null) {
                data = project.getCached(key);
            }
        } else {
            data = project.get(key);
        }

        if (data == null) {
            notFound(out, key);
        } else if (asJson && !fromCache && !jsonMode) {
            out.println(new JSONObject().put("key", key).put("data", data));
        } else {
            value(out, key, data);
        }
    }

    private void handleSet(PrintWriter out, String key, String[] parts) {
        if (parts.length < 3) {
            usage(out, "USAGE: SET <key> <value> [-&save] [-&cache] [-&protobuff]");
            return;
        }
        // Flags come after the value and are not part of it.
        String[] words = parts[2].split(" ");
        String[] flags = Arrays.stream(words).filter(DenisClient::isFlag).toArray(String[]::new);
        String value = Arrays.stream(words).filter(w -> !isFlag(w)).collect(java.util.stream.Collectors.joining(" "));
        boolean persist = hasFlag(flags, "-&save") || hasFlag(flags, "-&protobuff");
        boolean cache = hasFlag(flags, "-&cache") || flags.length == 0;

        project.set(key, value, persist);
        List<String> stored = new ArrayList<>();
        if (cache) {
            stored.add("Cache");
        }
        if (persist) {
            stored.add("Protobuf");
        }
        ok(out, "Ok (" + String.join(", ", stored) + ")");
    }

    private void handleDel(PrintWriter out, String key, String[] parts) {
        if (key == null) {
            usage(out, "USAGE: DEL <key> [-&cache] [-&protobuff]");
            return;
        }
        String[] flags = parts.length > 2 ? parts[2].split(" ") : new String[0];
        boolean cacheDel = hasFlag(flags, "-&cache");
        boolean protoDel = hasFlag(flags, "-&protobuff");
        if (cacheDel && !protoDel) {
            project.delete(key, true, false);
            ok(out, "Ok (Cache).");
        } else if (protoDel && !cacheDel) {
            project.delete(key, false, true);
            ok(out, "Ok (Protobuf).");
        } else {
            project.delete(key, true, true);
            ok(out, "Ok (Cache,Protobuf).");
        }
    }

    private void handleMget(PrintWriter out, String inputLine) {
        String[] words = inputLine.trim().split("\\s+");
        if (words.length < 2) {
            usage(out, "USAGE: MGET <key> [<key> ...]");
            return;
        }
        JSONObject values = new JSONObject();
        StringBuilder text = new StringBuilder();
        for (int i = 1; i < words.length; i++) {
            String data = project.get(words[i]);
            values.put(words[i], data == null ? JSONObject.NULL : data);
            if (i > 1) {
                text.append('\n');
            }
            text.append(words[i]).append(": ").append(data == null ? "(nil)" : data);
        }
        json(out, new JSONObject().put("values", values), text.toString());
    }

    private static String version() {
        String version = DenisClient.class.getPackage().getImplementationVersion();
        return version == null ? "dev" : version;
    }
}
