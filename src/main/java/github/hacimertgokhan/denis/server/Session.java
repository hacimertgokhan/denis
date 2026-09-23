package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.backup.BackupManager;
import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.query.QueryExecutor;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.denis.sql.SqlEngine;
import github.hacimertgokhan.denis.sql.SqlException;
import github.hacimertgokhan.denis.sql.SqlResult;
import github.hacimertgokhan.denis.storage.Keyspace;
import github.hacimertgokhan.denis.storage.QuotaException;
import github.hacimertgokhan.denis.storage.Slot;
import github.hacimertgokhan.denis.storage.StorageEngine;
import github.hacimertgokhan.denis.storage.StorageException;
import github.hacimertgokhan.logger.DenisLogger;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
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
    /** {@code QUERY {"sql": ...}}: bound SQL; any other {@code QUERY {...}} is a document. */
    private static final java.util.regex.Pattern BOUND_SQL = java.util.regex.Pattern.compile("\\{\\s*\"");
    private static final List<String> FEATURES = List.of("json", "sql", "sql-params", "query-document", "ttl", "incr",
            "keys", "mget", "dump", "import", "backup", "projects", "info", "admin", "quota");

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
            return storageError(e);
        } catch (SqlException e) {
            return sqlError(e.getMessage());
        } catch (RuntimeException e) {
            log.error("Command failed for " + peer + ": " + e, e);
            return error("INTERNAL", "internal error: " + e.getMessage());
        }
    }

    /** Quota refusals carry {@code resource} and {@code limit}, as in 0.4+. */
    private String storageError(StorageException e) {
        if (json && e instanceof QuotaException q) {
            ctx.metrics().errors.increment();
            return new JSONObject().put("ok", false).put("error", q.getMessage()).put("code", q.code())
                    .put("resource", q.resource()).put("limit", q.limit()).toString();
        }
        return error(e.code(), e.getMessage());
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
            return Reply.of(storageError(e));
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
            case "LIN", "AUTH", "ADMIN", "IMPORT", "QUERY" -> command + " ***";
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
            case "ADMIN" -> {
                return admin(args);
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
                // any group may ask for a checkpoint (as in 0.3-0.5); they are serialised and cheap when nothing changed
                return async(this::save);
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
                long removed = ctx.storage().clearCache(keyspace);
                yield Reply.of(json ? "{\"ok\":true,\"message\":\"Ok.\",\"removed\":" + removed + "}" : ok("Ok."));
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
            case "QUERY" -> args.isBlank()
                    ? Reply.of(usage("USAGE: QUERY { alias: resolver(args) { fields } ... } | QUERY {\"sql\":\"...\",\"params\":[...]}"))
                    : async(() -> query(args));
            default -> Reply.of(error("UNKNOWN", "Unknown command: " + command + " (try HELP)"));
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
            case "UPDATE" -> isSqlUpdate(line);
            default -> false;
        };
    }

    /**
     * {@code UPDATE <table> SET <column> = ...} is SQL; {@code UPDATE <key> <value>} is the
     * key-value command, even when the value contains the word SET.
     */
    static boolean isSqlUpdate(String line) {
        String[] words = line.trim().split("\\s+", 4);
        return words.length == 4 && words[2].equalsIgnoreCase("SET") && words[3].contains("=");
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

    // =================================================================== ADMIN (main token)

    /**
     * {@code ADMIN <main-token> LIST|CREATE|IMPORT|USAGE|QUOTA|FLUSH|DROP ...}: project
     * administration for operators and the Denis Cloud platform, no login needed.
     * The main token is compared in constant time and wrong tokens count as failed
     * logins of the address.
     */
    private Reply admin(String args) {
        String[] words = args.trim().split("\s+");
        if (words.length < 2 || words[0].isEmpty()) {
            return Reply.of(usage("USAGE: ADMIN <main-token> LIST|CREATE|IMPORT|USAGE|QUOTA|FLUSH|DROP ..."));
        }
        long wait = ctx.loginGuard().retryAfter(peer);
        if (wait > 0) {
            return Reply.of(error("LOCKED", "Too many failed logins; try again in " + ((wait + 999) / 1000) + " s"));
        }
        String mainToken = ctx.config().mainToken();
        boolean valid = mainToken != null && !mainToken.isBlank()
                && MessageDigest.isEqual(mainToken.getBytes(StandardCharsets.UTF_8), words[0].getBytes(StandardCharsets.UTF_8));
        if (!valid) {
            ctx.loginGuard().failure(peer);
            ctx.metrics().loginFailures.increment();
            return Reply.of(error("AUTH", "ADMIN refused: wrong main token"));
        }
        ctx.loginGuard().success(peer);
        return async(() -> adminAction(words));
    }

    private String adminAction(String[] words) {
        String action = words[1].toUpperCase(Locale.ROOT);
        ProjectRegistry projects = ctx.projects();
        try {
            switch (action) {
                case "LIST" -> {
                    JSONArray list = new JSONArray();
                    List<String> tokens = new ArrayList<>();
                    for (ProjectRegistry.Project p : projects.list()) {
                        list.put(projectJson(p.token()));
                        tokens.add(p.token());
                    }
                    return json ? object(new JSONObject().put("projects", list).put("count", list.length()))
                            : tokens.isEmpty() ? "(no projects)" : String.join(" ", tokens);
                }
                case "CREATE" -> {
                    String created = projects.create(null);
                    if (words.length >= 4) {
                        setQuota(created, Long.parseLong(words[2]), Long.parseLong(words[3]));
                    }
                    return json ? object(new JSONObject().put("message", "Project created").put("token", created)) : created;
                }
                case "IMPORT" -> {
                    if (words.length < 3) {
                        return usage("USAGE: ADMIN <main-token> IMPORT <token> [maxKeys maxBytes]");
                    }
                    boolean added;
                    try {
                        added = projects.register(words[2], null);
                    } catch (IllegalArgumentException e) {
                        return error("USAGE", e.getMessage());
                    }
                    if (words.length >= 5) {
                        setQuota(words[2], Long.parseLong(words[3]), Long.parseLong(words[4]));
                    }
                    String message = added ? "Project imported" : "Project already existed";
                    return json ? object(new JSONObject().put("message", message).put("token", words[2]).put("added", added))
                            : added ? "imported" : "already existed";
                }
                case "USAGE", "QUOTA", "FLUSH", "DROP" -> {
                    if (words.length < 3 || !projects.exists(words[2])) {
                        return error("NOTFOUND", "Unknown project" + (words.length < 3 ? "" : ": " + words[2]));
                    }
                    String target = words[2];
                    switch (action) {
                        case "USAGE" -> {
                            return json ? object(projectJson(target)) : projectJson(target).toString();
                        }
                        case "QUOTA" -> {
                            if (words.length < 5) {
                                return usage("USAGE: ADMIN <main-token> QUOTA <token> <maxKeys> <maxBytes>");
                            }
                            setQuota(target, Long.parseLong(words[3]), Long.parseLong(words[4]));
                            return json ? object(projectJson(target).put("message", "Quota updated")) : ok("Quota updated");
                        }
                        case "FLUSH" -> {
                            Keyspace ks = ctx.storage().findKeyspace(target);
                            if (ks != null) {
                                ctx.storage().purge(ks).join();
                            }
                            return ok("Project emptied: " + target);
                        }
                        default -> {
                            ctx.storage().dropKeyspace(target).join();
                            projects.delete(target);
                            return ok("Project deleted: " + target);
                        }
                    }
                }
                default -> {
                    return usage("USAGE: ADMIN <main-token> LIST|CREATE|IMPORT|USAGE|QUOTA|FLUSH|DROP ...");
                }
            }
        } catch (NumberFormatException e) {
            return error("USAGE", "Limits must be integers (0 = unlimited)");
        } catch (IOException e) {
            log.error("ADMIN " + action + " failed: " + e.getMessage());
            return error("IO", "Could not update the project registry");
        }
    }

    private void setQuota(String projectToken, long maxKeys, long maxBytes) throws IOException {
        ctx.projects().setQuota(projectToken, new ProjectRegistry.Quota(maxKeys, maxBytes));
        Keyspace ks = ctx.storage().findKeyspace(projectToken);
        if (ks != null) {
            ks.setQuota(maxKeys, maxBytes);
        }
    }

    /** {@code {token, usage:{cachedKeys,cachedBytes,persistedKeys,persistedBytes}, quota:{maxKeys,maxBytes}}} */
    private JSONObject projectJson(String projectToken) {
        return new JSONObject()
                .put("token", projectToken)
                .put("usage", usageJson(ctx.storage().findKeyspace(projectToken)))
                .put("quota", ctx.projects().quota(projectToken).toJson());
    }

    private static JSONObject usageJson(Keyspace ks) {
        return new JSONObject()
                .put("cachedKeys", ks == null ? 0 : ks.cacheKeyCount())
                .put("cachedBytes", ks == null ? 0 : ks.cacheBytes())
                .put("persistedKeys", ks == null ? 0 : ks.persistedKeys())
                .put("persistedBytes", ks == null ? 0 : ks.persistedBytes());
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
        ProjectRegistry.Quota quota = ctx.projects().quota(candidate);
        keyspace.setQuota(quota.maxKeys(), quota.maxBytes());
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
        List<String> shown = new ArrayList<>(truncated ? keys.subList(0, limit) : keys);
        shown.sort(null);
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
        // written by hand: JSONObject would not keep the requested key order
        StringBuilder data = new StringBuilder(16 + keys.length * 24).append('{');
        Set<String> seen = new HashSet<>();
        for (String key : keys) {
            if (!seen.add(key)) {
                continue;
            }
            Slot slot = ctx.storage().read(keyspace, key);
            String value = slot == null ? null : slot.cache() != null ? slot.cache() : slot.persistent();
            if (data.length() > 1) {
                data.append(',');
            }
            data.append(JSONObject.quote(key)).append(':').append(value == null ? "null" : JSONObject.quote(value));
        }
        String object = data.append('}').toString();
        if (json) {
            // "values" is the field name of Denis 0.3-0.5
            return Reply.of("{\"ok\":true,\"data\":" + object + ",\"values\":" + object + "}");
        }
        return Reply.of(object);
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

    /** Everything an IMPORT line could fail on after it started writing; null when it is fine. */
    private String validateImport(JSONObject data, boolean replace, boolean append) {
        for (String section : new String[]{"persistent", "cache"}) {
            if (data.has(section) && data.optJSONObject(section) == null) {
                return "\"" + section + "\" must be an object";
            }
            JSONObject values = data.optJSONObject(section);
            if (values == null) {
                continue;
            }
            for (String key : values.keySet()) {
                if (key.isEmpty() || key.chars().anyMatch(Character::isWhitespace)) {
                    return "invalid key in \"" + section + "\": " + JSONObject.quote(key);
                }
                if (key.startsWith(StorageEngine.RESERVED_PREFIX)) {
                    return "reserved key in \"" + section + "\": " + key;
                }
            }
        }
        JSONObject tables = data.optJSONObject("tables");
        if (data.has("tables") && tables == null) {
            return "\"tables\" must be an object";
        }
        if (tables != null) {
            for (String name : tables.keySet()) {
                JSONObject def = tables.optJSONObject(name);
                // table problems keep the SQL error code clients already expect from IMPORT
                if (def == null || def.optJSONArray("columns") == null) {
                    throw new SqlException("Bad table definition for " + name + ": \"columns\" is missing");
                }
                if (!replace && !append && keyspace.table(name.toLowerCase(Locale.ROOT)) != null) {
                    throw new SqlException("Table already exists: " + name + " (import with replace to overwrite)");
                }
            }
        }
        return null;
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
        String problem = validateImport(data, replace, append);
        if (problem != null) {
            // checked before anything is written, so a refused line changes nothing
            return error("USAGE", problem);
        }
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
            return result.toJsonLine();
        }
        return result.legacyText();
    }

    /** {@code QUERY {"sql": "...", "params": [...]}} — parameterised SQL, always answered as a SQL result. */
    private String query(String args) {
        String document = args.strip();
        // a document field starts with an identifier, a JSON request with a quoted key
        if (!BOUND_SQL.matcher(document).lookingAt()) {
            // the document reply is JSON in both modes (as in 0.4/0.5)
            return new QueryExecutor(ctx.storage(), ctx.sql(), keyspace).run(document).toString();
        }
        JSONObject request;
        try {
            request = new JSONObject(document);
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
            JSONObject body = new JSONObject().put("message", "Saved.").put("bytes", info.bytes())
                    .put("records", info.records()).put("millis", info.millis());
            return json ? object(body) : ok("Saved.");
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
        // the top-level fields are the INFO reply of 0.3-0.5, which Denis Cloud and older clients read
        JSONObject result = new JSONObject()
                .put("version", ctx.version())
                .put("uptimeSeconds", (System.currentTimeMillis() - m.startedAt) / 1000)
                .put("startedAt", java.time.Instant.ofEpochMilli(m.startedAt).toString())
                .put("connections", new JSONObject().put("open", m.connected.get()).put("total", m.accepted.sum()))
                .put("commandsTotal", m.commands.sum())
                .put("cacheKeys", s.cacheKeys())
                .put("persistedKeys", s.persistentKeys())
                .put("persistedDirty", s.changesSinceCheckpoint() > 0)
                .put("projects", ctx.projects().size())
                .put("group", group)
                .put("memory", new JSONObject().put("usedMb", (rt.totalMemory() - rt.freeMemory()) / 1024 / 1024)
                        .put("maxMb", rt.maxMemory() / 1024 / 1024))
                .put("info", info);
        if (keyspace != null) {
            ProjectRegistry.Quota quota = ctx.projects().quota(token);
            result.put("project", usageJson(keyspace).put("quota", quota.toJson()));
        }
        return result;
    }

    /** One entry of HELP (the shape of 0.3-0.5: name, usage, description, needsLogin, needsProject). */
    private record CommandDoc(String name, String usage, String description, boolean needsLogin, boolean needsProject) {
        JSONObject toJson() {
            return new JSONObject().put("name", name).put("usage", usage).put("description", description)
                    .put("needsLogin", needsLogin).put("needsProject", needsProject);
        }
    }

    private static final List<CommandDoc> COMMANDS = List.of(
            new CommandDoc("PING", "PING", "Liveness check", false, false),
            new CommandDoc("HELLO", "HELLO", "Server name, version, protocol and features", false, false),
            new CommandDoc("MODE", "MODE <json|text>", "Reply format of this connection", false, false),
            new CommandDoc("HELP", "HELP", "This list", false, false),
            new CommandDoc("LIN", "LIN <group> <password>", "Log in with a group", false, false),
            new CommandDoc("ADMIN", "ADMIN <main-token> LIST|CREATE|IMPORT|USAGE|QUOTA|FLUSH|DROP ...", "Project administration with the main token", false, false),
            new CommandDoc("EXIT", "EXIT", "Close the connection", false, false),
            new CommandDoc("AUTH", "AUTH <token> | AUTH CREATE | AUTH DELETE <token>", "Select, create or delete a project", true, false),
            new CommandDoc("PROJECTS", "PROJECTS", "Projects this group can open", true, false),
            new CommandDoc("WHOAMI", "WHOAMI", "Group, admin flag and current project", true, false),
            new CommandDoc("INFO", "INFO", "Server statistics", true, false),
            new CommandDoc("SAVE", "SAVE", "Write a snapshot now", true, false),
            new CommandDoc("BACKUP", "BACKUP", "Create a verified backup (admin groups)", true, false),
            new CommandDoc("BACKUPS", "BACKUPS", "List backups (admin groups)", true, false),
            new CommandDoc("SET", "SET <key> <value> [-&save] [-&cache] [-&ttl=<s>]", "Write a value; -&save also writes the durable layer", true, true),
            new CommandDoc("GET", "GET <key> [-&from-protobuff] [-&asa-json]", "Read a value (cache first)", true, true),
            new CommandDoc("DEL", "DEL <key> [-&cache|-&protobuff]", "Delete a key", true, true),
            new CommandDoc("UPDATE", "UPDATE <key> <value>", "Overwrite the cache value", true, true),
            new CommandDoc("EXISTS", "EXISTS <key>", "Whether a key exists", true, true),
            new CommandDoc("KEYS", "KEYS [pattern] [-&cache|-&protobuff] [-&limit=<n>]", "Keys matching a glob", true, true),
            new CommandDoc("MGET", "MGET <key> [<key> ...]", "Several values at once", true, true),
            new CommandDoc("INCR", "INCR|DECR <key> [delta] [-&save]", "Atomic counter", true, true),
            new CommandDoc("EXPIRE", "EXPIRE <key> <seconds> | TTL <key> | PERSIST <key>", "Time to live of the cache value", true, true),
            new CommandDoc("DBSIZE", "DBSIZE", "Key and table counts of the project", true, true),
            new CommandDoc("HEAVEN", "HEAVEN", "Drop every cache value of the project", true, true),
            new CommandDoc("DUMP", "DUMP", "Export the project as JSON", true, true),
            new CommandDoc("IMPORT", "IMPORT <json>", "Import a DUMP (replace/append for tables)", true, true),
            new CommandDoc("QUERY", "QUERY { alias: resolver(args) { fields } ... } | QUERY {\"sql\":..,\"params\":[..]}",
                    "Many reads in one round trip, or SQL with bound parameters", true, true),
            new CommandDoc("SQL", "SQL <statement>", "Run a SQL statement (also typed directly)", true, true));

    private String help() {
        if (json) {
            JSONArray commands = new JSONArray();
            COMMANDS.forEach(c -> commands.put(c.toJson()));
            return new JSONObject().put("ok", true).put("commands", commands).toString();
        }
        StringBuilder text = new StringBuilder("Denis commands:");
        for (CommandDoc c : COMMANDS) {
            text.append(" | ").append(c.usage());
        }
        return text.toString();
    }
}
