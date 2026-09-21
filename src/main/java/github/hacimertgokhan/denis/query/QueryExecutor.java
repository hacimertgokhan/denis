package github.hacimertgokhan.denis.query;

import github.hacimertgokhan.denis.query.QueryParser.Field;
import github.hacimertgokhan.denis.server.ProjectStore;
import github.hacimertgokhan.denis.sql.SqlQueryEngine;
import github.hacimertgokhan.denis.sql.SqlResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Runs a {@code QUERY} document against one project: every top-level field
 * is resolved independently, results are shaped by the selection below the
 * field, and a failing field reports an error under its path without
 * failing the others (the GraphQL contract).
 *
 * <p>Resolvers, all read-only:
 * <pre>
 *   get(key)                       the value; with a selection the value is parsed as JSON and projected
 *   mget(k1, k2, ...)              { key: value }; values projected like get
 *   prefix("cart:1:")              every key with that prefix as { key: value }
 *   keys(pattern)                  [key]
 *   exists(key)                    true | false
 *   count(table)                   number of rows
 *   table(name, where:, order:, limit:, offset:)
 *                                  rows; the selection names the columns (SELECT col, ... FROM name)
 *   sql("SELECT ...")              rows of a SELECT; the selection projects columns
 *   tables()                       [{ name, columns, rows }]
 *   describe(table)                { name, columns, rows }
 * </pre>
 */
public final class QueryExecutor {

    private static final int MAX_FIELDS = 64;
    private static final Pattern IDENT = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    private final ProjectStore store;
    private final SqlQueryEngine sql;

    public QueryExecutor(ProjectStore store) {
        this.store = store;
        this.sql = new SqlQueryEngine(store);
    }

    /** Parses and runs the document; the reply always has {@code ok} and {@code data}, plus {@code errors} when any field failed. */
    public JSONObject run(String document) {
        JSONObject reply = new JSONObject();
        List<Field> fields;
        try {
            fields = QueryParser.parse(document);
        } catch (QueryParser.ParseException e) {
            return reply.put("ok", false).put("error", "syntax: " + e.getMessage()).put("offset", e.offset());
        }
        if (fields.size() > MAX_FIELDS) {
            return reply.put("ok", false).put("error", "a document selects at most " + MAX_FIELDS + " fields");
        }
        JSONObject data = new JSONObject();
        JSONArray errors = new JSONArray();
        for (Field f : fields) {
            try {
                data.put(f.alias(), wrapNull(resolve(f)));
            } catch (QueryError | IllegalArgumentException | JSONException e) {
                data.put(f.alias(), JSONObject.NULL);
                errors.put(new JSONObject().put("path", f.alias()).put("error", e.getMessage()));
            }
        }
        reply.put("ok", true).put("data", data);
        if (!errors.isEmpty()) {
            reply.put("errors", errors);
        }
        return reply;
    }

    private Object resolve(Field f) {
        return switch (f.name().toLowerCase(Locale.ROOT)) {
            case "get" -> {
                String key = key(f, "key", 0);
                String value = store.get(key);
                yield value == null ? null : shape(value, f);
            }
            case "mget" -> {
                if (f.args().isEmpty()) {
                    throw new QueryError("mget needs at least one key");
                }
                JSONObject out = new JSONObject();
                for (QueryParser.Arg a : f.args()) {
                    String key = str(a.value(), "key");
                    String value = store.get(key);
                    out.put(key, value == null ? JSONObject.NULL : shape(value, f));
                }
                yield out;
            }
            case "prefix" -> {
                String prefix = key(f, "prefix", 0);
                JSONObject out = new JSONObject();
                for (Map.Entry<String, String> e : store.entriesWithPrefix(prefix).entrySet()) {
                    out.put(e.getKey(), shape(e.getValue(), f));
                }
                yield out;
            }
            case "keys" -> {
                Object pattern = f.arg("pattern", 0);
                yield new JSONArray(store.keys(pattern == null ? "*" : str(pattern, "pattern")));
            }
            case "exists" -> store.exists(key(f, "key", 0));
            case "count" -> {
                String table = ident(f.arg("table", 0), "table");
                SqlResult r = sql.execute("SELECT COUNT(*) FROM " + table);
                yield r.ok() ? r.rows().getJSONObject(0).get("count") : fail(r);
            }
            case "table" -> {
                String table = ident(f.arg("name", 0), "name");
                StringBuilder q = new StringBuilder("SELECT ");
                if (f.hasSelection()) {
                    List<Field> cols = f.selection();
                    for (int i = 0; i < cols.size(); i++) {
                        q.append(i > 0 ? ", " : "").append(ident(cols.get(i).name(), "column"));
                    }
                } else {
                    q.append("*");
                }
                q.append(" FROM ").append(table);
                Object where = f.arg("where", 1);
                if (where != null) {
                    q.append(" WHERE ").append(str(where, "where"));
                }
                Object order = f.arg("order", -1);
                if (order != null) {
                    q.append(" ORDER BY ").append(str(order, "order"));
                }
                Object limit = f.arg("limit", -1);
                if (limit != null) {
                    q.append(" LIMIT ").append(number(limit, "limit"));
                    Object offset = f.arg("offset", -1);
                    if (offset != null) {
                        q.append(" OFFSET ").append(number(offset, "offset"));
                    }
                }
                SqlResult r = sql.execute(q.toString());
                yield r.ok() ? projectRows(r.rows(), f) : fail(r);
            }
            case "sql" -> {
                String statement = str(f.arg("statement", 0), "statement").trim();
                String upper = statement.toUpperCase(Locale.ROOT);
                if (!(upper.startsWith("SELECT ") || upper.equals("SHOW TABLES") || upper.startsWith("DESCRIBE "))) {
                    throw new QueryError("sql() in a QUERY only runs SELECT, SHOW TABLES or DESCRIBE");
                }
                SqlResult r = sql.execute(statement);
                if (!r.ok()) {
                    yield fail(r);
                }
                yield switch (r.type()) {
                    case ROWS -> projectRows(r.rows(), f);
                    case TABLES -> r.rows();
                    default -> r.toJson();
                };
            }
            case "tables" -> {
                SqlResult r = sql.execute("SHOW TABLES");
                yield r.ok() ? r.rows() : fail(r);
            }
            case "describe" -> {
                SqlResult r = sql.execute("DESCRIBE " + ident(f.arg("table", 0), "table"));
                yield r.ok() && r.rows().length() > 0 ? r.rows().get(0) : fail(r);
            }
            default -> throw new QueryError("unknown resolver '" + f.name()
                    + "' (get, mget, prefix, keys, exists, count, table, sql, tables, describe)");
        };
    }

