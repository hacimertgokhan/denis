package github.hacimertgokhan.denis.sql;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Outcome of one statement: a result set ({@code columns} + {@code rows}) or
 * a change count with a message.
 *
 * <p>{@link #legacyText()} is what Denis 0.0.x answered (a JSON array of row
 * objects, or {@code OK: ...}), kept for text mode and the {@code data} field;
 * the json protocol adds {@code columns}, {@code rows} and {@code affected}.
 */
public record SqlResult(List<String> columns, List<Object[]> rows, long affected, String message, Long lastRowId,
                        CompletableFuture<Void> durable) {

    public static SqlResult query(List<String> columns, List<Object[]> rows) {
        return new SqlResult(columns, rows, rows.size(), null, null, CompletableFuture.completedFuture(null));
    }

    public static SqlResult change(long affected, String message, Long lastRowId, CompletableFuture<Void> durable) {
        return new SqlResult(null, null, affected, message, lastRowId, durable);
    }

    public boolean isQuery() {
        return columns != null;
    }

    public String legacyText() {
        if (!isQuery()) {
            return "OK: " + message;
        }
        StringBuilder sb = new StringBuilder(64 + rows.size() * 32);
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
        return sb.append(']').toString();
    }

    /**
     * The reply line for {@code MODE json}. Written by hand rather than through
     * org.json, which prints 2.0 as 2 and so loses the REAL type of a value.
     */
    public String toJsonLine() {
        StringBuilder sb = new StringBuilder(128 + (rows == null ? 0 : rows.size() * 48));
        sb.append("{\"ok\":true");
        if (isQuery()) {
            sb.append(",\"columns\":[");
            for (int i = 0; i < columns.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                sb.append(JSONObject.quote(columns.get(i)));
            }
            sb.append("],\"rows\":[");
            for (int r = 0; r < rows.size(); r++) {
                if (r > 0) {
                    sb.append(',');
                }
                sb.append('[');
                Object[] row = rows.get(r);
                for (int i = 0; i < row.length; i++) {
                    if (i > 0) {
                        sb.append(',');
                    }
                    appendValue(sb, row[i]);
                }
                sb.append(']');
            }
            sb.append("],\"count\":").append(rows.size());
        } else {
            sb.append(",\"message\":").append(JSONObject.quote(message));
            sb.append(",\"affected\":").append(affected);
            if (lastRowId != null) {
                sb.append(",\"lastRowId\":").append(lastRowId);
            }
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
