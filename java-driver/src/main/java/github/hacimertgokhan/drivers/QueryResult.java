package github.hacimertgokhan.drivers;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Result of a SQL statement ({@link DenisClient#query}, {@link DenisClient#sql}).
 *
 * <p>{@link #type()} tells the kind, as in the server's reply:
 * <ul>
 *   <li>{@code "rows"}: a query ({@code SELECT}) with {@link #columns()} and
 *       {@link #rows()};</li>
 *   <li>{@code "affected"}: a change ({@code INSERT}, {@code UPDATE}, DDL...)
 *       with {@link #affected()}, {@link #message()} and, for inserts,
 *       {@link #lastRowId()};</li>
 *   <li>{@code "tables"}: {@code SHOW TABLES} / {@code DESCRIBE} with
 *       {@link #tables()}; the tables are also readable as rows with the
 *       columns {@code name}, {@code columns}, {@code rows}.</li>
 * </ul>
 * Cell values are {@code String}, {@code Long}, {@code Double},
 * {@code Boolean} or {@code null} as sent by the server. Note that JSON does
 * not distinguish {@code 2.0} from {@code 2}: a whole {@code REAL} value may
 * arrive as a {@code Long}; use {@link #getDouble}.
 *
 * <pre>{@code
 * QueryResult r = client.query("SELECT id, name FROM users WHERE age > ?", 30);
 * for (int row = 0; row < r.size(); row++) {
 *     long id = r.getLong(row, "id");
 *     String name = r.getString(row, "name");
 * }
 * }</pre>
 */
public final class QueryResult {
    /** {@link #type()} of a query with rows. */
    public static final String ROWS = "rows";
    /** {@link #type()} of a change. */
    public static final String AFFECTED = "affected";
    /** {@link #type()} of {@code SHOW TABLES} / {@code DESCRIBE}. */
    public static final String TABLES = "tables";

    private static final List<String> TABLE_COLUMNS = List.of("name", "columns", "rows");

    private final String type;
    private final List<String> columns;
    private final List<List<Object>> rows;
    private final long affected;
    private final Long lastRowId;
    private final String message;
    private final String data;
    private final List<TableInfo> tables;
    private final Map<String, Object> reply;

    QueryResult(String type, List<String> columns, List<List<Object>> rows, long affected, Long lastRowId,
                String message, String data, List<TableInfo> tables, Map<String, Object> reply) {
        this.type = type;
        this.columns = columns;
        this.rows = rows;
        this.affected = affected;
        this.lastRowId = lastRowId;
        this.message = message;
        this.data = data;
        this.tables = tables;
        this.reply = reply;
    }

    /**
     * Decodes the three reply shapes. Rows may be JSON objects keyed by column
     * (master-line servers and current ones) or arrays in column order (0.1.0-alpha); either way
     * {@link #rows()} follows the order of {@code columns}.
     */
    static QueryResult from(Map<String, Object> r) {
        Map<String, Object> reply = Protocol.frozen(Protocol.body(r));
        String data = r.get("data") instanceof String ? (String) r.get("data") : null;
        Object typeField = r.get("type");
        String type = typeField instanceof String ? (String) typeField
                : r.containsKey("tables") && r.get("tables") instanceof List ? TABLES
                : r.containsKey("columns") || r.get("rows") instanceof List ? ROWS : AFFECTED;
        switch (type) {
            case TABLES: {
                List<TableInfo> tables = TableInfo.listFrom(r);
                List<List<Object>> rows = new ArrayList<>(tables.size());
                for (TableInfo t : tables) {
                    rows.add(Collections.unmodifiableList(Arrays.asList(t.name(), t.asMap().get("columns"), t.asMap().get("rows"))));
                }
                return new QueryResult(TABLES, TABLE_COLUMNS, Collections.unmodifiableList(rows), 0, null, null, data,
                        tables, reply);
            }
            case ROWS:
                return rowsResult(r, data, reply);
            default: {
                Object last = r.get("lastRowId");
                return new QueryResult(type, List.of(), List.of(), Protocol.optNumber(r, "affected", 0),
                        last instanceof Number ? ((Number) last).longValue() : null, Protocol.optString(r, "message"), data,
                        List.of(), reply);
            }
        }
    }

    private static QueryResult rowsResult(Map<String, Object> r, String data, Map<String, Object> reply) {
        List<String> columns = r.get("columns") instanceof List ? new ArrayList<>(Protocol.strings(r, "columns")) : new ArrayList<>();
        boolean declared = !columns.isEmpty();
        List<List<Object>> rows = new ArrayList<>();
        Object raw = r.get("rows");
        if (raw instanceof List) {
            List<?> list = (List<?>) raw;
            if (!declared) {
                // no column list: take the keys of the object rows in order of appearance
                for (Object row : list) {
                    if (row instanceof Map) {
                        for (Object k : ((Map<?, ?>) row).keySet()) {
                            if (!columns.contains(String.valueOf(k))) {
                                columns.add(String.valueOf(k));
                            }
                        }
                    }
                }
            }
            for (Object row : list) {
                if (row instanceof List) {
                    rows.add(Collections.unmodifiableList(new ArrayList<>((List<?>) row)));
                } else if (row instanceof Map) {
                    Map<?, ?> m = (Map<?, ?>) row;
                    List<Object> cells = new ArrayList<>(columns.size());
                    for (String c : columns) {
                        cells.add(m.get(c));
                    }
                    rows.add(Collections.unmodifiableList(cells));
                } else {
                    throw Protocol.protocol("SQL row is neither an object nor an array: " + row);
                }
            }
        }
        return new QueryResult(ROWS, Collections.unmodifiableList(columns), Collections.unmodifiableList(rows), 0, null,
                null, data, List.of(), reply);
    }

    /** {@code "rows"}, {@code "affected"} or {@code "tables"} (see the class description). */
    public String type() {
        return type;
    }

    /** {@code true} for a result with columns and rows ({@code rows} and {@code tables}), {@code false} for a change. */
    public boolean isResultSet() {
        return !AFFECTED.equals(type);
    }

    /** Column names (empty for a change). */
    public List<String> columns() {
        return columns;
    }

    /** Rows, each a list of cell values in column order (empty for a change). */
    public List<List<Object>> rows() {
        return rows;
    }

    /** The tables of a {@code SHOW TABLES} / {@code DESCRIBE} result (empty otherwise). */
    public List<TableInfo> tables() {
        return tables;
    }

    /** Number of rows. */
    public int size() {
        return rows.size();
    }

    /** {@code true} when there are no rows. */
    public boolean isEmpty() {
        return rows.isEmpty();
    }

    /** Rows changed by an INSERT/UPDATE/DELETE (0 for a query). */
    public long affected() {
        return affected;
    }

    /** Row id of the last inserted row, or {@code null}. */
    public Long lastRowId() {
        return lastRowId;
    }

    /** Server message of a change, e.g. {@code "1 row inserted"}; {@code null} for a query. */
    public String message() {
        return message;
    }

    /** The Denis 0.0.x text form of the result (what text mode prints), or {@code null} when the server did not send it. */
    public String data() {
        return data;
    }

    /**
     * The server's reply without {@code ok}, e.g.
     * {@code {"type":"rows","columns":[..],"rows":[{..}],"count":1}}: what
     * 1.2's {@code sql()} returned as a {@code JSONObject}.
     */
    public Map<String, Object> asMap() {
        return reply;
    }

    /**
     * Index of the column {@code name}; exact match first, then ignoring case.
     *
     * @throws github.hacimertgokhan.drivers.exceptions.DenisException code INVALID when there is no such column
     */
    public int columnIndex(String name) {
        int i = columns.indexOf(name);
        if (i >= 0) {
            return i;
        }
        for (int c = 0; c < columns.size(); c++) {
            if (columns.get(c).equalsIgnoreCase(name)) {
                return c;
            }
        }
        throw Protocol.invalid("no column \"" + name + "\" in " + columns);
    }

    /** Cell value. */
    public Object get(int row, int column) {
        return rows.get(row).get(column);
    }

    /** Cell value by column name. */
    public Object get(int row, String column) {
        return get(row, columnIndex(column));
    }

    /** Cell as text ({@code null} for SQL NULL). */
    public String getString(int row, String column) {
        Object v = get(row, column);
        return v == null ? null : String.valueOf(v);
    }

    /** Cell as a long ({@code null} for SQL NULL). Decimals are truncated; numeric text is parsed. */
    public Long getLong(int row, String column) {
        Object v = get(row, column);
        if (v == null) {
            return null;
        }
        if (v instanceof Number) {
            return ((Number) v).longValue();
        }
        try {
            return new BigDecimal(String.valueOf(v).trim()).longValue();
        } catch (NumberFormatException e) {
            throw Protocol.invalid("column \"" + column + "\" is not numeric: " + v);
        }
    }

    /** Cell as a double ({@code null} for SQL NULL); numeric text is parsed. */
    public Double getDouble(int row, String column) {
        Object v = get(row, column);
        if (v == null) {
            return null;
        }
        if (v instanceof Number) {
            return ((Number) v).doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            throw Protocol.invalid("column \"" + column + "\" is not numeric: " + v);
        }
    }

    /** Cell as a boolean ({@code null} for SQL NULL); numbers are true when non-zero, text {@code "true"/"false"}. */
    public Boolean getBoolean(int row, String column) {
        Object v = get(row, column);
        if (v == null) {
            return null;
        }
        if (v instanceof Boolean) {
            return (Boolean) v;
        }
        if (v instanceof Number) {
            return ((Number) v).doubleValue() != 0;
        }
        String s = String.valueOf(v).trim();
        if (s.equalsIgnoreCase("true") || s.equals("1")) {
            return true;
        }
        if (s.equalsIgnoreCase("false") || s.equals("0")) {
            return false;
        }
        throw Protocol.invalid("column \"" + column + "\" is not boolean: " + v);
    }

    /** Rows as maps from column name to value (column order preserved). */
    public List<Map<String, Object>> toMaps() {
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (List<Object> row : rows) {
            Map<String, Object> map = new LinkedHashMap<>();
            for (int c = 0; c < columns.size() && c < row.size(); c++) {
                map.put(columns.get(c), row.get(c));
            }
            out.add(map);
        }
        return out;
    }

    @Override
    public String toString() {
        if (TABLES.equals(type)) {
            return "QueryResult{tables=" + tables + "}";
        }
        if (isResultSet()) {
            return "QueryResult{columns=" + columns + ", rows=" + rows.size() + "}";
        }
        return "QueryResult{affected=" + affected + (lastRowId == null ? "" : ", lastRowId=" + lastRowId)
                + ", message=" + message + "}";
    }
}