    // --------------------------------------------------------------- shaping

    /** A stored value: returned as-is, or parsed as JSON and projected when the field has a selection. */
    private static Object shape(String value, Field f) {
        if (!f.hasSelection()) {
            return value;
        }
        Object parsed = parseJson(value);
        if (parsed == null) {
            throw new QueryError("the value of '" + f.alias() + "' is not JSON, so it cannot be projected");
        }
        return project(parsed, f.selection());
    }

    private static Object parseJson(String value) {
        String t = value.trim();
        try {
            if (t.startsWith("{")) {
                return new JSONObject(t);
            }
            if (t.startsWith("[")) {
                return new JSONArray(t);
            }
        } catch (JSONException e) {
            return null;
        }
        return null;
    }

    private static JSONArray projectRows(JSONArray rows, Field f) {
        if (!f.hasSelection()) {
            return rows;
        }
        JSONArray out = new JSONArray();
        for (int i = 0; i < rows.length(); i++) {
            out.put(project(rows.get(i), f.selection()));
        }
        return out;
    }

    /** Keeps the selected fields of an object (recursively), or maps a selection over an array. */
    private static Object project(Object value, List<Field> selection) {
        if (value instanceof JSONArray arr) {
            JSONArray out = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                out.put(project(arr.get(i), selection));
            }
            return out;
        }
        if (!(value instanceof JSONObject obj)) {
            return value;
        }
        JSONObject out = new JSONObject();
        for (Field s : selection) {
            Object v = obj.opt(s.name());
            if (v == null) {
                out.put(s.alias(), JSONObject.NULL);
            } else {
                out.put(s.alias(), s.hasSelection() ? project(v, s.selection()) : v);
            }
        }
        return out;
    }

    // ------------------------------------------------------------- arguments

    private static String key(Field f, String name, int index) {
        Object v = f.arg(name, index);
        if (v == null) {
            throw new QueryError(f.name() + " needs a " + name);
        }
        String key = str(v, name);
        if (key.isEmpty() || key.chars().anyMatch(Character::isWhitespace)) {
            throw new QueryError(name + " must be one word");
        }
        return key;
    }

    private static String str(Object v, String name) {
        if (v == null) {
            throw new QueryError(name + " is required");
        }
        return v instanceof String s ? s : String.valueOf(v);
    }

    private static String ident(Object v, String name) {
        String s = str(v, name);
        if (!IDENT.matcher(s).matches()) {
            throw new QueryError(name + " must be an identifier, got '" + s + "'");
        }
        return s;
    }

    private static long number(Object v, String name) {
        if (v instanceof Number n) {
            long l = n.longValue();
            if (l < 0) {
                throw new QueryError(name + " must not be negative");
            }
            return l;
        }
        try {
            return Long.parseLong(str(v, name));
        } catch (NumberFormatException e) {
            throw new QueryError(name + " must be a number");
        }
    }

    private static Object fail(SqlResult r) {
        throw new QueryError(r.message());
    }

    private static Object wrapNull(Object o) {
        return o == null ? JSONObject.NULL : o;
    }

    /** A resolver-level failure, reported under the field's path. */
    static final class QueryError extends RuntimeException {
        QueryError(String message) {
            super(message);
        }
    }
}
