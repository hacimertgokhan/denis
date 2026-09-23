package github.hacimertgokhan.denis.storage.table;

import java.util.Comparator;

/**
 * Value semantics shared by tables, indexes and the SQL engine. A value is
 * {@code null}, {@link Long}, {@link Double}, {@link String} or {@link Boolean}.
 * Ordering: null &lt; boolean &lt; number &lt; text; numbers compare by value
 * across Long/Double.
 */
public final class Values {
    public static final Comparator<Object> ORDER = Values::compare;

    private Values() {
    }

    private static int rank(Object v) {
        if (v == null) {
            return 0;
        }
        if (v instanceof Boolean) {
            return 1;
        }
        if (v instanceof Number) {
            return 2;
        }
        return 3;
    }

    public static int compare(Object a, Object b) {
        int ra = rank(a);
        int rb = rank(b);
        if (ra != rb) {
            return Integer.compare(ra, rb);
        }
        return switch (ra) {
            case 0 -> 0;
            case 1 -> Boolean.compare((Boolean) a, (Boolean) b);
            case 2 -> compareNumbers((Number) a, (Number) b);
            default -> a.toString().compareTo(b.toString());
        };
    }

    public static int compareNumbers(Number a, Number b) {
        if (a instanceof Long x && b instanceof Long y) {
            return Long.compare(x, y);
        }
        return Double.compare(a.doubleValue(), b.doubleValue());
    }

    /** SQL equality: numbers by value, otherwise equal type and content; null equals nothing. */
    public static boolean sqlEquals(Object a, Object b) {
        if (a == null || b == null) {
            return false;
        }
        if (a instanceof Number x && b instanceof Number y) {
            return compareNumbers(x, y) == 0;
        }
        if (a instanceof Boolean || b instanceof Boolean) {
            Boolean x = toBoolean(a);
            Boolean y = toBoolean(b);
            return x != null && x.equals(y);
        }
        if (a instanceof Number || b instanceof Number) {
            // '1' = 1 is true, as in most engines with type affinity
            Double x = toDouble(a);
            Double y = toDouble(b);
            return x != null && y != null && x.doubleValue() == y.doubleValue();
        }
        return a.toString().equals(b.toString());
    }

    /** Index keys use numeric normalisation so 1 and 1.0 land on the same entry. */
    public static Object indexKey(Object v) {
        if (v instanceof Double d && d == Math.rint(d) && !Double.isInfinite(d) && Math.abs(d) < 9.0E15) {
            return (long) (double) d;
        }
        return v;
    }

    public static Double toDouble(Object v) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        if (v instanceof String s) {
            try {
                return Double.parseDouble(s.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        if (v instanceof Boolean b) {
            return b ? 1.0 : 0.0;
        }
        return null;
    }

    public static Boolean toBoolean(Object v) {
        if (v instanceof Boolean b) {
            return b;
        }
        if (v instanceof Number n) {
            return n.doubleValue() != 0;
        }
        if (v instanceof String s) {
            String t = s.trim();
            if (t.equalsIgnoreCase("true") || t.equals("1")) {
                return true;
            }
            if (t.equalsIgnoreCase("false") || t.equals("0")) {
                return false;
            }
        }
        return null;
    }

    /** Rough heap size of a value, for memory accounting. */
    public static long sizeOf(Object v) {
        if (v == null) {
            return 0;
        }
        if (v instanceof String s) {
            return 40L + s.length();
        }
        return 16;
    }
}
