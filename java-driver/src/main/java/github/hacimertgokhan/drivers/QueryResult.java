package github.hacimertgokhan.drivers;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Result of a SQL statement.
 *
 * <p>A query ({@code SELECT}, {@code SHOW}, ...) has {@link #columns()} and
 * {@link #rows()}; a change ({@code INSERT}, {@code UPDATE}, DDL, ...) has
 * {@link #affected()}, {@link #message()} and, for inserts,
 * {@link #lastRowId()}. Cell values are {@code String}, {@code Long},
 * {@code Double}, {@code Boolean} or {@code null} as sent by the server.
 * Note that JSON does not distinguish {@code 2.0} from {@code 2}: a whole
 * {@code REAL} value may arrive as a {@code Long}; use {@link #getDouble}.
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
    private final boolean resultSet;
    private final List<String> columns;
    private final List<List<Object>> rows;
    private final long affected;
    private final Long lastRowId;
    private final String message;
    private final String data;

    QueryResult(boolean resultSet, List<String> columns, List<List<Object>> rows, long affected, Long lastRowId,
                String message, String data) {
        this.resultSet = resultSet;
        this.columns = columns;
        this.rows = rows;
        this.affected = affected;
        this.lastRowId = lastRowId;
        this.message = message;
        this.data = data;
    }

    static QueryResult from(Map<String, Object> r) {
        String data = Protocol.optString(r, "data");
        if (r.containsKey("columns")) {
            List<String> columns = Protocol.strings(r, "columns");
            List<List<Object>> rows = new ArrayList<>();
            Object raw = r.get("rows");
            if (raw instanceof List) {
                for (Object row : (List<?>) raw) {
                    if (!(row instanceof List)) {
                        throw Protocol.protocol("SQL row is not an array: " + row);
                    }
                    rows.add(Collections.unmodifiableList(new ArrayList<>((List<?>) row)));
                }
            }
            return new QueryResult(true, columns, Collections.unmodifiableList(rows), 0, null, null, data);
        }
        Object last = r.get("lastRowId");
        return new QueryResult(false, List.of(), List.of(), Protocol.optNumber(r, "affected", 0),
                last instanceof Number ? ((Number) last).longValue() : null, Protocol.optString(r, "message"), data);
    }

    /** {@code true} for a query with columns and rows, {@code false} for a change. */
    public boolean isResultSet() {
        return resultSet;
    }

    /** Column names (empty for a change). */
    public List<String> columns() {
        return columns;
    }

    /** Rows, each a list of cell values in column order (empty for a change). */
    public List<List<Object>> rows() {
        return rows;
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

    /** The Denis 0.0.x text form of the result (what text mode prints). */
    public String data() {
        return data;
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
        if (resultSet) {
            return "QueryResult{columns=" + columns + ", rows=" + rows.size() + "}";
        }
        return "QueryResult{affected=" + affected + (lastRowId == null ? "" : ", lastRowId=" + lastRowId)
                + ", message=" + message + "}";
    }
}
