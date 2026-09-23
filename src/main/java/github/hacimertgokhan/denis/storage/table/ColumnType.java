package github.hacimertgokhan.denis.storage.table;

import java.util.Locale;

/**
 * Storage class of a column. Declared SQL type names map onto one of these the
 * way SQLite's type affinity does, so {@code VARCHAR(40)} is TEXT and
 * {@code BIGINT} is INTEGER; an unknown name stores values unchanged (ANY).
 */
public enum ColumnType {
    INTEGER, REAL, TEXT, BOOLEAN, ANY;

    public static ColumnType fromDeclared(String declared) {
        String t = declared == null ? "" : declared.trim().toUpperCase(Locale.ROOT);
        int paren = t.indexOf('(');
        if (paren >= 0) {
            t = t.substring(0, paren).trim();
        }
        return switch (t) {
            case "INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "MEDIUMINT", "LONG", "SERIAL" -> INTEGER;
            case "REAL", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC", "NUMBER" -> REAL;
            case "TEXT", "VARCHAR", "CHAR", "NCHAR", "NVARCHAR", "STRING", "CLOB", "JSON", "UUID", "DATE", "DATETIME", "TIMESTAMP", "TIME" -> TEXT;
            case "BOOL", "BOOLEAN", "BIT" -> BOOLEAN;
            default -> t.isEmpty() ? TEXT : ANY;
        };
    }

    /**
     * Convert a value for storage in a column of this type.
     *
     * @throws IllegalArgumentException when the value cannot represent this type
     */
    public Object coerce(Object value, String column) {
        if (value == null) {
            return null;
        }
        switch (this) {
            case INTEGER -> {
                if (value instanceof Long) {
                    return value;
                }
                if (value instanceof Double d) {
                    if (d == Math.rint(d) && !Double.isInfinite(d)) {
                        return (long) (double) d;
                    }
                    throw mismatch(value, column);
                }
                if (value instanceof Boolean b) {
                    return b ? 1L : 0L;
                }
                try {
                    return Long.parseLong(value.toString().trim());
                } catch (NumberFormatException e) {
                    throw mismatch(value, column);
                }
            }
            case REAL -> {
                Double d = Values.toDouble(value);
                if (d == null) {
                    throw mismatch(value, column);
                }
                return d;
            }
            case TEXT -> {
                return value.toString();
            }
            case BOOLEAN -> {
                Boolean b = Values.toBoolean(value);
                if (b == null) {
                    throw mismatch(value, column);
                }
                return b;
            }
            default -> {
                return value;
            }
        }
    }

    private IllegalArgumentException mismatch(Object value, String column) {
        return new IllegalArgumentException("Value " + render(value) + " does not fit column " + column + " (" + this + ")");
    }

    private static String render(Object value) {
        return value instanceof String ? "'" + value + "'" : String.valueOf(value);
    }
}
