package github.hacimertgokhan.denis.sql.exec;

import github.hacimertgokhan.denis.sql.SqlException;
import github.hacimertgokhan.denis.storage.table.Values;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;

/** Scalar SQL functions. Aggregates live in {@link Aggregates}. */
public final class Functions {
    public static final Set<String> NAMES = Set.of(
            "upper", "lower", "length", "len", "abs", "round", "floor", "ceil", "ceiling", "coalesce", "ifnull",
            "nullif", "substr", "substring", "trim", "ltrim", "rtrim", "replace", "concat", "now",
            "current_timestamp", "unix_millis", "unix_timestamp", "random", "typeof", "json_extract", "int",
            "integer", "real", "text", "iif", "min_of", "max_of", "sign", "sqrt", "power", "pow", "mod",
            "instr", "starts_with", "ends_with");

    private Functions() {
    }

    /** Bind a scalar function over already bound arguments. */
    public static Eval bind(String name, List<Eval> args) {
        Eval[] a = args.toArray(new Eval[0]);
        return switch (name) {
            case "upper" -> unary(name, a, v -> v.toString().toUpperCase(Locale.ROOT));
            case "lower" -> unary(name, a, v -> v.toString().toLowerCase(Locale.ROOT));
            case "length", "len" -> unary(name, a, v -> (long) v.toString().codePointCount(0, v.toString().length()));
            case "abs" -> unary(name, a, v -> {
                Object n = Operators.arithmetic("*", v, 1L);
                return n instanceof Long l ? (Object) Math.abs(l) : (Object) Math.abs(((Number) n).doubleValue());
            });
            case "sign" -> unary(name, a, v -> (long) Math.signum(Values.toDouble(v) == null ? 0 : Values.toDouble(v)));
            case "sqrt" -> unary(name, a, v -> Math.sqrt(num(v)));
            case "floor" -> unary(name, a, v -> v instanceof Long ? v : (Object) (long) Math.floor(num(v)));
            case "ceil", "ceiling" -> unary(name, a, v -> v instanceof Long ? v : (Object) (long) Math.ceil(num(v)));
            case "round" -> {
                arity(name, a, 1, 2);
                yield ctx -> {
                    Object v = a[0].eval(ctx);
                    if (v == null) {
                        return null;
                    }
                    int digits = a.length > 1 ? (int) num(a[1].eval(ctx)) : 0;
                    if (v instanceof Long && digits >= 0) {
                        return v;
                    }
                    BigDecimal rounded = BigDecimal.valueOf(num(v)).setScale(digits, RoundingMode.HALF_UP);
                    return digits <= 0 ? (Object) rounded.longValue() : (Object) rounded.doubleValue();
                };
            }
            case "power", "pow" -> binary(name, a, (x, y) -> Math.pow(num(x), num(y)));
            case "mod" -> binary(name, a, (x, y) -> Operators.arithmetic("%", x, y));
            case "coalesce", "ifnull" -> {
                if (a.length < 1) {
                    throw new SqlException(name + " needs at least one argument");
                }
                yield ctx -> {
                    for (Eval e : a) {
                        Object v = e.eval(ctx);
                        if (v != null) {
                            return v;
                        }
                    }
                    return null;
                };
            }
            case "nullif" -> {
                arity(name, a, 2, 2);
                yield ctx -> {
                    Object x = a[0].eval(ctx);
                    Object y = a[1].eval(ctx);
                    return x != null && y != null && Values.sqlEquals(x, y) ? null : x;
                };
            }
            case "iif" -> {
                arity(name, a, 3, 3);
                yield ctx -> Operators.isTrue(a[0].eval(ctx)) ? a[1].eval(ctx) : a[2].eval(ctx);
            }
            case "substr", "substring" -> {
                arity(name, a, 2, 3);
                yield ctx -> {
                    Object v = a[0].eval(ctx);
                    Object s = a[1].eval(ctx);
                    if (v == null || s == null) {
                        return null;
                    }
                    String text = v.toString();
                    int start = (int) num(s);
                    int from = start > 0 ? start - 1 : Math.max(0, text.length() + start);
                    from = Math.min(from, text.length());
                    int to = text.length();
                    if (a.length > 2) {
                        Object l = a[2].eval(ctx);
                        if (l == null) {
                            return null;
                        }
                        to = Math.min(text.length(), from + Math.max(0, (int) num(l)));
                    }
                    return text.substring(from, to);
                };
            }
            case "trim" -> unary(name, a, v -> v.toString().strip());
            case "ltrim" -> unary(name, a, v -> v.toString().stripLeading());
            case "rtrim" -> unary(name, a, v -> v.toString().stripTrailing());
            case "replace" -> {
                arity(name, a, 3, 3);
                yield ctx -> {
                    Object v = a[0].eval(ctx);
                    Object from = a[1].eval(ctx);
                    Object to = a[2].eval(ctx);
                    if (v == null || from == null || to == null) {
                        return null;
                    }
                    return from.toString().isEmpty() ? v.toString() : v.toString().replace(from.toString(), to.toString());
                };
            }
            case "instr" -> binary(name, a, (x, y) -> (long) x.toString().indexOf(y.toString()) + 1);
            case "starts_with" -> binary(name, a, (x, y) -> x.toString().startsWith(y.toString()));
            case "ends_with" -> binary(name, a, (x, y) -> x.toString().endsWith(y.toString()));
            case "concat" -> ctx -> {
                StringBuilder sb = new StringBuilder();
                for (Eval e : a) {
                    Object v = e.eval(ctx);
                    if (v != null) {
                        sb.append(Operators.text(v));
                    }
                }
                return sb.toString();
            };
            case "now", "current_timestamp" -> {
                arity(name, a, 0, 0);
                yield ctx -> Instant.now().toString();
            }
            case "unix_millis" -> {
                arity(name, a, 0, 0);
                yield ctx -> System.currentTimeMillis();
            }
            case "unix_timestamp" -> {
                arity(name, a, 0, 0);
                yield ctx -> System.currentTimeMillis() / 1000;
            }
            case "random" -> {
                arity(name, a, 0, 0);
                yield ctx -> ThreadLocalRandom.current().nextLong();
            }
            case "typeof" -> {
                arity(name, a, 1, 1);
                yield ctx -> {
                    Object v = a[0].eval(ctx);
                    if (v == null) {
                        return "null";
                    }
                    if (v instanceof Long) {
                        return "integer";
                    }
                    if (v instanceof Double) {
                        return "real";
                    }
                    if (v instanceof Boolean) {
                        return "boolean";
                    }
                    return "text";
                };
            }
            case "int", "integer" -> unary(name, a, v -> {
                Object n = Operators.arithmetic("+", v, 0L);
                return n instanceof Long ? n : (Object) (long) ((Number) n).doubleValue();
            });
            case "real" -> unary(name, a, v -> num(v));
            case "text" -> unary(name, a, Operators::text);
            case "min_of" -> ctx -> extreme(a, ctx, -1);
            case "max_of" -> ctx -> extreme(a, ctx, 1);
            case "json_extract" -> {
                arity(name, a, 2, 2);
                yield ctx -> {
                    Object doc = a[0].eval(ctx);
                    Object path = a[1].eval(ctx);
                    return doc == null || path == null ? null : jsonExtract(doc.toString(), path.toString());
                };
            }
            default -> throw new SqlException("Unknown function: " + name);
        };
    }

