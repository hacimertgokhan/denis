package github.hacimertgokhan.denis.sql;

import github.hacimertgokhan.denis.server.ProjectStore;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A small SQL dialect on top of the key-value store. Tables live under the
 * project's {@code __sql:} namespace and are persisted (write-through), so
 * they survive a restart. Supported statements:
 *
 * <pre>
 *   CREATE TABLE [IF NOT EXISTS] t (col TYPE, ...)
 *   INSERT INTO t (cols) VALUES (vals) [, (vals) ...]
 *   SELECT cols | * | COUNT(*) FROM t [WHERE ...] [ORDER BY col [ASC|DESC]] [LIMIT n [OFFSET m]]
 *   UPDATE t SET col = v [, ...] [WHERE ...]
 *   DELETE FROM t [WHERE ...]
 *   DROP TABLE [IF EXISTS] t
 *   SHOW TABLES
 *   DESCRIBE t
 * </pre>
 *
 * {@code WHERE} accepts {@code =, !=, <>, <, <=, >, >=, LIKE, IS NULL, IS NOT NULL}
 * combined with {@code AND} / {@code OR} (AND binds tighter; no parentheses).
 * Types are informational: values are stored as they are given (string, integer,
 * decimal, boolean or NULL) and compared numerically when both sides are numbers.
 */
public class SqlQueryEngine {
    private static final Pattern CREATE_TABLE = Pattern.compile("(?is)^CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\((.+)\\)$");
    private static final Pattern INSERT = Pattern.compile("(?is)^INSERT\\s+INTO\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\((.+?)\\)\\s*VALUES\\s*(.+)$");
    private static final Pattern SELECT = Pattern.compile("(?is)^SELECT\\s+(.+?)\\s+FROM\\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\\s+WHERE\\s+(.+?))?(?:\\s+ORDER\\s+BY\\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\\s+(ASC|DESC))?)?(?:\\s+LIMIT\\s+(\\d+)(?:\\s+OFFSET\\s+(\\d+))?)?$");
    private static final Pattern UPDATE = Pattern.compile("(?is)^UPDATE\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s+SET\\s+(.+?)(?:\\s+WHERE\\s+(.+))?$");
    private static final Pattern DELETE = Pattern.compile("(?is)^DELETE\\s+FROM\\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\\s+WHERE\\s+(.+))?$");
    private static final Pattern DROP_TABLE = Pattern.compile("(?is)^DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?([a-zA-Z_][a-zA-Z0-9_]*)$");
    private static final Pattern SHOW_TABLES = Pattern.compile("(?is)^SHOW\\s+TABLES$");
    private static final Pattern DESCRIBE = Pattern.compile("(?is)^(?:DESCRIBE|DESC)\\s+([a-zA-Z_][a-zA-Z0-9_]*)$");
    private static final Pattern COUNT_ALL = Pattern.compile("(?i)^COUNT\\s*\\(\\s*\\*\\s*\\)$");
    private static final Pattern CONDITION = Pattern.compile("(?is)^([a-zA-Z_][a-zA-Z0-9_]*)\\s*(IS\\s+NOT\\s+NULL|IS\\s+NULL|!=|<>|>=|<=|=|>|<|LIKE)\\s*(.*)$");

    public static final String NAMESPACE = "__sql:";
    private static final ConcurrentHashMap<String, Object> TABLE_LOCKS = new ConcurrentHashMap<>();

    private final ProjectStore store;

    public SqlQueryEngine(ProjectStore store) {
        this.store = store;
    }

    public SqlResult execute(String rawQuery) {
        String query = normalize(rawQuery);
        try {
            Matcher m;
            if ((m = SHOW_TABLES.matcher(query)).matches()) {
                return showTables();
            }
            if ((m = DESCRIBE.matcher(query)).matches()) {
                return describe(m.group(1));
            }
            if ((m = CREATE_TABLE.matcher(query)).matches()) {
                return createTable(m.group(2), m.group(3), m.group(1) != null);
            }
            if ((m = INSERT.matcher(query)).matches()) {
                return insert(m.group(1), m.group(2), m.group(3));
            }
            if ((m = SELECT.matcher(query)).matches()) {
                return select(m.group(1), m.group(2), m.group(3), m.group(4), m.group(5), m.group(6), m.group(7));
            }
            if ((m = UPDATE.matcher(query)).matches()) {
                return update(m.group(1), m.group(2), m.group(3));
            }
            if ((m = DELETE.matcher(query)).matches()) {
                return delete(m.group(1), m.group(2));
            }
            if ((m = DROP_TABLE.matcher(query)).matches()) {
                return dropTable(m.group(2), m.group(1) != null);
            }
            return SqlResult.error("Unsupported SQL query");
        } catch (IllegalArgumentException e) {
            return SqlResult.error(e.getMessage());
        }
    }

