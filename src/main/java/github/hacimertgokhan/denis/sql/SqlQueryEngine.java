package github.hacimertgokhan.denis.sql;

import github.hacimertgokhan.pointers.Any;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SqlQueryEngine {
    private static final Pattern CREATE_TABLE = Pattern.compile("(?is)^CREATE\\s+TABLE\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\((.+)\\)$");
    private static final Pattern INSERT = Pattern.compile("(?is)^INSERT\\s+INTO\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\((.+?)\\)\\s*VALUES\\s*\\((.+)\\)$");
    private static final Pattern SELECT = Pattern.compile("(?is)^SELECT\\s+(.+?)\\s+FROM\\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\\s+WHERE\\s+(.+))?$");
    private static final Pattern UPDATE = Pattern.compile("(?is)^UPDATE\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s+SET\\s+(.+?)(?:\\s+WHERE\\s+(.+))?$");
    private static final Pattern DELETE = Pattern.compile("(?is)^DELETE\\s+FROM\\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\\s+WHERE\\s+(.+))?$");
    private static final Pattern DROP_TABLE = Pattern.compile("(?is)^DROP\\s+TABLE\\s+([a-zA-Z_][a-zA-Z0-9_]*)$");

    private final ConcurrentHashMap<String, Any> store;
    private final String namespace;

    public SqlQueryEngine(ConcurrentHashMap<String, Any> store, String projectToken) {
        this.store = store;
        this.namespace = projectToken + ":__sql:";
    }

    public String execute(String rawQuery) {
        String query = normalize(rawQuery);

        try {
            Matcher matcher = CREATE_TABLE.matcher(query);
            if (matcher.matches()) {
                return createTable(matcher.group(1), matcher.group(2));
            }

            matcher = INSERT.matcher(query);
            if (matcher.matches()) {
                return insert(matcher.group(1), matcher.group(2), matcher.group(3));
            }

            matcher = SELECT.matcher(query);
            if (matcher.matches()) {
                return select(matcher.group(1), matcher.group(2), matcher.group(3));
            }

            matcher = UPDATE.matcher(query);
            if (matcher.matches()) {
                return update(matcher.group(1), matcher.group(2), matcher.group(3));
            }

            matcher = DELETE.matcher(query);
            if (matcher.matches()) {
                return delete(matcher.group(1), matcher.group(2));
            }

            matcher = DROP_TABLE.matcher(query);
            if (matcher.matches()) {
                return dropTable(matcher.group(1));
            }

            return "ERROR: Unsupported SQL query";
        } catch (IllegalArgumentException e) {
            return "ERROR: " + e.getMessage();
        }
    }

    public static boolean isSqlCommand(String input) {
        String query = normalize(input).toUpperCase(Locale.ROOT);
        return query.startsWith("CREATE TABLE ")
                || query.startsWith("INSERT INTO ")
                || query.startsWith("SELECT ")
                || (query.startsWith("UPDATE ") && query.contains(" SET "))
                || query.startsWith("DELETE FROM ")
                || query.startsWith("DROP TABLE ");
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

    private String createTable(String table, String columnsSql) {
        String schemaKey = schemaKey(table);
        if (store.containsKey(schemaKey)) {
            return "ERROR: Table already exists: " + table;
        }

        JSONArray columns = new JSONArray();
        for (String columnDefinition : splitCommaAware(columnsSql)) {
            String[] parts = columnDefinition.trim().split("\\s+", 2);
            if (parts.length == 0 || parts[0].isBlank()) {
                throw new IllegalArgumentException("Invalid column definition");
            }

            JSONObject column = new JSONObject();
            column.put("name", normalizeIdentifier(parts[0]));
            column.put("type", parts.length > 1 ? parts[1].trim().toUpperCase(Locale.ROOT) : "TEXT");
            columns.put(column);
        }

        store.put(schemaKey, new Any(columns.toString()));
        store.put(sequenceKey(table), new Any("0"));
        return "OK: table created";
    }

    private String insert(String table, String columnsSql, String valuesSql) {
        List<String> schema = getSchema(table);
        List<String> columns = splitCommaAware(columnsSql).stream().map(SqlQueryEngine::normalizeIdentifier).toList();
        List<String> values = splitCommaAware(valuesSql);
        if (columns.size() != values.size()) {
            throw new IllegalArgumentException("Column count does not match value count");
        }

        JSONObject row = new JSONObject();
        for (int i = 0; i < columns.size(); i++) {
            String column = columns.get(i);
            ensureColumnExists(schema, column);
            row.put(column, parseValue(values.get(i)));
        }

        long rowId = nextRowId(table);
        row.put("_rowid", rowId);
        store.put(rowKey(table, rowId), new Any(row.toString()));
        return "OK: 1 row inserted";
    }

    private String select(String columnsSql, String table, String whereSql) {
        List<String> schema = getSchema(table);
        List<String> selectedColumns = columnsSql.trim().equals("*")
                ? schema
                : splitCommaAware(columnsSql).stream().map(SqlQueryEngine::normalizeIdentifier).toList();
        selectedColumns.forEach(column -> ensureColumnExists(schema, column));

        Condition condition = parseCondition(whereSql);
        JSONArray rows = new JSONArray();
        for (JSONObject row : rows(table)) {
            if (!condition.matches(row)) {
                continue;
            }

            JSONObject selected = new JSONObject();
            for (String column : selectedColumns) {
                selected.put(column, row.opt(column));
            }
            rows.put(selected);
        }
        return rows.toString();
    }

    private String update(String table, String assignmentsSql, String whereSql) {
        List<String> schema = getSchema(table);
        Map<String, Object> assignments = parseAssignments(assignmentsSql);
        assignments.keySet().forEach(column -> ensureColumnExists(schema, column));

        Condition condition = parseCondition(whereSql);
        int updated = 0;
        for (JSONObject row : rows(table)) {
            if (!condition.matches(row)) {
                continue;
            }

            assignments.forEach(row::put);
            store.put(rowKey(table, row.getLong("_rowid")), new Any(row.toString()));
            updated++;
        }
        return "OK: " + updated + " row(s) updated";
    }

    private String delete(String table, String whereSql) {
        getSchema(table);
        Condition condition = parseCondition(whereSql);
        int deleted = 0;
        for (JSONObject row : rows(table)) {
            if (!condition.matches(row)) {
                continue;
            }

            store.remove(rowKey(table, row.getLong("_rowid")));
            deleted++;
        }
        return "OK: " + deleted + " row(s) deleted";
    }

    private String dropTable(String table) {
        getSchema(table);
        String prefix = tablePrefix(table);
        store.keySet().removeIf(key -> key.startsWith(prefix));
        return "OK: table dropped";
    }

    private List<String> getSchema(String table) {
        Any schema = store.get(schemaKey(table));
        if (schema == null) {
            throw new IllegalArgumentException("Table not found: " + table);
        }

        JSONArray columns = new JSONArray(String.valueOf(schema.getValue()));
        List<String> names = new ArrayList<>();
        for (int i = 0; i < columns.length(); i++) {
            names.add(columns.getJSONObject(i).getString("name"));
        }
        return names;
    }

    private List<JSONObject> rows(String table) {
        String prefix = rowPrefix(table);
        return store.entrySet().stream()
                .filter(entry -> entry.getKey().startsWith(prefix))
                .map(entry -> new JSONObject(String.valueOf(entry.getValue().getValue())))
                .sorted((left, right) -> Long.compare(left.getLong("_rowid"), right.getLong("_rowid")))
                .toList();
    }

    private long nextRowId(String table) {
        String key = sequenceKey(table);
        long next = Long.parseLong(String.valueOf(store.get(key).getValue())) + 1;
        store.put(key, new Any(String.valueOf(next)));
        return next;
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

    private Condition parseCondition(String whereSql) {
        if (whereSql == null || whereSql.isBlank()) {
            return row -> true;
        }

        String[] parts = whereSql.split("=", 2);
        if (parts.length != 2) {
            throw new IllegalArgumentException("Only equality WHERE clauses are supported");
        }

        String column = normalizeIdentifier(parts[0]);
        Object expected = parseValue(parts[1]);
        return row -> row.has(column) && String.valueOf(row.opt(column)).equals(String.valueOf(expected));
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

    private static Object parseValue(String value) {
        String trimmed = value.trim();
        if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("\"") && trimmed.endsWith("\""))) {
            return trimmed.substring(1, trimmed.length() - 1);
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
        return namespace + normalizeIdentifier(table) + ":";
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

    private interface Condition {
        boolean matches(JSONObject row);
    }
}
