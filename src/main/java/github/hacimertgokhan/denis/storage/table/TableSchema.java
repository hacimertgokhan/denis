package github.hacimertgokhan.denis.storage.table;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Immutable ordered column list with name lookup. Serialized as JSON in the log and snapshots. */
public final class TableSchema {
    private final List<Column> columns;
    private final Map<String, Integer> positions;

    public TableSchema(List<Column> columns) {
        this.columns = List.copyOf(columns);
        Map<String, Integer> map = new HashMap<>();
        for (int i = 0; i < columns.size(); i++) {
            if (map.put(columns.get(i).name(), i) != null) {
                throw new IllegalArgumentException("Duplicate column: " + columns.get(i).name());
            }
        }
        this.positions = Collections.unmodifiableMap(map);
    }

    public List<Column> columns() {
        return columns;
    }

    public int size() {
        return columns.size();
    }

    public Column column(int position) {
        return columns.get(position);
    }

    /** @return position of the column or -1 */
    public int position(String name) {
        Integer p = positions.get(name);
        return p == null ? -1 : p;
    }

    public List<String> names() {
        List<String> names = new ArrayList<>(columns.size());
        for (Column c : columns) {
            names.add(c.name());
        }
        return names;
    }

    public TableSchema withColumn(Column column) {
        List<Column> next = new ArrayList<>(columns);
        next.add(column);
        return new TableSchema(next);
    }

    public String toJson() {
        JSONArray array = new JSONArray();
        for (Column c : columns) {
            array.put(c.toJson());
        }
        return new JSONObject().put("columns", array).toString();
    }

    public static TableSchema fromJson(String json) {
        JSONArray array = new JSONObject(json).getJSONArray("columns");
        List<Column> list = new ArrayList<>(array.length());
        for (int i = 0; i < array.length(); i++) {
            list.add(Column.fromJson(array.getJSONObject(i)));
        }
        return new TableSchema(list);
    }
}
