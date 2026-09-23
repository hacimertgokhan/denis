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

    static Command<Map<String, Object>> info() {
        return new Command<>("INFO", r -> Protocol.object(Protocol.field(r, "info"), "info"));
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
            Map<String, Object> data = Protocol.object(Protocol.field(r, "data"), "data");
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

    static Command<Void> clear() {
        return new Command<>("HEAVEN", NOTHING);
    }

    // =================================================================== SQL

    static Command<QueryResult> query(String sql, List<?> params) {
        return new Command<>(queryLine(sql, params), QueryResult::from);
    }

    /** Legacy text result of a statement (sent as {@code QUERY} so multi-line SQL works). */
    static Command<String> sql(String statement) {
        return new Command<>(queryLine(statement, List.of()), r -> Protocol.optString(r, "data"));
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
