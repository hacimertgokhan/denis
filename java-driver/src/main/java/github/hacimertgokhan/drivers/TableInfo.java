package github.hacimertgokhan.drivers;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * A SQL table as described by {@code SHOW TABLES} / {@code DESCRIBE}
 * ({@link DenisClient#tables()}, {@link DenisClient#describe(String)}).
 */
public final class TableInfo {
    private final String name;
    private final List<Column> columns;
    private final long rows;
    private final Map<String, Object> raw;

    TableInfo(String name, List<Column> columns, long rows, Map<String, Object> raw) {
        this.name = name;
        this.columns = columns;
        this.rows = rows;
        this.raw = raw;
    }

    static TableInfo from(Map<String, Object> r) {
        List<Column> columns = new ArrayList<>();
        Object raw = r.get("columns");
        if (raw instanceof List) {
            for (Object c : (List<?>) raw) {
                Map<String, Object> column = Protocol.optObject(c);
                if (column != null) {
                    columns.add(Column.from(column));
                } else if (c != null) {
                    columns.add(new Column(String.valueOf(c), null, Map.of()));
                }
            }
        }
        Object name = r.containsKey("name") ? r.get("name") : r.get("table");
        return new TableInfo(name == null ? null : String.valueOf(name), Collections.unmodifiableList(columns),
                Protocol.optNumber(r, "rows", -1), Protocol.frozen(r));
    }

    static List<TableInfo> listFrom(Map<String, Object> reply) {
        List<TableInfo> out = new ArrayList<>();
        for (Object o : Protocol.list(reply, "tables")) {
            out.add(from(Protocol.object(o, "tables[]")));
        }
        return Collections.unmodifiableList(out);
    }

    /** Table name. */
    public String name() {
        return name;
    }

    /** Columns in declaration order. */
    public List<Column> columns() {
        return columns;
    }

    /** Column names in declaration order. */
    public List<String> columnNames() {
        List<String> names = new ArrayList<>(columns.size());
        for (Column c : columns) {
            names.add(c.name());
        }
        return Collections.unmodifiableList(names);
    }

    /** The column {@code name} (exact match first, then ignoring case), or {@code null}. */
    public Column column(String name) {
        for (Column c : columns) {
            if (c.name().equals(name)) {
                return c;
            }
        }
        for (Column c : columns) {
            if (c.name().equalsIgnoreCase(name)) {
                return c;
            }
        }
        return null;
    }

    /** Number of rows ({@code -1} when the server did not say). */
    public long rows() {
        return rows;
    }

    /** The table object as sent by the server (includes fields this class has no accessor for). */
    public Map<String, Object> asMap() {
        return raw;
    }

    @Override
    public String toString() {
        return "TableInfo{name=" + name + ", columns=" + columns + ", rows=" + rows + "}";
    }

    /** One column of a {@link TableInfo}. */
    public static final class Column {
        private final String name;
        private final String type;
        private final Map<String, Object> raw;

        Column(String name, String type, Map<String, Object> raw) {
            this.name = name;
            this.type = type;
            this.raw = raw;
        }

        static Column from(Map<String, Object> r) {
            return new Column(Protocol.optString(r, "name"), Protocol.optString(r, "type"), Protocol.frozen(r));
        }

        /** Column name. */
        public String name() {
            return name;
        }

        /** Declared type as written in {@code CREATE TABLE} (upper case), or {@code null}. */
        public String type() {
            return type;
        }

        /** Another attribute of the column as sent by the server (e.g. {@code primaryKey}, {@code notNull}), or {@code null}. */
        public Object get(String attribute) {
            return raw.get(attribute);
        }

        /** The column object as sent by the server. */
        public Map<String, Object> asMap() {
            return raw;
        }

        @Override
        public String toString() {
            return type == null ? name : name + " " + type;
        }
    }
}
