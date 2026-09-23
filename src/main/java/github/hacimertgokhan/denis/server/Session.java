package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.backup.BackupManager;
import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.denis.sql.SqlEngine;
import github.hacimertgokhan.denis.sql.SqlException;
import github.hacimertgokhan.denis.sql.SqlResult;
import github.hacimertgokhan.denis.storage.Keyspace;
import github.hacimertgokhan.denis.storage.Slot;
import github.hacimertgokhan.denis.storage.StorageEngine;
import github.hacimertgokhan.denis.storage.StorageException;
import github.hacimertgokhan.logger.DenisLogger;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Supplier;

/**
 * One client connection's protocol state and command handling.
 *
 * <p>The wire protocol is line based: one command line in, one reply line out.
 * Replies are human readable in {@code MODE text} (the default, compatible
 * with Denis 0.0.x and telnet) and exactly one JSON object per line in
 * {@code MODE json}: {@code {"ok":true,...}} or
 * {@code {"ok":false,"error":"...","code":"..."}}. See docs/PROTOCOL.md.
 *
 * <p>Fast in-memory commands run on the network thread. Commands that may
 * take long — login (PBKDF2), SQL, KEYS/DUMP/IMPORT, SAVE/BACKUP, project
 * management — run on the bounded worker pool; the connection waits for the
 * result before reading its next command, so replies stay in order.
 */
public final class Session {
    private static final DenisLogger log = new DenisLogger(Session.class);
    public static final int PROTOCOL_VERSION = 2;
    private static final List<String> FEATURES = List.of("json", "sql", "sql-params", "ttl", "incr", "keys", "mget",
            "dump", "import", "backup", "projects", "info");

    private final ServerContext ctx;
    private final String peer;
    private boolean json;
    private boolean loggedIn;
    private String group;
    private boolean admin;
    private String token;
    private Keyspace keyspace;

    public Session(ServerContext ctx, String peer) {
        this.ctx = ctx;
        this.peer = peer;
    }

    public boolean jsonMode() {
        return json;
    }

    // =================================================================== replies

    private String ok(String message) {
        if (json) {
            return "{\"ok\":true,\"message\":" + JSONObject.quote(message) + "}";
        }
        return "[Info - " + new Date() + "]: " + message;
    }

    private String error(String message) {
        return error(null, message);
    }

    private String error(String code, String message) {
        ctx.metrics().errors.increment();
        if (json) {
            return "{\"ok\":false,\"error\":" + JSONObject.quote(message) + (code == null ? "" : ",\"code\":\"" + code + "\"") + "}";
        }
        return "[Error - " + new Date() + "]: " + message;
    }

    /** Usage hint: raw line in text mode (as 0.0.x did), an error object in json mode. */
    private String usage(String usage) {
        return json ? error("USAGE", usage) : usage;
    }

    /** A JSON object reply; in text mode the object itself (one line). */
    private String object(JSONObject body) {
        if (json) {
            JSONObject reply = new JSONObject();
            reply.put("ok", true);
            for (String key : body.keySet()) {
                reply.put(key, body.get(key));
            }
            return reply.toString();
        }
        return body.toString();
    }

