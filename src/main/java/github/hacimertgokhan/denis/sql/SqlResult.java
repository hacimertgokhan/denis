package github.hacimertgokhan.denis.sql;

import org.json.JSONArray;
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
        JSONArray array = new JSONArray();
        for (Object[] row : rows) {
            JSONObject object = new JSONObject();
            for (int i = 0; i < columns.size(); i++) {
                object.put(columns.get(i), json(row[i]));
            }
            array.put(object);
        }
        return array.toString();
    }

    /** Reply object for {@code MODE json}. */
    public JSONObject toJson() {
        JSONObject json = new JSONObject();
        json.put("ok", true);
        if (isQuery()) {
            JSONArray rowArray = new JSONArray();
            for (Object[] row : rows) {
                JSONArray values = new JSONArray();
                for (Object v : row) {
                    values.put(json(v));
                }
                rowArray.put(values);
            }
            json.put("columns", new JSONArray(columns));
            json.put("rows", rowArray);
            json.put("count", rows.size());
            json.put("data", legacyText());
        } else {
            json.put("message", message);
            json.put("affected", affected);
            if (lastRowId != null) {
                json.put("lastRowId", lastRowId);
            }
            json.put("data", legacyText());
        }
        return json;
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