    public static boolean isSqlCommand(String input) {
        String query = normalize(input).toUpperCase(Locale.ROOT);
        return query.startsWith("CREATE TABLE ")
                || query.startsWith("INSERT INTO ")
                || query.startsWith("SELECT ")
                || (query.startsWith("UPDATE ") && query.contains(" SET "))
                || query.startsWith("DELETE FROM ")
                || query.startsWith("DROP TABLE ")
                || query.equals("SHOW TABLES")
                || query.startsWith("DESCRIBE ")
                || query.startsWith("DESC ");
    }

    private static String normalize(String rawQuery) {
        String query = rawQuery == null ? "" : rawQuery.trim();
        if (query.toUpperCase(Locale.ROOT).startsWith("SQL ")) {
            query = query.substring(4).trim();
        }
        while (query.endsWith(";")) {
            query = query.substring(0, query.length() - 1).trim();
        }
        return query;
    }

    // ------------------------------------------------------------- statements

    private SqlResult showTables() {
        JSONArray tables = new JSONArray();
        for (Map.Entry<String, String> entry : store.entriesWithPrefix(NAMESPACE).entrySet()) {
            String key = entry.getKey();
            if (!key.endsWith(":schema")) {
                continue;
            }
            String table = key.substring(NAMESPACE.length(), key.length() - ":schema".length());
            tables.put(describeTable(table, new JSONArray(entry.getValue())));
        }
        return SqlResult.tables(tables);
    }

    private SqlResult describe(String table) {
        JSONArray columns = getSchemaColumns(table);
        return SqlResult.tables(new JSONArray().put(describeTable(normalizeIdentifier(table), columns)));
    }

    private JSONObject describeTable(String table, JSONArray columns) {
        return new JSONObject()
                .put("name", table)
                .put("columns", columns)
                .put("rows", rows(table).size());
    }

    private SqlResult createTable(String table, String columnsSql, boolean ifNotExists) {
        String schemaKey = schemaKey(table);
        synchronized (lock(table)) {
            if (store.exists(schemaKey)) {
                if (ifNotExists) {
                    return SqlResult.affected(0, "table already exists");
                }
                return SqlResult.error("Table already exists: " + table);
            }
            JSONArray columns = new JSONArray();
            for (String definition : splitCommaAware(columnsSql)) {
                String[] parts = definition.trim().split("\\s+", 2);
                if (parts.length == 0 || parts[0].isBlank()) {
                    throw new IllegalArgumentException("Invalid column definition");
                }
                columns.put(new JSONObject()
                        .put("name", normalizeIdentifier(parts[0]))
                        .put("type", parts.length > 1 ? parts[1].trim().toUpperCase(Locale.ROOT) : "TEXT"));
            }
            store.set(schemaKey, columns.toString(), true);
            store.set(sequenceKey(table), "0", true);
        }
        return SqlResult.affected(0, "table created");
    }

    private SqlResult insert(String table, String columnsSql, String valuesSql) {
        List<String> schema = getSchema(table);
        List<String> columns = splitCommaAware(columnsSql).stream().map(SqlQueryEngine::normalizeIdentifier).toList();
        columns.forEach(column -> ensureColumnExists(schema, column));

        List<List<String>> tuples = splitTuples(valuesSql);
        int inserted = 0;
        synchronized (lock(table)) {
            for (List<String> values : tuples) {
                if (columns.size() != values.size()) {
                    throw new IllegalArgumentException("Column count does not match value count");
                }
                JSONObject row = new JSONObject();
                for (int i = 0; i < columns.size(); i++) {
                    row.put(columns.get(i), parseValue(values.get(i)));
                }
                long rowId = nextRowId(table);
                row.put("_rowid", rowId);
                store.set(rowKey(table, rowId), row.toString(), true);
                inserted++;
            }
        }
        return SqlResult.affected(inserted, inserted + " row" + (inserted == 1 ? "" : "s") + " inserted");
    }

