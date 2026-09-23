package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Builds the protocol-2 command lines and their reply decoders. Validates arguments (INVALID). */
final class Commands {
    private Commands() {
    }

    private static final Command.Decoder<Void> NOTHING = r -> null;

    // =================================================================== connection / session

    static Command<Void> modeJson() {
        return new Command<>("MODE json", NOTHING);
    }

    static Command<Map<String, Object>> login(String group, String password) {
        return new Command<>("LIN " + Protocol.word("group", group) + " " + Protocol.password(password), Protocol::body);
    }

    static Command<Void> auth(String token) {
        String t = Protocol.word("token", token);
        if (t.equalsIgnoreCase("CREATE") || t.equalsIgnoreCase("DELETE")) {
            throw Protocol.invalid("\"" + t + "\" is not a project token");
        }
        return new Command<>("AUTH " + t, NOTHING);
    }

    static Command<String> createProject() {
        return new Command<>("AUTH CREATE", r -> Protocol.string(r, "token"));
    }

    static Command<Void> deleteProject(String token) {
        return new Command<>("AUTH DELETE " + Protocol.word("token", token), NOTHING);
    }

    static Command<Boolean> ping() {
        return new Command<>("PING", r -> Boolean.TRUE);
    }

    static Command<ServerHello> hello() {
        return new Command<>("HELLO", ServerHello::from);
    }

    static Command<List<String>> help() {
        return new Command<>("HELP", r -> Protocol.strings(r, "commands"));
    }

    static Command<Map<String, Object>> whoami() {
        return new Command<>("WHOAMI", Protocol::body);
    }

    static Command<ServerInfo> info() {
        return new Command<>("INFO", ServerInfo::from);
    }

    static Command<List<Project>> projects() {
        return new Command<>("PROJECTS", r -> {
            List<Project> list = new ArrayList<>();
            for (Object o : Protocol.list(r, "projects")) {
                list.add(Project.from(Protocol.object(o, "projects[]")));
            }
            return Collections.unmodifiableList(list);
        });
    }

    // =================================================================== keys

    static Command<String> get(String key) {
        return new Command<>("GET " + Protocol.key(key), r -> Protocol.string(r, "data"), true);
    }

    static Command<String> getPersistent(String key) {
        return new Command<>("GET " + Protocol.key(key) + " -&from-protobuff", r -> Protocol.string(r, "data"), true);
    }

    static Command<Void> set(String key, String value, SetOptions options) {
        Protocol.key(key);
        Protocol.value(value);
        StringBuilder line = new StringBuilder(key.length() + value.length() + 24);
        line.append("SET ").append(key).append(' ').append(value);
        if (options != null) {
            if (options.isPersistent()) {
                line.append(" -&save");
            }
            if (options.ttl() != null) {
                line.append(" -&ttl=").append(Protocol.seconds(options.ttl(), "ttl"));
            }
        }
        return new Command<>(line.toString(), NOTHING);
    }

    static Command<Void> update(String key, String value) {
        return new Command<>("UPDATE " + Protocol.key(key) + " " + Protocol.value(value), NOTHING);
    }

    static Command<Boolean> del(String key, DelOptions options) {
        String flag = options == null ? "" : options.flag();
        return new Command<>("DEL " + Protocol.key(key) + flag, r -> Protocol.bool(r, "deleted"));
    }

    static Command<Boolean> exists(String key) {
        return new Command<>("EXISTS " + Protocol.key(key), r -> Protocol.bool(r, "exists"));
    }

    static Command<List<String>> keys(String pattern, KeysOptions options) {
        StringBuilder line = new StringBuilder("KEYS");
        if (pattern != null) {
            line.append(' ').append(Protocol.word("pattern", pattern));
        }
        if (options != null) {
            line.append(options.flags());
        }
        return new Command<>(line.toString(), r -> Protocol.strings(r, "keys"));
    }

    static Command<Map<String, String>> mget(Collection<String> keys) {
        if (keys == null || keys.isEmpty()) {
            throw Protocol.invalid("MGET needs at least one key");
        }
        List<String> ordered = new ArrayList<>(keys.size());
        StringBuilder line = new StringBuilder("MGET");
        for (String k : keys) {
            line.append(' ').append(Protocol.key(k));
            ordered.add(k);
        }
        return new Command<>(line.toString(), r -> {
            // "data" (0.1 servers) and "values" (master-line servers up to 0.6) carry the same object; current servers send both
            Object raw = r.get("data") instanceof Map ? r.get("data") : r.get("values");
            Map<String, Object> data = Protocol.object(raw != null ? raw : Protocol.field(r, "data"), "data");
            Map<String, String> out = new LinkedHashMap<>();
            for (String k : ordered) {
                Object v = data.get(k);
                out.put(k, v == null ? null : String.valueOf(v));
            }
            return Collections.unmodifiableMap(out);
        });
    }