    private static Object extreme(Eval[] args, Ctx ctx, int sign) {
        Object best = null;
        for (Eval e : args) {
            Object v = e.eval(ctx);
            if (v == null) {
                return null;
            }
            if (best == null || Integer.signum(Values.compare(v, best)) == sign) {
                best = v;
            }
        }
        return best;
    }

    /**
     * {@code json_extract(doc, '$.a.b[0]')}: the value at a simple path, as a
     * SQL value (objects and arrays come back as JSON text).
     */
    static Object jsonExtract(String doc, String path) {
        if (!path.startsWith("$")) {
            throw new SqlException("JSON path must start with $: " + path);
        }
        Object current;
        try {
            String trimmed = doc.strip();
            current = trimmed.startsWith("[") ? new JSONArray(trimmed) : new JSONObject(trimmed);
        } catch (JSONException e) {
            return null;
        }
        int i = 1;
        while (i < path.length() && current != null) {
            char c = path.charAt(i);
            if (c == '.') {
                int end = i + 1;
                while (end < path.length() && path.charAt(end) != '.' && path.charAt(end) != '[') {
                    end++;
                }
                String key = path.substring(i + 1, end);
                current = current instanceof JSONObject o ? o.opt(key) : null;
                i = end;
            } else if (c == '[') {
                int end = path.indexOf(']', i);
                if (end < 0) {
                    throw new SqlException("Bad JSON path: " + path);
                }
                int index;
                try {
                    index = Integer.parseInt(path.substring(i + 1, end).trim());
                } catch (NumberFormatException e) {
                    throw new SqlException("Bad JSON path index: " + path);
                }
                current = current instanceof JSONArray arr ? arr.opt(index) : null;
                i = end + 1;
            } else {
                throw new SqlException("Bad JSON path: " + path);
            }
        }
        if (current == null || current == JSONObject.NULL) {
            return null;
        }
        if (current instanceof Integer n) {
            return n.longValue();
        }
        if (current instanceof Long || current instanceof Double || current instanceof Boolean || current instanceof String) {
            return current;
        }
        if (current instanceof BigDecimal bd) {
            return bd.doubleValue();
        }
        if (current instanceof Number n) {
            return n.doubleValue();
        }
        return current.toString();
    }

    private static double num(Object v) {
        Double d = Values.toDouble(v);
        if (d == null) {
            throw new SqlException("Not a number: '" + v + "'");
        }
        return d;
    }

    private static void arity(String name, Eval[] a, int min, int max) {
        if (a.length < min || a.length > max) {
            throw new SqlException(name + "() takes " + (min == max ? String.valueOf(min) : min + " to " + max)
                    + " argument(s), got " + a.length);
        }
    }

    private interface Unary {
        Object apply(Object v);
    }

    private interface Binary {
        Object apply(Object x, Object y);
    }

    /** NULL in, NULL out. */
    private static Eval unary(String name, Eval[] a, Unary f) {
        arity(name, a, 1, 1);
        Eval arg = a[0];
        return ctx -> {
            Object v = arg.eval(ctx);
            return v == null ? null : f.apply(v);
        };
    }

    private static Eval binary(String name, Eval[] a, Binary f) {
        arity(name, a, 2, 2);
        Eval x = a[0];
        Eval y = a[1];
        return ctx -> {
            Object l = x.eval(ctx);
            Object r = y.eval(ctx);
            return l == null || r == null ? null : f.apply(l, r);
        };
    }
}
