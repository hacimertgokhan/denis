package github.hacimertgokhan.denis.sql;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Outcome of one statement: a result set ({@code rows}), a change count
 * ({@code affected}) or table descriptions ({@code tables}, for SHOW TABLES
 * and DESCRIBE).
 *
 * <p>The json reply follows the shape clients of Denis 0.3–0.5 already read:
 * <pre>
 *   {"ok":true,"type":"rows","columns":[..],"rows":[{col:value}],"count":n}
 *   {"ok":true,"type":"affected","affected":n,"message":"..","lastRowId":n}
 *   {"ok":true,"type":"tables","tables":[{name,columns,rows}],"count":n}
 * </pre>
 * plus {@code data}, the text reply of Denis 0.0.x ({@link #legacyText()}),
 * which is also what text mode prints.
 */
public record SqlResult(Kind kind, List<String> columns, List<Object[]> rows, JSONArray tables, long affected,
                        String message, Long lastRowId, CompletableFuture<Void> durable) {

    public enum Kind { ROWS, AFFECTED, TABLES }

    private static final CompletableFuture<Void> DONE = CompletableFuture.completedFuture(null);

    public static SqlResult query(List<String> columns, List<Object[]> rows) {
        return new SqlResult(Kind.ROWS, columns, rows, null, rows.size(), null, null, DONE);
    }

    public static SqlResult change(long affected, String message, Long lastRowId, CompletableFuture<Void> durable) {
        return new SqlResult(Kind.AFFECTED, null, null, null, affected, message, lastRowId, durable);
    }

    /** SHOW TABLES / DESCRIBE: {@code [{name, columns:[{name,type,...}], rows, indexes}]}. */
    public static SqlResult tables(JSONArray tables) {
        return new SqlResult(Kind.TABLES, null, null, tables, tables.length(), null, null, DONE);
    }

    public boolean isQuery() {
        return kind == Kind.ROWS;
    }

    public String legacyText() {
        return switch (kind) {
            case AFFECTED -> "OK: " + message;
            case TABLES -> tables.toString();
            case ROWS -> rowObjects();
        };
    }

    /** The rows as a JSON array of objects keyed by column label, in column order. */
    public String rowObjects() {
        StringBuilder sb = new StringBuilder(64 + rows.size() * 32);
        appendRowObjects(sb);
        return sb.toString();
    }

    private void appendRowObjects(StringBuilder sb) {
        sb.append('[');
        for (int r = 0; r < rows.size(); r++) {
            if (r > 0) {
                sb.append(',');
            }
            sb.append('{');
            Object[] row = rows.get(r);
            for (int i = 0; i < columns.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                sb.append(JSONObject.quote(columns.get(i))).append(':');
                appendValue(sb, row[i]);
            }
            sb.append('}');
        }
        sb.append(']');
    }

    /** The rows as org.json objects (for the QUERY document resolvers). */
    public JSONArray rowsAsJson() {
        return new JSONArray(rowObjects());
    }

    /**
     * The reply line for {@code MODE json}. Written by hand rather than through
     * org.json, which prints 2.0 as 2 and so loses the REAL type of a value.
     */
    public String toJsonLine() {
        StringBuilder sb = new StringBuilder(128 + (rows == null ? 0 : rows.size() * 48));
        sb.append("{\"ok\":true");
        switch (kind) {
            case ROWS -> {
                sb.append(",\"type\":\"rows\",\"columns\":[");
                for (int i = 0; i < columns.size(); i++) {
                    if (i > 0) {
                        sb.append(',');
                    }
                    sb.append(JSONObject.quote(columns.get(i)));
                }
                sb.append("],\"rows\":");
                appendRowObjects(sb);
                sb.append(",\"count\":").append(rows.size());
            }
            case AFFECTED -> {
                sb.append(",\"type\":\"affected\",\"affected\":").append(affected);
                sb.append(",\"message\":").append(JSONObject.quote(message));
                if (lastRowId != null) {
                    sb.append(",\"lastRowId\":").append(lastRowId);
                }
            }
            case TABLES -> sb.append(",\"type\":\"tables\",\"tables\":").append(tables).append(",\"count\":").append(tables.length());
        }
        sb.append(",\"data\":").append(JSONObject.quote(legacyText()));
        return sb.append('}').toString();
    }

    /** JSON for a SQL value; REAL values always carry a fraction or exponent. */
    static void appendValue(StringBuilder sb, Object v) {
        if (v == null) {
            sb.append("null");
        } else if (v instanceof Double d) {
            if (d.isNaN() || d.isInfinite()) {
                sb.append("null");
            } else {
                sb.append(d.doubleValue());
            }
        } else if (v instanceof Long || v instanceof Boolean) {
            sb.append(v);
        } else {
            sb.append(JSONObject.quote(v.toString()));
        }
    }

    static Object json(Object v) {
        if (v == null) {
            return JSONObject.NULL;
        }
        if (v instanceof Double d && (d.isNaN() || d.isInfinite())) {
            return JSONObject.NULL;
        }
        return v;
    }
}
