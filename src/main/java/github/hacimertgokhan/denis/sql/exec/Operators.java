package github.hacimertgokhan.denis.sql.exec;

import github.hacimertgokhan.denis.sql.SqlException;
import github.hacimertgokhan.denis.storage.table.Values;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * SQL operator semantics with three-valued logic: comparisons and arithmetic
 * involving NULL yield NULL, and a WHERE clause keeps a row only when its
 * condition is TRUE.
 */
public final class Operators {
    private Operators() {
    }

    public static boolean isTrue(Object v) {
        if (v instanceof Boolean b) {
            return b;
        }
        if (v == null) {
            return false;
        }
        Boolean b = Values.toBoolean(v);
        return b != null && b;
    }

    /** Comparison result or null when either side is NULL. */
    public static Integer compare(Object a, Object b) {
        if (a == null || b == null) {
            return null;
        }
        if (a instanceof Number x && b instanceof Number y) {
            return Values.compareNumbers(x, y);
        }
        if (a instanceof Number || b instanceof Number) {
            Double x = Values.toDouble(a);
            Double y = Values.toDouble(b);
            if (x != null && y != null) {
                return Double.compare(x, y);
            }
            return a.toString().compareTo(b.toString());
        }
        if (a instanceof Boolean || b instanceof Boolean) {
            Boolean x = Values.toBoolean(a);
            Boolean y = Values.toBoolean(b);
            if (x != null && y != null) {
                return Boolean.compare(x, y);
            }
        }
        return a.toString().compareTo(b.toString());
    }

    public static Object comparison(String op, Object a, Object b) {
        if (op.equals("=")) {
            return a == null || b == null ? null : Values.sqlEquals(a, b);
        }
        if (op.equals("!=")) {
            return a == null || b == null ? null : !Values.sqlEquals(a, b);
        }
        Integer c = compare(a, b);
        if (c == null) {
            return null;
        }
        return switch (op) {
            case "<" -> c < 0;
            case "<=" -> c <= 0;
            case ">" -> c > 0;
            case ">=" -> c >= 0;
            default -> throw new SqlException("Unknown operator " + op);
        };
    }

    private static Number number(Object v) {
        if (v instanceof Number n) {
            return n;
        }
        if (v instanceof Boolean b) {
            return b ? 1L : 0L;
        }
        String s = v.toString().trim();
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            try {
                return Double.parseDouble(s);
            } catch (NumberFormatException e2) {
                throw new SqlException("Not a number: '" + v + "'");
            }
        }
    }

    /** Integer arithmetic stays integer (division truncates, as in SQLite/PostgreSQL); overflow widens to REAL. */
    public static Object arithmetic(String op, Object a, Object b) {
        if (a == null || b == null) {
            return null;
        }
        Number x = number(a);
        Number y = number(b);
        if (x instanceof Long l && y instanceof Long r) {
            try {
                return switch (op) {
                    case "+" -> Math.addExact(l, r);
                    case "-" -> Math.subtractExact(l, r);
                    case "*" -> Math.multiplyExact(l, r);
                    case "/" -> r == 0 ? null : l / r;
                    case "%" -> r == 0 ? null : l % r;
                    default -> throw new SqlException("Unknown operator " + op);
                };
            } catch (ArithmeticException overflow) {
                // fall through to floating point
            }
        }
        double l = x.doubleValue();
        double r = y.doubleValue();
        return switch (op) {
            case "+" -> l + r;
            case "-" -> l - r;
            case "*" -> l * r;
            case "/" -> r == 0 ? null : l / r;
            case "%" -> r == 0 ? null : l % r;
            default -> throw new SqlException("Unknown operator " + op);
        };
    }

    public static Object negate(Object v) {
        if (v == null) {
            return null;
        }
        Number n = number(v);
        if (n instanceof Long l) {
            return l == Long.MIN_VALUE ? -(double) l : -l;
        }
        return -n.doubleValue();
    }

    public static Object and(Object a, Object b) {
        Boolean x = a == null ? null : isTrue(a);
        Boolean y = b == null ? null : isTrue(b);
        if (Boolean.FALSE.equals(x) || Boolean.FALSE.equals(y)) {
            return false;
        }
        if (x == null || y == null) {
            return null;
        }
        return true;
    }

    public static Object or(Object a, Object b) {
        Boolean x = a == null ? null : isTrue(a);
        Boolean y = b == null ? null : isTrue(b);
        if (Boolean.TRUE.equals(x) || Boolean.TRUE.equals(y)) {
            return true;
        }
        if (x == null || y == null) {
            return null;
        }
        return false;
    }

    public static Object not(Object a) {
        return a == null ? null : !isTrue(a);
    }

    /** Compile a LIKE pattern: {@code %} any run, {@code _} one char, case-insensitive. */
    public static Pattern likePattern(String like) {
        StringBuilder regex = new StringBuilder(like.length() + 8);
        for (int i = 0; i < like.length(); i++) {
            char c = like.charAt(i);
            if (c == '\\' && i + 1 < like.length()) {
                regex.append(Pattern.quote(String.valueOf(like.charAt(++i))));
            } else if (c == '%') {
                regex.append(".*");
            } else if (c == '_') {
                regex.append('.');
            } else {
                regex.append(Pattern.quote(String.valueOf(c)));
            }
        }
        return Pattern.compile(regex.toString(), Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE | Pattern.DOTALL);
    }

    public static String text(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Double d && d == Math.rint(d) && !Double.isInfinite(d) && Math.abs(d) < 1e15) {
            return String.format(Locale.ROOT, "%.1f", d);
        }
        return v.toString();
    }
}