    private SqlResult select(String columnsSql, String table, String whereSql, String orderBy, String direction,
                             String limitSql, String offsetSql) {
        List<String> schema = getSchema(table);
        boolean count = COUNT_ALL.matcher(columnsSql.trim()).matches();
        List<String> selected = count || columnsSql.trim().equals("*")
                ? schema
                : splitCommaAware(columnsSql).stream().map(SqlQueryEngine::normalizeIdentifier).toList();
        selected.forEach(column -> ensureColumnExists(schema, column));

        Predicate<JSONObject> condition = parseCondition(whereSql);
        List<JSONObject> matched = new ArrayList<>();
        for (JSONObject row : rows(table)) {
            if (condition.test(row)) {
                matched.add(row);
            }
        }
        if (count) {
            JSONArray rows = new JSONArray().put(new JSONObject().put("count", matched.size()));
            return SqlResult.rows(List.of("count"), rows);
        }
        if (orderBy != null) {
            String column = normalizeIdentifier(orderBy);
            ensureColumnExists(schema, column);
            Comparator<JSONObject> comparator = Comparator.comparing(row -> row.opt(column), SqlQueryEngine::compareValues);
            if ("DESC".equalsIgnoreCase(direction)) {
                comparator = comparator.reversed();
            }
            matched.sort(comparator);
        }
        int offset = offsetSql == null ? 0 : Integer.parseInt(offsetSql);
        int limit = limitSql == null ? Integer.MAX_VALUE : Integer.parseInt(limitSql);

        JSONArray rows = new JSONArray();
        for (int i = offset; i < matched.size() && rows.length() < limit; i++) {
            JSONObject row = matched.get(i);
            JSONObject projected = new JSONObject();
            for (String column : selected) {
                projected.put(column, row.has(column) ? row.get(column) : JSONObject.NULL);
            }
            rows.put(projected);
        }
        return SqlResult.rows(selected, rows);
    }

    private SqlResult update(String table, String assignmentsSql, String whereSql) {
        List<String> schema = getSchema(table);
        Map<String, Object> assignments = parseAssignments(assignmentsSql);
        assignments.keySet().forEach(column -> ensureColumnExists(schema, column));
        Predicate<JSONObject> condition = parseCondition(whereSql);

        int updated = 0;
        synchronized (lock(table)) {
            for (JSONObject row : rows(table)) {
                if (!condition.test(row)) {
                    continue;
                }
                assignments.forEach(row::put);
                store.set(rowKey(table, row.getLong("_rowid")), row.toString(), true);
                updated++;
            }
        }
        return SqlResult.affected(updated, updated + " row(s) updated");
    }

    private SqlResult delete(String table, String whereSql) {
        getSchema(table);
        Predicate<JSONObject> condition = parseCondition(whereSql);
        int deleted = 0;
        synchronized (lock(table)) {
            for (JSONObject row : rows(table)) {
                if (!condition.test(row)) {
                    continue;
                }
                store.delete(rowKey(table, row.getLong("_rowid")), true, true);
                deleted++;
            }
        }
        return SqlResult.affected(deleted, deleted + " row(s) deleted");
    }

    private SqlResult dropTable(String table, boolean ifExists) {
        synchronized (lock(table)) {
            if (!store.exists(schemaKey(table))) {
                if (ifExists) {
                    return SqlResult.affected(0, "table does not exist");
                }
                throw new IllegalArgumentException("Table not found: " + table);
            }
            store.deleteWithPrefix(tablePrefix(table));
        }
        return SqlResult.affected(0, "table dropped");
    }

    // ---------------------------------------------------------------- helpers

    private JSONArray getSchemaColumns(String table) {
        String schema = store.get(schemaKey(table));
        if (schema == null) {
            throw new IllegalArgumentException("Table not found: " + table);
        }
        return new JSONArray(schema);
    }

    private List<String> getSchema(String table) {
        JSONArray columns = getSchemaColumns(table);
        List<String> names = new ArrayList<>();
        for (int i = 0; i < columns.length(); i++) {
            names.add(columns.getJSONObject(i).getString("name"));
        }
        return names;
    }

    private List<JSONObject> rows(String table) {
        return store.entriesWithPrefix(rowPrefix(table)).values().stream()
                .map(JSONObject::new)
                .sorted(Comparator.comparingLong(row -> row.getLong("_rowid")))
                .toList();
    }