    private Reply afterDurable(CompletableFuture<Void> durable, String line) {
        if (durable.isDone() && !durable.isCompletedExceptionally()) {
            return Reply.of(line);
        }
        return Reply.later(durable.handle((v, e) -> e == null ? line
                : error("PERSISTENCE", "write not durable: " + rootMessage(e))));
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t instanceof CompletionException && t.getCause() != null) {
            t = t.getCause();
        }
        return t.getMessage() == null ? t.toString() : t.getMessage();
    }

    /** Run {@code work} on the worker pool; its reply is sent when ready. */
    private Reply async(Supplier<String> work) {
        try {
            return Reply.later(CompletableFuture.supplyAsync(() -> guarded(work), ctx.workers()));
        } catch (RejectedExecutionException e) {
            ctx.metrics().busyRejections.increment();
            return Reply.of(error("BUSY", "server is busy, try again"));
        }
    }

    private String guarded(Supplier<String> work) {
        try {
            return work.get();
        } catch (StorageException e) {
            return error(e.code(), e.getMessage());
        } catch (SqlException e) {
            return sqlError(e.getMessage());
        } catch (RuntimeException e) {
            log.error("Command failed for " + peer + ": " + e, e);
            return error("INTERNAL", "internal error: " + e.getMessage());
        }
    }

    private String sqlError(String message) {
        ctx.metrics().errors.increment();
        if (json) {
            return new JSONObject().put("ok", false).put("error", message).put("code", "SQL").put("data", "ERROR: " + message).toString();
        }
        return "ERROR: " + message;
    }

    // =================================================================== dispatch

    /** Handle one input line. Never throws. */
    public Reply handle(String input) {
        // only leading whitespace is insignificant: values may end in spaces (and may be empty)
        String line = input.stripLeading();
        if (line.isEmpty()) {
            // telnet users press Enter; clients get a reply for every line they send
            return json ? Reply.of(error("USAGE", "empty command")) : Reply.NONE;
        }
        ctx.metrics().commands.increment();
        if (ctx.config().logCommands()) {
            log.info("[CLIENT] " + peer + " action: " + describe(line));
        }
        try {
            return dispatch(line);
        } catch (StorageException e) {
            return Reply.of(error(e.code(), e.getMessage()));
        } catch (SqlException e) {
            return Reply.of(sqlError(e.getMessage()));
        } catch (RuntimeException e) {
            log.error("Command failed for " + peer + ": " + e, e);
            return Reply.of(error("INTERNAL", "internal error: " + e.getMessage()));
        }
    }

    /** Never echo credentials or values into the logs. */
    static String describe(String line) {
        int space = line.indexOf(' ');
        String command = (space < 0 ? line : line.substring(0, space)).toUpperCase(Locale.ROOT);
        return switch (command) {
            case "LIN", "AUTH", "IMPORT", "QUERY" -> command + " ***";
            case "SET", "UPDATE" -> {
                int second = space < 0 ? -1 : line.indexOf(' ', space + 1);
                yield second < 0 ? line : line.substring(0, second) + " ***";
            }
            default -> line.length() > 200 ? line.substring(0, 200) + "..." : line;
        };
    }

    private Reply dispatch(String line) {
        int space = line.indexOf(' ');
        String command = (space < 0 ? line : line.substring(0, space)).toUpperCase(Locale.ROOT);
        String args = space < 0 ? "" : line.substring(space + 1);

        switch (command) {
            case "EXIT", "QUIT" -> {
                return Reply.closing(ok("Bye."));
            }
            case "PING" -> {
                return Reply.of(json ? ok("PONG") : "PONG");
            }
            case "MODE" -> {
                String mode = firstWord(args).toLowerCase(Locale.ROOT);
                if (mode.equals("json")) {
                    json = true;
                    return Reply.of(ok("mode json"));
                }
                if (mode.equals("text")) {
                    json = false;
                    return Reply.of(ok("mode text"));
                }
                return Reply.of(usage("USAGE: MODE <json|text>"));
            }
            case "HELLO" -> {
                JSONObject hello = new JSONObject().put("server", "denis").put("version", ctx.version())
                        .put("protocol", PROTOCOL_VERSION).put("features", new JSONArray(FEATURES))
                        .put("loggedIn", loggedIn);
                return Reply.of(json ? object(hello) : "denis " + ctx.version() + " protocol " + PROTOCOL_VERSION);
            }
            case "HELP" -> {
                return Reply.of(help());
            }
            case "LIN" -> {
                return login(args);
            }
            default -> {
                // everything below needs a login
            }
        }

        if (!loggedIn) {
            return Reply.of(error("NOAUTH", "Please login first using LIN command"));
        }

        switch (command) {
            case "AUTH" -> {
                return auth(args);
            }
            case "PROJECTS" -> {
                return async(this::projects);
            }
            case "WHOAMI" -> {
                JSONObject who = new JSONObject().put("group", group).put("admin", admin)
                        .put("project", token == null ? JSONObject.NULL : token);
                return Reply.of(object(who));
            }
            case "INFO" -> {
                return Reply.of(object(info()));
            }
            case "SAVE" -> {
                return adminOnly(() -> async(this::save));
            }
            case "BACKUP" -> {
                return adminOnly(() -> async(this::backup));
            }
            case "BACKUPS" -> {
                return adminOnly(() -> async(this::backups));
            }
            default -> {
                // project commands below
            }
        }

        if (keyspace != null && keyspace.dropped()) {
            // deleted by another session: stop using it rather than writing into a detached keyspace
            keyspace = null;
            token = null;
            return Reply.of(error("NOPROJECT", "The project was deleted; AUTH to another project"));
        }
        if (keyspace == null) {
            return Reply.of(error("NOPROJECT", "Please authenticate first using AUTH command"));
        }

        if (command.equals("SQL") || isSqlStatement(command, line)) {
            String statement = command.equals("SQL") ? args : line;
            return async(() -> sql(statement, null));
        }

        String[] parts = split3(line);
        String key = parts.length > 1 ? parts[1] : null;
        return switch (command) {
            case "GET" -> get(key, parts);
            case "SET" -> set(key, parts);
            case "DEL" -> del(key, parts);
            case "UPDATE" -> update(key, parts);
            case "HEAVEN" -> {
                ctx.storage().clearCache(keyspace);
                yield Reply.of(ok("Ok."));
            }
            case "EXISTS" -> exists(key);
            case "KEYS" -> keys(args);
            case "MGET" -> mget(args);
            case "INCR", "DECR" -> incr(command.equals("DECR"), args);
            case "EXPIRE" -> expire(parts);
            case "PERSIST" -> persist(key);
            case "TTL" -> ttl(key);
            case "DBSIZE" -> dbsize();
            case "DUMP" -> async(this::dump);
            case "IMPORT" -> args.isBlank() ? Reply.of(usage("USAGE: IMPORT <json>")) : async(() -> importData(args));
            case "QUERY" -> args.isBlank() ? Reply.of(usage("USAGE: QUERY {\"sql\":\"...\",\"params\":[...]}")) : async(() -> query(args));
            default -> Reply.of(error("UNKNOWN", "Unknown command: " + command));
        };
    }

    private Reply adminOnly(Supplier<Reply> action) {
        if (!admin) {
            return Reply.of(error("FORBIDDEN", "This command needs an admin group"));
        }
        return action.get();
    }

    /** The first line of 0.0.x's {@code split(" ", 3)}: command, key, rest. */
    private static String[] split3(String line) {
        int first = line.indexOf(' ');
        if (first < 0) {
            return new String[]{line};
        }
        int second = line.indexOf(' ', first + 1);
        if (second < 0) {
            return new String[]{line.substring(0, first), line.substring(first + 1)};
        }
        return new String[]{line.substring(0, first), line.substring(first + 1, second), line.substring(second + 1)};
    }

    private static String firstWord(String s) {
        String t = s.trim();
        int space = t.indexOf(' ');
        return space < 0 ? t : t.substring(0, space);
    }

    /** SQL typed without the SQL prefix, as 0.0.x accepted it. */
    static boolean isSqlStatement(String command, String line) {
        return switch (command) {
            case "SELECT", "INSERT", "CREATE", "DROP", "ALTER", "TRUNCATE", "SHOW", "DESCRIBE", "DESC", "EXPLAIN",
                 "REPLACE", "UPSERT", "DELETE" -> true;
            case "UPDATE" -> line.toUpperCase(Locale.ROOT).contains(" SET ");
            default -> false;
        };
    }

    private static boolean isFlag(String word) {
        return word.startsWith("-&");
    }

    private static boolean hasFlag(List<String> flags, String flag) {
        for (String f : flags) {
            if (f.equalsIgnoreCase(flag)) {
                return true;
            }
        }
        return false;
    }

    private static String flagValue(List<String> flags, String prefix) {
        for (String f : flags) {
            if (f.regionMatches(true, 0, prefix, 0, prefix.length())) {
                return f.substring(prefix.length());
            }
        }
        return null;
    }

    private static List<String> flags(String text) {
        List<String> flags = new ArrayList<>();
        if (text == null || !text.contains("-&")) {
            return flags;
        }
        for (String w : text.split(" ")) {
            if (isFlag(w)) {
                flags.add(w);
            }
        }
        return flags;
    }

    // =================================================================== login / projects

    private Reply login(String args) {
        String[] parts = args.split(" ", 2);
        if (parts.length < 2 || parts[0].isBlank()) {
            return Reply.of(usage("USAGE: LIN <Group> <Password>"));
        }
        long wait = ctx.loginGuard().retryAfter(peer);
        if (wait > 0) {
            return Reply.of(error("LOCKED", "Too many failed logins; try again in " + ((wait + 999) / 1000) + " s"));
        }
        String name = parts[0];
        String password = parts[1];
        return async(() -> {
            GroupManager.Login result = ctx.groups().login(name, password);
            if (!result.ok()) {
                ctx.loginGuard().failure(peer);
                ctx.metrics().loginFailures.increment();
                return error("AUTH", "Login failed: unknown group or wrong password");
            }
            ctx.loginGuard().success(peer);
            if (loggedIn && !name.equals(group)) {
                token = null;
                keyspace = null;
            }
            loggedIn = true;
            group = name;
            admin = result.admin();
            if (json) {
                return new JSONObject().put("ok", true).put("message", "Logged in to group: " + name)
                        .put("group", name).put("admin", admin).toString();
            }
            return ok("Logged in to group: " + name);
        });
    }

    private boolean mayUse(String projectToken) {
        String owner = ctx.projects().owner(projectToken);
        if (owner == null) {
            return false;
        }
        return admin || !ctx.config().enforceOwnership() || owner.isEmpty() || owner.equals(group);
    }

    private Reply auth(String args) {
        String[] parts = args.trim().split(" ", 2);
        if (parts[0].isEmpty()) {
            return Reply.of(usage("USAGE: AUTH <CREATE|token>"));
        }
        if (parts[0].equalsIgnoreCase("CREATE")) {
            return async(() -> {
                try {
                    String created = ctx.projects().create(group);
                    if (json) {
                        return new JSONObject().put("ok", true).put("message", "Project created").put("token", created).toString();
                    }
                    return ok("Project created! Token: " + created);
                } catch (IOException e) {
                    log.error("Error saving new token: " + e.getMessage());
                    return error("IO", "Could not create project");
                }
            });
        }
        if (parts[0].equalsIgnoreCase("DELETE")) {
            if (parts.length < 2 || parts[1].isBlank()) {
                return Reply.of(usage("USAGE: AUTH DELETE <token>"));
            }
            String target = parts[1].trim();
            return async(() -> {
                if (!mayUse(target)) {
                    return error("AUTH", "Cannot delete project: " + target);
                }
                try {
                    ctx.storage().dropKeyspace(target).join();
                    ctx.projects().delete(target);
                } catch (IOException e) {
                    return error("IO", "Could not delete project: " + e.getMessage());
                }
                if (target.equals(token)) {
                    token = null;
                    keyspace = null;
                }
                return ok("Project deleted");
            });
        }
        String candidate = parts[0];
        if (!mayUse(candidate)) {
            return Reply.of(error("AUTH", "Cannot auth with: " + candidate));
        }
        token = candidate;
        keyspace = ctx.storage().keyspace(candidate);
        return Reply.of(ok("Authenticated to project: " + candidate));
    }

    private String projects() {
        JSONArray list = new JSONArray();
        for (ProjectRegistry.Project p : ctx.projects().list()) {
            if (!admin && ctx.config().enforceOwnership() && !p.owner().isEmpty() && !p.owner().equals(group)) {
                continue;
            }
            Keyspace ks = ctx.storage().findKeyspace(p.token());
            list.put(new JSONObject()
                    .put("token", p.token())
                    .put("owner", p.owner().isEmpty() ? JSONObject.NULL : p.owner())
                    .put("keys", ks == null ? 0 : ks.keyCount())
                    .put("tables", ks == null ? 0 : ks.tables().size())
                    .put("current", p.token().equals(token)));
        }
        return object(new JSONObject().put("projects", list).put("count", list.length()));
    }

    // =================================================================== key-value

    private Reply get(String key, String[] parts) {
        if (key == null) {
            return Reply.of(usage("USAGE: GET <key> [-&from-cache,-&from-protobuff] [-&asa-json]"));
        }
        List<String> flags = flags(parts.length > 2 ? parts[2] : null);
        boolean fromProtobuf = hasFlag(flags, "-&from-protobuff");
        boolean fromCache = hasFlag(flags, "-&from-cache");
        boolean asJson = hasFlag(flags, "-&asa-json");
        Slot slot = ctx.storage().read(keyspace, key);
        String data = null;
        if (slot != null) {
            data = fromProtobuf ? (slot.persistent() != null ? slot.persistent() : slot.cache())
                    : (slot.cache() != null ? slot.cache() : slot.persistent());
        }
        if (data == null) {
            if (json) {
                return Reply.of("{\"ok\":false,\"key\":" + JSONObject.quote(key) + ",\"error\":\"not found\",\"code\":\"NOTFOUND\"}");
            }
            return Reply.of("err: " + key + " not found in cache or protobuff");
        }
        if (json) {
            return Reply.of("{\"ok\":true,\"key\":" + JSONObject.quote(key) + ",\"data\":" + JSONObject.quote(data) + "}");
        }
        if (asJson && !fromCache) {
            return Reply.of("{\"key\":" + JSONObject.quote(key) + ",\"data\":" + JSONObject.quote(data) + "}");
        }
        return Reply.of(data);
    }

    private Reply set(String key, String[] parts) {
        if (parts.length < 3) {
            return Reply.of(usage("USAGE: SET <key> <value> [-&save] [-&cache] [-&protobuff] [-&ttl=<seconds>]"));
        }
        String rest = parts[2];
        String value = rest;
        List<String> flags = List.of();
        if (rest.contains("-&")) {
            // flags follow the value and are not part of it; whitespace after the last flag is not part of the value
            String[] words = rest.stripTrailing().split(" ", -1);
            StringBuilder sb = new StringBuilder(rest.length());
            flags = new ArrayList<>();
            boolean first = true;
            for (String w : words) {
                if (isFlag(w)) {
                    flags.add(w);
                } else {
                    if (!first) {
                        sb.append(' ');
                    }
                    sb.append(w);
                    first = false;
                }
            }
            value = sb.toString();
        }
        boolean save = hasFlag(flags, "-&save") || hasFlag(flags, "-&protobuff");
        boolean cacheFlag = hasFlag(flags, "-&cache");
        long ttl = ttlMillis(flagValue(flags, "-&ttl="));
        if (ttl < 0) {
            return Reply.of(usage("USAGE: -&ttl=<seconds> needs a positive number"));
        }
        CompletableFuture<Void> durable = ctx.storage().put(keyspace, key, value, true, save, ttl);
        String stored;
        if (!save && !cacheFlag) {
            stored = "Cache";
        } else if (cacheFlag && save) {
            stored = "Cache, Protobuf";
        } else if (save) {
            stored = "Protobuf";
        } else {
            stored = "Cache";
        }
        return afterDurable(durable, ok("Ok (" + stored + ")"));
    }

    private static long ttlMillis(String seconds) {
        if (seconds == null) {
            return 0;
        }
        try {
            double s = Double.parseDouble(seconds.trim());
            return s > 0 ? Math.max(1, Math.round(s * 1000)) : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private Reply update(String key, String[] parts) {
        if (parts.length < 3) {
            return Reply.of(usage("USAGE: UPDATE <key> <newValue>"));
        }
        ctx.storage().put(keyspace, key, parts[2], true, false, 0);
        return Reply.of(ok("Ok."));
    }

    private Reply del(String key, String[] parts) {
        if (key == null) {
            return Reply.of(usage("USAGE: DEL <key> [-&cache] [-&protobuff]"));
        }
        List<String> flags = flags(parts.length > 2 ? parts[2] : null);
        boolean cacheOnly = hasFlag(flags, "-&cache");
        boolean protobufOnly = hasFlag(flags, "-&protobuff");
        boolean cache = cacheOnly || !protobufOnly;
        boolean durable = protobufOnly || !cacheOnly;
        StorageEngine.DeleteResult result = ctx.storage().delete(keyspace, key, cache, durable);
        String message = cacheOnly ? "Ok (Cache)." : protobufOnly ? "Ok (Protobuf)." : "Ok (Cache,Protobuf).";
        String line = json
                ? new JSONObject().put("ok", true).put("message", message).put("deleted", result.existed()).toString()
                : ok(message);
        return afterDurable(result.durable(), line);
    }

    private Reply exists(String key) {
        if (key == null) {
            return Reply.of(usage("USAGE: EXISTS <key>"));
        }
        Slot slot = ctx.storage().read(keyspace, key);
        boolean cache = slot != null && slot.cache() != null;
        boolean persistent = slot != null && slot.persistent() != null;
        if (json) {
            return Reply.of(new JSONObject().put("ok", true).put("key", key).put("exists", cache || persistent)
                    .put("cache", cache).put("persistent", persistent).toString());
        }
        return Reply.of(cache || persistent ? "1" : "0");
    }

    private Reply keys(String args) {
        String pattern = "*";
        List<String> flags = new ArrayList<>();
        for (String w : args.trim().split(" ")) {
            if (w.isEmpty()) {
                continue;
            }
            if (isFlag(w)) {
                flags.add(w);
            } else {
                pattern = w;
            }
        }
        StorageEngine.Layer layer = hasFlag(flags, "-&cache") ? StorageEngine.Layer.CACHE
                : hasFlag(flags, "-&protobuff") ? StorageEngine.Layer.PERSISTENT : StorageEngine.Layer.ANY;
        int limit = ctx.config().keysLimit();
        String limitFlag = flagValue(flags, "-&limit=");
        if (limitFlag != null) {
            try {
                limit = Math.max(1, Math.min(limit, Integer.parseInt(limitFlag.trim())));
            } catch (NumberFormatException e) {
                return Reply.of(usage("USAGE: KEYS [pattern] [-&cache|-&protobuff] [-&limit=<n>]"));
            }
        }
        String glob = pattern;
        int max = limit;
        // small keyspaces answer inline; big ones are listed off the network thread
        if (keyspace.keyCount() <= 10_000) {
            return Reply.of(keysReply(ctx.storage().keys(keyspace, glob, layer, max + 1), max));
        }
        return async(() -> keysReply(ctx.storage().keys(keyspace, glob, layer, max + 1), max));
    }

    private String keysReply(List<String> keys, int limit) {
        boolean truncated = keys.size() > limit;
        List<String> shown = truncated ? keys.subList(0, limit) : keys;
        JSONArray array = new JSONArray(shown);
        if (json) {
            return new JSONObject().put("ok", true).put("keys", array).put("count", shown.size()).put("truncated", truncated).toString();
        }
        return array.toString();
    }

    private Reply mget(String args) {
        String[] keys = args.trim().split("\\s+");
        if (keys.length == 0 || keys[0].isEmpty()) {
            return Reply.of(usage("USAGE: MGET <key> [key ...]"));
        }
        JSONObject data = new JSONObject();
        for (String key : keys) {
            Slot slot = ctx.storage().read(keyspace, key);
            String value = slot == null ? null : slot.cache() != null ? slot.cache() : slot.persistent();
            data.put(key, value == null ? JSONObject.NULL : value);
        }
        if (json) {
            return Reply.of(new JSONObject().put("ok", true).put("data", data).toString());
        }
        return Reply.of(data.toString());
    }

    private Reply incr(boolean decrement, String args) {
        String[] words = args.trim().split("\\s+");
        if (words.length == 0 || words[0].isEmpty()) {
            return Reply.of(usage("USAGE: " + (decrement ? "DECR" : "INCR") + " <key> [delta] [-&save]"));
        }
        long delta = 1;
        boolean save = false;
        for (int i = 1; i < words.length; i++) {
            if (words[i].equalsIgnoreCase("-&save") || words[i].equalsIgnoreCase("-&protobuff")) {
                save = true;
            } else {
                try {
                    delta = Long.parseLong(words[i]);
                } catch (NumberFormatException e) {
                    return Reply.of(usage("USAGE: delta must be an integer"));
                }
            }
        }
        StorageEngine.IncrResult result = ctx.storage().incr(keyspace, words[0], decrement ? -delta : delta, save);
        String line = json
                ? "{\"ok\":true,\"key\":" + JSONObject.quote(words[0]) + ",\"data\":\"" + result.value() + "\",\"value\":" + result.value() + "}"
                : Long.toString(result.value());
        return afterDurable(result.durable(), line);
    }

    private Reply expire(String[] parts) {
        if (parts.length < 3) {
            return Reply.of(usage("USAGE: EXPIRE <key> <seconds>"));
        }
        long ttl = ttlMillis(parts[2].trim());
        if (ttl < 0) {
            return Reply.of(usage("USAGE: EXPIRE <key> <seconds> (seconds > 0)"));
        }
        boolean done = ctx.storage().expire(keyspace, parts[1], ttl);
        return Reply.of(json ? "{\"ok\":true,\"key\":" + JSONObject.quote(parts[1]) + ",\"data\":\"" + (done ? 1 : 0) + "\",\"updated\":" + done + "}"
                : done ? "1" : "0");
    }

    private Reply persist(String key) {
        if (key == null) {
            return Reply.of(usage("USAGE: PERSIST <key>"));
        }
        boolean done = ctx.storage().expire(keyspace, key, 0);
        return Reply.of(json ? "{\"ok\":true,\"key\":" + JSONObject.quote(key) + ",\"data\":\"" + (done ? 1 : 0) + "\",\"updated\":" + done + "}"
                : done ? "1" : "0");
    }

    private Reply ttl(String key) {
        if (key == null) {
            return Reply.of(usage("USAGE: TTL <key>"));
        }
        long ms = ctx.storage().ttl(keyspace, key);
        long seconds = ms < 0 ? ms : (ms + 999) / 1000;
        return Reply.of(json ? "{\"ok\":true,\"key\":" + JSONObject.quote(key) + ",\"data\":\"" + seconds + "\",\"ttl\":" + seconds
                + ",\"ttlMillis\":" + ms + "}" : Long.toString(seconds));
    }

    private Reply dbsize() {
        long keys = keyspace.keyCount();
        JSONObject body = new JSONObject().put("keys", keys).put("cache", keyspace.cacheKeyCount())
                .put("persistent", keyspace.persistentKeyCount()).put("tables", keyspace.tables().size());
        if (json) {
            return Reply.of(object(body.put("data", Long.toString(keys))));
        }
        return Reply.of(Long.toString(keys));
    }

    // =================================================================== dump / import

    private String dump() {
        JSONObject cache = new JSONObject();
        JSONObject persistent = new JSONObject();
        JSONObject ttl = new JSONObject();
        long now = System.currentTimeMillis();
        ctx.storage().forEach(keyspace, (key, slot) -> {
            if (slot.cache() != null && (slot.expireAt() == 0 || slot.expireAt() > now)) {
                cache.put(key, slot.cache());
                if (slot.expireAt() > 0) {
                    ttl.put(key, slot.expireAt() - now);
                }
            }
            if (slot.persistent() != null) {
                persistent.put(key, slot.persistent());
            }
        });
        JSONObject body = new JSONObject()
                .put("format", 1)
                .put("server", "denis")
                .put("version", ctx.version())
                .put("createdAt", java.time.Instant.now().toString())
                .put("cache", cache)
                .put("persistent", persistent)
                .put("ttl", ttl)
                .put("tables", ctx.sql().dumpTables(keyspace));
        return object(body);
    }

    private String importData(String args) {
        JSONObject data;
        try {
            data = new JSONObject(args);
        } catch (JSONException e) {
            return error("USAGE", "IMPORT needs a JSON object: " + e.getMessage());
        }
        boolean replace = data.optBoolean("replace", false);
        boolean append = data.optBoolean("append", false);
        long persistentCount = 0;
        long cacheCount = 0;
        long rows = 0;
        CompletableFuture<Void> durable = CompletableFuture.completedFuture(null);
        JSONObject persistent = data.optJSONObject("persistent");
        if (persistent != null) {
            for (Iterator<String> it = persistent.keys(); it.hasNext(); ) {
                String key = it.next();
                durable = ctx.storage().put(keyspace, key, String.valueOf(persistent.get(key)), false, true, 0);
                persistentCount++;
            }
        }
        JSONObject cache = data.optJSONObject("cache");
        JSONObject ttl = data.optJSONObject("ttl");
        if (cache != null) {
            for (Iterator<String> it = cache.keys(); it.hasNext(); ) {
                String key = it.next();
                long ttlMs = ttl == null ? 0 : Math.max(0, ttl.optLong(key, 0));
                ctx.storage().put(keyspace, key, String.valueOf(cache.get(key)), true, false, ttlMs);
                cacheCount++;
            }
        }
        JSONObject tables = data.optJSONObject("tables");
        int tableCount = 0;
        if (tables != null) {
            for (String name : tables.keySet()) {
                rows += ctx.sql().importTable(keyspace, name, tables.getJSONObject(name), replace, append);
                tableCount++;
            }
        }
        durable.join();
        JSONObject imported = new JSONObject().put("persistent", persistentCount).put("cache", cacheCount)
                .put("tables", tableCount).put("rows", rows);
        if (json) {
            return new JSONObject().put("ok", true).put("message", "Imported").put("imported", imported).toString();
        }
        return ok("Imported " + imported);
    }

    // =================================================================== SQL

    private String sql(String statement, Object[] params) {
        SqlResult result = ctx.sql().execute(keyspace, statement, params);
        result.durable().join();
        if (json) {
            return result.toJson().toString();
        }
        return result.legacyText();
    }

    /** {@code QUERY {"sql": "...", "params": [...]}} — parameterised SQL, always answered as a SQL result. */
    private String query(String args) {
        JSONObject request;
        try {
            request = new JSONObject(args);
        } catch (JSONException e) {
            return error("USAGE", "QUERY needs a JSON object: " + e.getMessage());
        }
        String statement = request.optString("sql", "");
        if (statement.isBlank()) {
            return error("USAGE", "QUERY needs \"sql\"");
        }
        JSONArray array = request.optJSONArray("params");
        Object[] params = new Object[array == null ? 0 : array.length()];
        for (int i = 0; i < params.length; i++) {
            params[i] = SqlEngine.fromJson(array.opt(i));
        }
        return sql(statement, params);
    }

    // =================================================================== admin / info

    private String save() {
        try {
            StorageEngine.CheckpointInfo info = ctx.storage().checkpoint();
            JSONObject body = new JSONObject().put("message", "Snapshot written").put("bytes", info.bytes())
                    .put("records", info.records()).put("millis", info.millis());
            return json ? object(body) : ok("Snapshot written (" + info.bytes() + " bytes, " + info.millis() + " ms)");
        } catch (IOException e) {
            return error("PERSISTENCE", "Snapshot failed: " + e.getMessage());
        }
    }

    private String backup() {
        try {
            BackupManager.BackupInfo info = ctx.backups().create();
            JSONObject body = info.toJson().put("message", "Backup created");
            return json ? object(body) : ok("Backup created: " + info.path() + " (" + info.bytes() + " bytes)");
        } catch (IOException e) {
            return error("IO", "Backup failed: " + e.getMessage());
        }
    }

    private String backups() {
        try {
            JSONArray list = new JSONArray();
            for (BackupManager.BackupInfo info : ctx.backups().list()) {
                list.put(info.toJson());
            }
            return object(new JSONObject().put("backups", list).put("directory", ctx.backups().directory().toString()));
        } catch (IOException e) {
            return error("IO", "Cannot list backups: " + e.getMessage());
        }
    }

    private JSONObject info() {
        StorageEngine.Stats s = ctx.storage().stats();
        ServerMetrics m = ctx.metrics();
        Runtime rt = Runtime.getRuntime();
        ServerConfig c = ctx.config();
        JSONObject server = new JSONObject()
                .put("version", ctx.version())
                .put("protocol", PROTOCOL_VERSION)
                .put("uptimeSeconds", (System.currentTimeMillis() - m.startedAt) / 1000)
                .put("java", System.getProperty("java.version"))
                .put("os", System.getProperty("os.name") + " " + System.getProperty("os.arch"))
                .put("pid", ProcessHandle.current().pid())
                .put("cpus", rt.availableProcessors())
                .put("ioThreads", c.ioThreads())
                .put("workerThreads", c.workerThreads());
        if (admin) {
            server.put("bind", c.bindAddress() + ":" + c.port());
        }
        JSONObject clients = new JSONObject()
                .put("connected", m.connected.get())
                .put("accepted", m.accepted.sum())
                .put("rejected", m.rejected.sum())
                .put("maxClients", c.maxClients());
        JSONObject stats = new JSONObject()
                .put("commands", m.commands.sum())
                .put("opsPerSecond", Math.round(m.opsPerSecond()))
                .put("errors", m.errors.sum())
                .put("bytesIn", m.bytesIn.sum())
                .put("bytesOut", m.bytesOut.sum())
                .put("hits", s.hits())
                .put("misses", s.misses())
                .put("evictions", s.evictions())
                .put("expired", s.expirations())
                .put("loginFailures", m.loginFailures.sum())
                .put("busyRejections", m.busyRejections.sum());
        JSONObject memory = new JSONObject()
                .put("usedBytes", s.usedMemory())
                .put("maxBytes", s.maxMemory())
                .put("evictionPolicy", s.eviction())
                .put("heapUsedBytes", rt.totalMemory() - rt.freeMemory())
                .put("heapMaxBytes", rt.maxMemory());
        JSONObject persistence = new JSONObject()
                .put("enabled", s.persistence())
                .put("fsync", s.fsync())
                .put("healthy", s.healthy())
                .put("walBytes", s.walBytes())
                .put("walSegment", s.walSegment())
                .put("walRecords", s.walRecords())
                .put("walFsyncs", s.walFsyncs())
                .put("walBatches", s.walBatches())
                .put("walQueued", s.walQueued())
                .put("checkpoints", s.checkpoints())
                .put("lastCheckpointAt", s.lastCheckpointAt() == null ? JSONObject.NULL : s.lastCheckpointAt())
                .put("lastCheckpointMillis", s.lastCheckpointMillis())
                .put("snapshotBytes", s.lastSnapshotBytes())
                .put("changesSinceCheckpoint", s.changesSinceCheckpoint())
                .put("lastError", s.lastError() == null ? JSONObject.NULL : s.lastError());
        JSONObject keyspaces = new JSONObject()
                .put("projects", s.keyspaces())
                .put("keys", s.keys())
                .put("cacheKeys", s.cacheKeys())
                .put("persistentKeys", s.persistentKeys())
                .put("tables", s.tables());
        JSONObject info = new JSONObject()
                .put("server", server)
                .put("clients", clients)
                .put("stats", stats)
                .put("memory", memory)
                .put("persistence", persistence)
                .put("keyspace", keyspaces);
        if (keyspace != null) {
            info.put("project", new JSONObject()
                    .put("keys", keyspace.keyCount())
                    .put("cacheKeys", keyspace.cacheKeyCount())
                    .put("persistentKeys", keyspace.persistentKeyCount())
                    .put("tables", keyspace.tables().size()));
        }
        if (admin) {
            StorageEngine.RecoveryInfo r = ctx.storage().recoveryInfo();
            info.put("recovery", new JSONObject()
                    .put("snapshotRecords", r.snapshotRecords())
                    .put("walSegments", r.walSegments())
                    .put("walRecords", r.walRecords())
                    .put("truncatedBytes", r.truncatedBytes())
                    .put("millis", r.millis())
                    .put("migratedLegacy", r.migratedLegacy()));
        }
        return new JSONObject().put("info", info);
    }

    private String help() {
        String[] commands = {
                "PING", "HELLO", "MODE <json|text>", "LIN <group> <password>", "EXIT",
                "AUTH <token> | AUTH CREATE | AUTH DELETE <token>", "PROJECTS", "WHOAMI", "INFO",
                "SET <key> <value> [-&save] [-&cache] [-&ttl=<s>]", "GET <key> [-&from-protobuff]", "DEL <key> [-&cache|-&protobuff]",
                "UPDATE <key> <value>", "EXISTS <key>", "KEYS [pattern] [-&limit=<n>]", "MGET <key>...",
                "INCR|DECR <key> [delta] [-&save]", "EXPIRE <key> <s>", "TTL <key>", "PERSIST <key>", "DBSIZE", "HEAVEN",
                "DUMP", "IMPORT <json>", "SQL <statement>", "QUERY {\"sql\":..,\"params\":[..]}",
                "SAVE (admin)", "BACKUP (admin)", "BACKUPS (admin)"};
        if (json) {
            return new JSONObject().put("ok", true).put("commands", new JSONArray(commands)).toString();
        }
        return String.join("; ", commands);
    }
}
