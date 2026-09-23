package github.hacimertgokhan.denis.storage.table;

import org.json.JSONObject;

/**
 * Column definition.
 *
 * @param name         lower-case identifier
 * @param declaredType type as written in CREATE TABLE (upper case), shown by DESCRIBE
 * @param type         storage class derived from {@code declaredType}
 * @param defaultValue value used when an INSERT omits the column (already coerced)
 */
public record Column(String name, String declaredType, ColumnType type, boolean notNull, boolean primaryKey,
                     boolean unique, Object defaultValue) {

    public JSONObject toJson() {
        JSONObject json = new JSONObject();
        json.put("name", name);
        json.put("type", declaredType);
        if (notNull) {
            json.put("notNull", true);
        }
        if (primaryKey) {
            json.put("primaryKey", true);
        }
        if (unique) {
            json.put("unique", true);
        }
        if (defaultValue != null) {
            json.put("default", defaultValue);
        }
        return json;
    }

    public static Column fromJson(JSONObject json) {
        String declared = json.optString("type", "TEXT");
        ColumnType type = ColumnType.fromDeclared(declared);
        Object def = json.has("default") && !json.isNull("default") ? json.get("default") : null;
        if (def instanceof Integer i) {
            def = i.longValue();
        } else if (def instanceof java.math.BigDecimal bd) {
            def = bd.doubleValue();
        } else if (def instanceof java.math.BigInteger bi) {
            def = bi.longValue();
        }
        return new Column(json.getString("name"), declared, type, json.optBoolean("notNull"),
                json.optBoolean("primaryKey"), json.optBoolean("unique"), def == null ? null : type.coerce(def, json.getString("name")));
    }
}