    /** Must be called under the table lock. */
    private long nextRowId(String table) {
        String key = sequenceKey(table);
        String current = store.get(key);
        long next = (current == null ? 0 : Long.parseLong(current)) + 1;
        store.set(key, String.valueOf(next), true);
        return next;
    }

    private static Object lock(String table) {
        return TABLE_LOCKS.computeIfAbsent(normalizeIdentifier(table), t -> new Object());
    }

    private Map<String, Object> parseAssignments(String assignmentsSql) {
        Map<String, Object> assignments = new LinkedHashMap<>();
        for (String assignment : splitCommaAware(assignmentsSql)) {
            String[] parts = assignment.split("=", 2);
            if (parts.length != 2) {
                throw new IllegalArgumentException("Invalid assignment: " + assignment);
            }
            assignments.put(normalizeIdentifier(parts[0]), parseValue(parts[1]));
        }
        return assignments;
    }

    /** {@code a = 1 AND b LIKE 'x%' OR c IS NULL}: OR of ANDs, no parentheses. */
    private Predicate<JSONObject> parseCondition(String whereSql) {
        if (whereSql == null || whereSql.isBlank()) {
            return row -> true;
        }
        Predicate<JSONObject> any = null;
        for (String disjunct : splitKeyword(whereSql, "OR")) {
            Predicate<JSONObject> all = null;
            for (String conjunct : splitKeyword(disjunct, "AND")) {
                Predicate<JSONObject> one = parseComparison(conjunct.trim());
                all = all == null ? one : all.and(one);
            }
            any = any == null ? all : any.or(all);
        }
        return any;
    }

    private Predicate<JSONObject> parseComparison(String sql) {
        Matcher m = CONDITION.matcher(sql);
        if (!m.matches()) {
            throw new IllegalArgumentException("Unsupported WHERE clause: " + sql);
        }
        String column = normalizeIdentifier(m.group(1));
        String operator = m.group(2).toUpperCase(Locale.ROOT).replaceAll("\\s+", " ");
        String rhs = m.group(3).trim();

        switch (operator) {
            case "IS NULL" -> {
                return row -> !row.has(column) || row.isNull(column);
            }
            case "IS NOT NULL" -> {
                return row -> row.has(column) && !row.isNull(column);
            }
            default -> {
                if (rhs.isEmpty()) {
                    throw new IllegalArgumentException("Missing value in WHERE clause: " + sql);
                }
            }
        }
        Object expected = parseValue(rhs);
        if (operator.equals("LIKE")) {
            Pattern like = likeToRegex(String.valueOf(expected));
            return row -> row.has(column) && !row.isNull(column) && like.matcher(String.valueOf(row.get(column))).matches();
        }
        return row -> {
            if (!row.has(column) || row.isNull(column)) {
                return false;
            }
            int cmp = compareValues(row.get(column), expected);
            return switch (operator) {
                case "=" -> cmp == 0;
                case "!=", "<>" -> cmp != 0;
                case ">" -> cmp > 0;
                case ">=" -> cmp >= 0;
                case "<" -> cmp < 0;
                case "<=" -> cmp <= 0;
                default -> throw new IllegalArgumentException("Unsupported operator: " + operator);
            };
        };
    }

    /** Numbers compare numerically, everything else as text; NULL sorts first. */
    private static int compareValues(Object left, Object right) {
        boolean leftNull = left == null || JSONObject.NULL.equals(left);
        boolean rightNull = right == null || JSONObject.NULL.equals(right);
        if (leftNull || rightNull) {
            return Boolean.compare(!leftNull, !rightNull);
        }
        Double l = asNumber(left);
        Double r = asNumber(right);
        if (l != null && r != null) {
            return Double.compare(l, r);
        }
        return String.valueOf(left).compareTo(String.valueOf(right));
    }