    static Command<Long> incr(String key, long delta, boolean decrement, boolean persist) {
        StringBuilder line = new StringBuilder(decrement ? "DECR " : "INCR ").append(Protocol.key(key));
        if (delta != 1) {
            line.append(' ').append(delta);
        }
        if (persist) {
            line.append(" -&save");
        }
        return new Command<>(line.toString(), r -> Protocol.number(r, "value"));
    }

    static Command<Boolean> expire(String key, Duration ttl) {
        return new Command<>("EXPIRE " + Protocol.key(key) + " " + Protocol.seconds(ttl, "ttl"), r -> Protocol.bool(r, "updated"));
    }

    static Command<Long> ttl(String key) {
        return new Command<>("TTL " + Protocol.key(key), r -> Protocol.number(r, "ttl"));
    }

    static Command<Long> pttl(String key) {
        return new Command<>("TTL " + Protocol.key(key), r -> Protocol.number(r, "ttlMillis"));
    }

    static Command<Boolean> persist(String key) {
        return new Command<>("PERSIST " + Protocol.key(key), r -> Protocol.bool(r, "updated"));
    }

    static Command<DbSize> dbsize() {
        return new Command<>("DBSIZE", DbSize::from);
    }

    /** {@code HEAVEN}: the number of dropped cache values, or -1 when the server does not report it. */
    static Command<Long> clear() {
        return new Command<>("HEAVEN", r -> Protocol.optNumber(r, "removed", -1));
    }

    // =================================================================== SQL

    static Command<QueryResult> query(String sql, List<?> params) {
        return new Command<>(queryLine(sql, params), QueryResult::from, false, "SQL");
    }

    /** The structured result of a statement without parameters (1.2 {@code sql}). */
    static Command<QueryResult> sql(String statement) {
        return query(statement, List.of());
    }

    /** The text form of a statement's result (sent as {@code QUERY} so multi-line SQL works). */
    static Command<String> sqlText(String statement) {
        return new Command<>(queryLine(statement, List.of()), r -> text(QueryResult.from(r)), false, "SQL");
    }

    /** The reply's {@code data}, or the text a master-line server (up to 0.6) prints for the result when there is none. */
    private static String text(QueryResult r) {
        if (r.data() != null) {
            return r.data();
        }
        switch (r.type()) {
            case QueryResult.AFFECTED:
                return "OK: " + (r.message() != null ? r.message() : r.affected() + " row(s) affected");
            case QueryResult.TABLES:
                return Json.write(r.asMap().get("tables"));
            default:
                return Json.write(r.asMap().containsKey("rows") ? r.asMap().get("rows") : r.toMaps());
        }
    }

