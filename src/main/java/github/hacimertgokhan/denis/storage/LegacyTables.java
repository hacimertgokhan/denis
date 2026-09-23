package github.hacimertgokhan.denis.storage;

import github.hacimertgokhan.denis.storage.codec.Mutation;
import github.hacimertgokhan.denis.storage.table.Column;
import github.hacimertgokhan.denis.storage.table.ColumnType;
import github.hacimertgokhan.denis.storage.table.TableSchema;
import github.hacimertgokhan.logger.DenisLogger;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Turns the SQL tables of Denis 0.3-0.5 into real tables. Those versions kept
 * a table as ordinary durable keys of the project:
 *
 * <pre>
 *   __sql:&lt;table&gt;:schema     [{"name":"id","type":"INT"}, ...]
 *   __sql:&lt;table&gt;:seq        last row id
 *   __sql:&lt;table&gt;:row:&lt;id&gt;   {"id":1,"name":"Ada","_rowid":1}
 * </pre>
 *
 * Values that do not fit the declared column type (those versions stored
 * whatever was inserted) are kept as they are rather than dropped.
 */
final class LegacyTables {
    private static final String PREFIX = "__sql:";

    private LegacyTables() {
    }

    /** @return number of tables and rows created */
    static long convert(int keyspace, Map<String, String> sqlKeys, Consumer<Mutation> apply, DenisLogger log) {
        Map<String, JSONArray> schemas = new LinkedHashMap<>();
        Map<String, List<JSONObject>> rows = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : sqlKeys.entrySet()) {
            String rest = entry.getKey().substring(PREFIX.length());
            int colon = rest.indexOf(':');
            if (colon <= 0) {
                continue;
            }
            String table = rest.substring(0, colon);
            String part = rest.substring(colon + 1);
            try {
                if (part.equals("schema")) {
                    schemas.put(table, new JSONArray(entry.getValue()));
                } else if (part.startsWith("row:")) {
                    rows.computeIfAbsent(table, t -> new ArrayList<>()).add(new JSONObject(entry.getValue()));
                }
            } catch (JSONException e) {
                log.warn("Skipping unreadable legacy SQL entry " + entry.getKey() + ": " + e.getMessage());
            }
        }
        long count = 0;
        for (Map.Entry<String, JSONArray> table : schemas.entrySet()) {
            List<Column> columns = new ArrayList<>();
            JSONArray schema = table.getValue();
            for (int i = 0; i < schema.length(); i++) {
                JSONObject c = schema.optJSONObject(i);
                if (c == null || c.optString("name").isEmpty()) {
                    continue;
                }
                String declared = c.optString("type", "TEXT");
                columns.add(new Column(c.getString("name"), declared, ColumnType.fromDeclared(declared), false, false, false, null));
            }
            if (columns.isEmpty()) {
                continue;
            }
            TableSchema tableSchema = new TableSchema(columns);
            apply.accept(new Mutation.CreateTable(keyspace, table.getKey(), tableSchema.toJson()));
            count++;
            for (JSONObject row : rows.getOrDefault(table.getKey(), List.of())) {
                long rowId = row.optLong("_rowid", -1);
                if (rowId < 0) {
                    continue;
                }
                Object[] values = new Object[columns.size()];
                for (int i = 0; i < values.length; i++) {
                    Column column = columns.get(i);
                    Object raw = sqlValue(row.opt(column.name()));
                    try {
                        values[i] = column.type().coerce(raw, column.name());
                    } catch (IllegalArgumentException mismatch) {
                        values[i] = raw;
                    }
                }
                apply.accept(new Mutation.PutRow(keyspace, table.getKey(), rowId, values));
                count++;
            }
        }
        return count;
    }

    private static Object sqlValue(Object v) {
        if (v == null || v == JSONObject.NULL) {
            return null;
        }
        if (v instanceof Integer i) {
            return i.longValue();
        }
        if (v instanceof BigDecimal bd) {
            return bd.doubleValue();
        }
        if (v instanceof BigInteger bi) {
            return bi.bitLength() < 64 ? (Object) bi.longValue() : (Object) bi.doubleValue();
        }
        if (v instanceof Long || v instanceof Double || v instanceof Boolean || v instanceof String) {
            return v;
        }
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        return v.toString();
    }
}
