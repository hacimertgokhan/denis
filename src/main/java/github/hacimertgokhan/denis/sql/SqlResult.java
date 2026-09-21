package github.hacimertgokhan.denis.sql;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * Outcome of one SQL statement, in a shape a program (or a language model)
 * can consume without parsing prose:
 *
 * <pre>
 *   rows      {"ok":true,"type":"rows","columns":["id","name"],"rows":[{...}],"count":1}
 *   affected  {"ok":true,"type":"affected","affected":1,"message":"1 row inserted"}
 *   tables    {"ok":true,"type":"tables","tables":[{"name":"users","columns":[...],"rows":3}]}
 *   error     {"ok":false,"error":"Table not found: users"}
 * </pre>
 *
 * {@link #toText()} keeps the historic one-line replies of text mode
 * ({@code OK: 1 row inserted}, a JSON array for SELECT, {@code ERROR: ...}).
 */
public final class SqlResult {
    public enum Type { ROWS, AFFECTED, TABLES, ERROR }

    private final Type type;
    private final String message;
    private final List<String> columns;
    private final JSONArray rows;
    private final int affected;

    private SqlResult(Type type, String message, List<String> columns, JSONArray rows, int affected) {
        this.type = type;
        this.message = message;
        this.columns = columns;
        this.rows = rows;
        this.affected = affected;
    }

    public static SqlResult rows(List<String> columns, JSONArray rows) {
        return new SqlResult(Type.ROWS, null, columns, rows, rows.length());
    }

    public static SqlResult affected(int count, String message) {
        return new SqlResult(Type.AFFECTED, message, null, null, count);
    }

    public static SqlResult tables(JSONArray tables) {
        return new SqlResult(Type.TABLES, null, null, tables, tables.length());
    }

    public static SqlResult error(String message) {
        return new SqlResult(Type.ERROR, message, null, null, 0);
    }

    public boolean ok() {
        return type != Type.ERROR;
    }

    public Type type() {
        return type;
    }

    public String message() {
        return message;
    }

    public List<String> columns() {
        return columns;
    }

    public JSONArray rows() {
        return rows;
    }

    public int affected() {
        return affected;
    }

    public JSONObject toJson() {
        JSONObject json = new JSONObject();
        json.put("ok", ok());
        switch (type) {
            case ROWS -> {
                json.put("type", "rows");
                json.put("columns", new JSONArray(columns));
                json.put("rows", rows);
                json.put("count", rows.length());
            }
            case AFFECTED -> {
                json.put("type", "affected");
                json.put("affected", affected);
                json.put("message", message);
            }
            case TABLES -> {
                json.put("type", "tables");
                json.put("tables", rows);
                json.put("count", rows.length());
            }
            case ERROR -> json.put("error", message);
        }
        return json;
    }

    public String toText() {
        return switch (type) {
            case ROWS, TABLES -> rows.toString();
            case AFFECTED -> "OK: " + message;
            case ERROR -> "ERROR: " + message;
        };
    }

    @Override
    public String toString() {
        return toText();
    }
}