    /** A change: the affected row count; a statement that returns rows fails (1.2 {@code execute}). */
    static Command<Integer> execute(String sql, List<?> params) {
        return new Command<>(queryLine(sql, params), r -> {
            QueryResult result = QueryResult.from(r);
            if (!QueryResult.AFFECTED.equals(result.type())) {
                throw new DenisException(DenisException.ERROR, "execute() expects a statement that changes data, but it returned "
                        + result.type() + "; use query() for SELECT, SHOW TABLES and DESCRIBE", result.asMap(), null);
            }
            long n = result.affected();
            return n > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) n;
        }, false, "SQL");
    }

    static Command<List<TableInfo>> tables() {
        return new Command<>(queryLine("SHOW TABLES", List.of()), TableInfo::listFrom, false, "SQL");
    }

    static Command<TableInfo> describe(String table) {
        String name = Protocol.word("table", table);
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (!(Character.isLetterOrDigit(c) || c == '_' || c == '$' || c == '.' || c == ':' || c == '-')) {
                throw Protocol.invalid("table name may only contain letters, digits and _ $ . : -: " + Json.quote(name));
            }
        }
        return new Command<>(queryLine("DESCRIBE " + name, List.of()), r -> {
            List<TableInfo> tables = TableInfo.listFrom(r);
            if (tables.isEmpty()) {
                throw Protocol.protocol("DESCRIBE " + name + " returned no table");
            }
            return tables.get(0);
        }, false, "SQL");
    }

    /**
     * {@code QUERY { ... }} with a GraphQL-shaped document. Line breaks
     * between tokens become spaces (the protocol is one line per command);
     * a line break inside a string literal cannot be sent.
     */
    static Command<GraphResult> graph(String document) {
        if (document == null || document.isBlank()) {
            throw Protocol.invalid("QUERY document must not be empty");
        }
        String doc = document.trim();
        if (doc.charAt(0) != '{') {
            throw Protocol.invalid("a QUERY document starts with '{', e.g. { user: get(\"user:1\") { name } }");
        }
        if (doc.substring(1).stripLeading().startsWith("\"")) {
            // {"sql": ...} would be run as a bound SQL statement (possibly a write), not as a document
            Map<String, Object> json;
            try {
                json = Json.parseObject(doc);
            } catch (RuntimeException notJson) {
                json = null;
            }
            if (json != null && json.containsKey("sql")) {
                throw Protocol.invalid("{\"sql\":...} is a SQL request, not a QUERY document; use query(sql, params...)");
            }
        }
        StringBuilder line = new StringBuilder(doc.length() + 6).append("QUERY ");
        boolean inString = false;
        for (int i = 0; i < doc.length(); i++) {
            char c = doc.charAt(i);
            if (inString) {
                if (c == '\n' || c == '\r') {
                    throw Protocol.invalid("a string in a QUERY document must not contain a line break; escape it as \\n");
                }
                if (c == '\\' && i + 1 < doc.length() && doc.charAt(i + 1) != '\n' && doc.charAt(i + 1) != '\r') {
                    line.append(c).append(doc.charAt(++i));
                    continue;
                }
                if (c == '"') {
                    inString = false;
                }
                line.append(c);
            } else if (c == '\n' || c == '\r') {
                line.append(' ');
            } else {
                if (c == '"') {
                    inString = true;
                }
                line.append(c);
            }
        }
        return new Command<>(line.toString(), GraphResult::from);
    }

    private static String queryLine(String sql, List<?> params) {
        if (sql == null || sql.isBlank()) {
            throw Protocol.invalid("SQL statement must not be empty");
        }
        List<Object> converted = new ArrayList<>(params == null ? 0 : params.size());
        if (params != null) {
            for (Object p : params) {
                converted.add(Protocol.param(p));
            }
        }
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("sql", sql);
        request.put("params", converted);
        return "QUERY " + Json.write(request);
    }

    // =================================================================== dump / import

    static Command<String> dump() {
        return new Command<>("DUMP", r -> Json.write(Protocol.body(r)));
    }

    static Command<ImportResult> importChunk(Map<String, Object> chunk) {
        return new Command<>("IMPORT " + Json.write(chunk), ImportResult::from);
    }

    /**
     * Split a dump into {@code IMPORT} objects whose JSON stays under
     * {@code maxBytes} where possible: keys in batches (a TTL always travels
     * with its cache value), every table in its own object, and a table that
     * is too big for one object is created by the first one and filled by
     * {@code "append":true} objects. Only a single oversized key or row can
     * exceed the limit. The objects must be imported in order.
     */
    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> importChunks(String dumpJson, boolean replace, int maxBytes) {
        Map<String, Object> dump;
        try {
            dump = Json.parseObject(dumpJson);
        } catch (Json.JsonException e) {
            throw new DenisException(DenisException.INVALID, "dump is not a JSON object: " + e.getMessage(), null, e);
        } catch (NullPointerException e) {
            throw Protocol.invalid("dump must not be null");
        }
        dump.remove("ok");
        dump.put("replace", replace);
        if (Json.utf8Length(Json.write(dump)) <= maxBytes) {
            return List.of(dump);
        }
        Map<String, Object> base = new LinkedHashMap<>(dump);
        Object persistent = base.remove("persistent");
        Object cache = base.remove("cache");
        Object ttl = base.remove("ttl");
        Object tables = base.remove("tables");
        Map<String, Object> ttls = ttl instanceof Map ? (Map<String, Object>) ttl : Map.of();
        long baseBytes = Json.utf8Length(Json.write(base)) + 64;

        List<Map<String, Object>> chunks = new ArrayList<>();
        ChunkBuilder builder = new ChunkBuilder(base, baseBytes, maxBytes, chunks);
        if (persistent instanceof Map) {
            for (Map.Entry<String, Object> e : ((Map<String, Object>) persistent).entrySet()) {
                builder.add("persistent", e.getKey(), e.getValue(), null);
            }
        }
        if (cache instanceof Map) {
            for (Map.Entry<String, Object> e : ((Map<String, Object>) cache).entrySet()) {
                builder.add("cache", e.getKey(), e.getValue(), ttls.get(e.getKey()));
            }
        }
        builder.flush();
        if (tables instanceof Map) {
            for (Map.Entry<String, Object> e : ((Map<String, Object>) tables).entrySet()) {
                splitTable(base, baseBytes, maxBytes, e.getKey(), e.getValue(), chunks);
            }
        }
        if (chunks.isEmpty()) {
            chunks.add(base);
        }
        return chunks;
    }

    @SuppressWarnings("unchecked")
    private static void splitTable(Map<String, Object> base, long baseBytes, long maxBytes, String name, Object definition,
                                   List<Map<String, Object>> chunks) {
        long nameBytes = Json.utf8Length(Json.quote(name)) + 16;
        if (!(definition instanceof Map) || baseBytes + nameBytes + Json.utf8Length(Json.write(definition)) <= maxBytes
                || !(((Map<String, Object>) definition).get("rows") instanceof List)) {
            chunks.add(tableChunk(base, name, definition, false));
            return;
        }
        Map<String, Object> def = (Map<String, Object>) definition;
        List<Object> rows = (List<Object>) def.get("rows");
        Map<String, Object> header = new LinkedHashMap<>(def);
        header.remove("rows");
        Map<String, Object> appendHeader = new LinkedHashMap<>();
        appendHeader.put("columns", def.get("columns"));
        long headerBytes = baseBytes + nameBytes + Json.utf8Length(Json.write(header)) + 16;
        long appendHeaderBytes = baseBytes + nameBytes + Json.utf8Length(Json.write(appendHeader)) + 32;

        boolean first = true;
        List<Object> batch = new ArrayList<>();
        long bytes = headerBytes;
        for (Object row : rows) {
            long rowBytes = Json.utf8Length(Json.write(row)) + 1;
            if (!batch.isEmpty() && bytes + rowBytes > maxBytes) {
                Map<String, Object> part = new LinkedHashMap<>(first ? header : appendHeader);
                part.put("rows", batch);
                chunks.add(tableChunk(base, name, part, !first));
                first = false;
                batch = new ArrayList<>();
                bytes = appendHeaderBytes;
            }
            batch.add(row);
            bytes += rowBytes;
        }
        Map<String, Object> part = new LinkedHashMap<>(first ? header : appendHeader);
        part.put("rows", batch);
        chunks.add(tableChunk(base, name, part, !first));
    }

    private static Map<String, Object> tableChunk(Map<String, Object> base, String name, Object definition, boolean append) {
        Map<String, Object> chunk = new LinkedHashMap<>(base);
        if (append) {
            chunk.put("append", true);
        }
        Map<String, Object> one = new LinkedHashMap<>();
        one.put(name, definition);
        chunk.put("tables", one);
        return chunk;
    }

    private static final class ChunkBuilder {
        private final Map<String, Object> base;
        private final long baseBytes;
        private final long maxBytes;
        private final List<Map<String, Object>> out;
        private Map<String, Object> current;
        private long bytes;

        ChunkBuilder(Map<String, Object> base, long baseBytes, long maxBytes, List<Map<String, Object>> out) {
            this.base = base;
            this.baseBytes = baseBytes;
            this.maxBytes = maxBytes;
            this.out = out;
        }

        @SuppressWarnings("unchecked")
        void add(String section, String key, Object value, Object ttl) {
            long size = Json.utf8Length(Json.quote(key)) * (ttl == null ? 1 : 2) + Json.utf8Length(Json.write(value))
                    + (ttl == null ? 0 : Json.write(ttl).length()) + 4;
            if (current != null && bytes + size > maxBytes) {
                flush();
            }
            if (current == null) {
                current = new LinkedHashMap<>(base);
                bytes = baseBytes;
            }
            ((Map<String, Object>) current.computeIfAbsent(section, s -> new LinkedHashMap<>())).put(key, value);
            if (ttl != null) {
                ((Map<String, Object>) current.computeIfAbsent("ttl", s -> new LinkedHashMap<>())).put(key, ttl);
            }
            bytes += size;
        }

        void flush() {
            if (current != null) {
                out.add(current);
                current = null;
            }
        }
    }

    // =================================================================== admin

    static Command<SaveInfo> save() {
        return new Command<>("SAVE", SaveInfo::from);
    }

    static Command<BackupInfo> backup() {
        return new Command<>("BACKUP", BackupInfo::from);
    }

    static Command<List<BackupInfo>> backups() {
        return new Command<>("BACKUPS", r -> {
            List<BackupInfo> list = new ArrayList<>();
            for (Object o : Protocol.list(r, "backups")) {
                list.add(BackupInfo.from(Protocol.object(o, "backups[]")));
            }
            return Collections.unmodifiableList(list);
        });
    }

    // =================================================================== ADMIN <main-token> (project administration)

    private static String admin(String mainToken, String action) {
        return "ADMIN " + Protocol.secretWord("main token", mainToken) + " " + action;
    }

    private static String limits(long maxKeys, long maxBytes) {
        if (maxKeys < 0 || maxBytes < 0) {
            throw Protocol.invalid("quota limits must be 0 (unlimited) or positive: " + maxKeys + ", " + maxBytes);
        }
        return " " + maxKeys + " " + maxBytes;
    }

    static Command<List<ProjectUsage>> adminList(String mainToken) {
        return new Command<>(admin(mainToken, "LIST"), r -> {
            List<ProjectUsage> list = new ArrayList<>();
            for (Object o : Protocol.list(r, "projects")) {
                list.add(ProjectUsage.from(Protocol.object(o, "projects[]")));
            }
            return Collections.unmodifiableList(list);
        });
    }

    static Command<String> adminCreate(String mainToken, Long maxKeys, Long maxBytes) {
        String line = admin(mainToken, "CREATE") + (maxKeys == null ? "" : limits(maxKeys, maxBytes));
        return new Command<>(line, r -> Protocol.string(r, "token"));
    }

    static Command<Boolean> adminImport(String mainToken, String token, Long maxKeys, Long maxBytes) {
        String line = admin(mainToken, "IMPORT " + Protocol.word("token", token)) + (maxKeys == null ? "" : limits(maxKeys, maxBytes));
        return new Command<>(line, r -> !Boolean.FALSE.equals(r.get("added")));
    }

    static Command<ProjectUsage> adminUsage(String mainToken, String token) {
        return new Command<>(admin(mainToken, "USAGE " + Protocol.word("token", token)), ProjectUsage::from);
    }

    static Command<ProjectUsage> adminQuota(String mainToken, String token, long maxKeys, long maxBytes) {
        return new Command<>(admin(mainToken, "QUOTA " + Protocol.word("token", token)) + limits(maxKeys, maxBytes),
                ProjectUsage::from);
    }

    static Command<Void> adminFlush(String mainToken, String token) {
        return new Command<>(admin(mainToken, "FLUSH " + Protocol.word("token", token)), NOTHING);
    }

    static Command<Void> adminDrop(String mainToken, String token) {
        return new Command<>(admin(mainToken, "DROP " + Protocol.word("token", token)), NOTHING);
    }

    // =================================================================== raw

    /** Any single command line; session-changing commands must use the dedicated methods. */
    static Command<Map<String, Object>> raw(String line) {
        if (line == null || line.isBlank()) {
            throw Protocol.invalid("command must not be empty (the server does not answer blank lines)");
        }
        Protocol.noLineBreaks("command", line);
        String trimmed = line.trim();
        String[] words = trimmed.split("\\s+", 3);
        String command = words[0].toUpperCase(Locale.ROOT);
        switch (command) {
            case "MODE":
            case "EXIT":
            case "QUIT":
                throw Protocol.invalid(command + " would break the driver's connection; it cannot be sent with command()");
            case "LIN":
                throw Protocol.invalid("use login(group, password) so every pooled connection logs in and reconnects keep the login");
            case "AUTH":
                if (words.length < 2 || !(words[1].equalsIgnoreCase("CREATE") || words[1].equalsIgnoreCase("DELETE"))) {
                    throw Protocol.invalid("use use(token) so every pooled connection selects the project and reconnects keep it");
                }
                break;
            default:
                break;
        }
        return new Command<>(trimmed, Protocol::body);
    }
}