    private static Double asNumber(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(value).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Pattern likeToRegex(String like) {
        StringBuilder regex = new StringBuilder("(?s)^");
        for (char c : like.toCharArray()) {
            switch (c) {
                case '%' -> regex.append(".*");
                case '_' -> regex.append('.');
                default -> regex.append(Pattern.quote(String.valueOf(c)));
            }
        }
        return Pattern.compile(regex.append('$').toString(), Pattern.CASE_INSENSITIVE);
    }

    /** Split on a keyword ({@code AND}/{@code OR}) that is outside quotes. */
    private static List<String> splitKeyword(String sql, String keyword) {
        List<String> parts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuote = false;
        char quote = 0;
        String upper = sql.toUpperCase(Locale.ROOT);
        int i = 0;
        while (i < sql.length()) {
            char c = sql.charAt(i);
            if ((c == '\'' || c == '"') && (i == 0 || sql.charAt(i - 1) != '\\')) {
                if (!inQuote) {
                    inQuote = true;
                    quote = c;
                } else if (quote == c) {
                    inQuote = false;
                }
            }
            if (!inQuote && Character.isWhitespace(c)
                    && upper.startsWith(" " + keyword + " ", i)) {
                parts.add(current.toString());
                current.setLength(0);
                i += keyword.length() + 1;
                continue;
            }
            current.append(c);
            i++;
        }
        parts.add(current.toString());
        return parts;
    }

    /** {@code (1, 'a'), (2, 'b')} → two value lists. */
    private static List<List<String>> splitTuples(String valuesSql) {
        List<List<String>> tuples = new ArrayList<>();
        int depth = 0;
        boolean inQuote = false;
        char quote = 0;
        StringBuilder current = new StringBuilder();
        for (int i = 0; i < valuesSql.length(); i++) {
            char c = valuesSql.charAt(i);
            if ((c == '\'' || c == '"') && (i == 0 || valuesSql.charAt(i - 1) != '\\')) {
                if (!inQuote) {
                    inQuote = true;
                    quote = c;
                } else if (quote == c) {
                    inQuote = false;
                }
            }
            if (!inQuote) {
                if (c == '(') {
                    if (depth++ == 0) {
                        current.setLength(0);
                        continue;
                    }
                } else if (c == ')') {
                    if (--depth == 0) {
                        tuples.add(splitCommaAware(current.toString()));
                        continue;
                    }
                }
            }
            if (depth > 0) {
                current.append(c);
            }
        }
        if (tuples.isEmpty() || depth != 0) {
            throw new IllegalArgumentException("Invalid VALUES clause");
        }
        return tuples;
    }

    private static List<String> splitCommaAware(String value) {
        List<String> parts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuote = false;
        char quote = 0;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if ((c == '\'' || c == '"') && (i == 0 || value.charAt(i - 1) != '\\')) {
                if (!inQuote) {
                    inQuote = true;
                    quote = c;
                } else if (quote == c) {
                    inQuote = false;
                }
            }
            if (c == ',' && !inQuote) {
                parts.add(current.toString().trim());
                current.setLength(0);
                continue;
            }
            current.append(c);
        }
        parts.add(current.toString().trim());
        return parts;
    }

    static Object parseValue(String value) {
        String trimmed = value.trim();
        if (trimmed.length() >= 2
                && ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("\"") && trimmed.endsWith("\"")))) {
            return trimmed.substring(1, trimmed.length() - 1).replace("\\'", "'").replace("\\\"", "\"");
        }
        if (trimmed.equalsIgnoreCase("null")) {
            return JSONObject.NULL;
        }
        if (trimmed.equalsIgnoreCase("true") || trimmed.equalsIgnoreCase("false")) {
            return Boolean.parseBoolean(trimmed);
        }
        try {
            return Long.parseLong(trimmed);
        } catch (NumberFormatException ignored) {
            // not an integer
        }
        try {
            return Double.parseDouble(trimmed);
        } catch (NumberFormatException ignored) {
            return trimmed;
        }
    }

    private static String normalizeIdentifier(String identifier) {
        return identifier.trim().replace("`", "").toLowerCase(Locale.ROOT);
    }

    private void ensureColumnExists(List<String> schema, String column) {
        if (!schema.contains(column)) {
            throw new IllegalArgumentException("Column not found: " + column);
        }
    }

    private String tablePrefix(String table) {
        return NAMESPACE + normalizeIdentifier(table) + ":";
    }

    private String schemaKey(String table) {
        return tablePrefix(table) + "schema";
    }

    private String sequenceKey(String table) {
        return tablePrefix(table) + "seq";
    }

    private String rowPrefix(String table) {
        return tablePrefix(table) + "row:";
    }

    private String rowKey(String table, long rowId) {
        return rowPrefix(table) + rowId;
    }
}
