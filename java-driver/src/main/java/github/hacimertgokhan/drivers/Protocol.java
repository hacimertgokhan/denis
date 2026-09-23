package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisAuthException;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import github.hacimertgokhan.drivers.exceptions.DenisQuotaException;
import github.hacimertgokhan.drivers.exceptions.DenisSqlException;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Duration;
import java.time.temporal.TemporalAccessor;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Reply decoding, error mapping and argument validation for protocol version 2. */
final class Protocol {
    private Protocol() {
    }

    // =================================================================== replies

    static boolean isOk(Map<String, Object> reply) {
        return Boolean.TRUE.equals(reply.get("ok"));
    }

    /**
     * The reply's {@code code}. Servers of the master line up to 0.6 send errors without
     * one; for those the code is inferred from the well-known messages (see
     * docs/PROTOCOL.md), and anything else is {@link DenisException#ERROR}.
     */
    static String code(Map<String, Object> reply) {
        return code(reply, DenisException.ERROR);
    }

    /** Like {@link #code(Map)}, with the code to use when neither the reply nor its message tells. */
    static String code(Map<String, Object> reply, String fallback) {
        Object code = reply.get("code");
        if (code instanceof String && !((String) code).isEmpty()) {
            return (String) code;
        }
        Object e = reply.get("error");
        String inferred = e instanceof String ? inferCode((String) e) : DenisException.ERROR;
        return inferred.equals(DenisException.ERROR) && fallback != null ? fallback : inferred;
    }

    private static String inferCode(String error) {
        String e = error.toLowerCase(Locale.ROOT);
        if (e.equals("not found")) {
            return "NOTFOUND";
        }
        if (e.startsWith("quota exceeded")) {
            return DenisQuotaException.QUOTA;
        }
        if (e.startsWith("please login first")) {
            return "NOAUTH";
        }
        if (e.startsWith("please authenticate first")) {
            return "NOPROJECT";
        }
        if (e.startsWith("login failed") || e.startsWith("cannot auth with") || e.startsWith("admin refused")) {
            return "AUTH";
        }
        if (e.startsWith("unknown project")) {
            return "NOTFOUND";
        }
        if (e.startsWith("unknown command")) {
            return "UNKNOWN";
        }
        if (e.startsWith("usage:")) {
            return "USAGE";
        }
        return DenisException.ERROR;
    }

    /** The exception for an {@code {"ok":false,...}} reply. */
    static DenisException error(Map<String, Object> reply) {
        return error(reply, DenisException.ERROR);
    }

    private static final Pattern QUOTA_MESSAGE = Pattern.compile("quota exceeded: (\\w+) \\(limit (\\d+)\\)");

    /**
     * The exception for an {@code {"ok":false,...}} reply.
     *
     * @param fallbackCode code for a reply without {@code code} whose message is not a well-known one
     *                     (e.g. {@code SQL} for statements sent to such a server)
     */
    static DenisException error(Map<String, Object> reply, String fallbackCode) {
        String code = code(reply, fallbackCode);
        Object e = reply.get("error");
        String message = (e instanceof String ? (String) e : "server error") + " [" + code + "]";
        switch (code) {
            case "AUTH":
            case "NOAUTH":
            case "NOPROJECT":
            case "LOCKED":
            case "FORBIDDEN":
                return new DenisAuthException(code, message, reply);
            case "SQL":
                return new DenisSqlException(message, reply);
            case DenisQuotaException.QUOTA: {
                Object resource = reply.get("resource");
                Object limit = reply.get("limit");
                String r = resource instanceof String ? (String) resource : null;
                long l = limit instanceof Number ? ((Number) limit).longValue() : -1;
                Matcher m = QUOTA_MESSAGE.matcher(e instanceof String ? (String) e : "");
                if (m.find()) { // servers that only put it in the message
                    r = r == null ? m.group(1) : r;
                    l = l < 0 ? Long.parseLong(m.group(2)) : l;
                }
                return new DenisQuotaException(message, reply, r, l);
            }
            default:
                return new DenisException(code, message, reply, null);
        }
    }

    static DenisException protocol(String message) {
        return new DenisException(DenisException.PROTOCOL, message);
    }

    static Object field(Map<String, Object> reply, String name) {
        if (!reply.containsKey(name)) {
            throw protocol("reply has no \"" + name + "\" field: " + abbreviate(Json.write(reply)));
        }
        return reply.get(name);
    }

    static String string(Map<String, Object> reply, String name) {
        Object v = field(reply, name);
        if (v != null && !(v instanceof String)) {
            throw protocol("\"" + name + "\" is not a string: " + v);
        }
        return (String) v;
    }

    static String optString(Map<String, Object> reply, String name) {
        Object v = reply.get(name);
        return v == null ? null : String.valueOf(v);
    }

    static long number(Map<String, Object> reply, String name) {
        Object v = field(reply, name);
        if (v instanceof Number) {
            return ((Number) v).longValue();
        }
        if (v instanceof String) {
            try {
                return Long.parseLong((String) v);
            } catch (NumberFormatException ignored) {
                // fall through
            }
        }
        throw protocol("\"" + name + "\" is not a number: " + v);
    }

    static long optNumber(Map<String, Object> reply, String name, long fallback) {
        Object v = reply.get(name);
        return v instanceof Number ? ((Number) v).longValue() : fallback;
    }

    static boolean bool(Map<String, Object> reply, String name) {
        Object v = field(reply, name);
        if (v instanceof Boolean) {
            return (Boolean) v;
        }
        throw protocol("\"" + name + "\" is not a boolean: " + v);
    }

    @SuppressWarnings("unchecked")
    static List<Object> list(Map<String, Object> reply, String name) {
        Object v = field(reply, name);
        if (v instanceof List) {
            return (List<Object>) v;
        }
        throw protocol("\"" + name + "\" is not an array: " + v);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(Object v, String name) {
        if (v instanceof Map) {
            return (Map<String, Object>) v;
        }
        throw protocol("\"" + name + "\" is not an object: " + v);
    }

    static List<String> strings(Map<String, Object> reply, String name) {
        List<Object> raw = list(reply, name);
        List<String> out = new ArrayList<>(raw.size());
        for (Object o : raw) {
            out.add(o == null ? null : String.valueOf(o));
        }
        return Collections.unmodifiableList(out);
    }

    /** The value at a path of nested objects, or {@code null} when any step is missing or not an object. */
    static Object path(Map<String, Object> root, String... names) {
        Object current = root;
        for (String name : names) {
            if (!(current instanceof Map)) {
                return null;
            }
            current = ((Map<?, ?>) current).get(name);
        }
        return current;
    }

    /** The number at a path of nested objects, or {@code fallback}. */
    static long pathNumber(Map<String, Object> root, long fallback, String... names) {
        Object v = path(root, names);
        return v instanceof Number ? ((Number) v).longValue() : fallback;
    }

    /** {@code v} as an object, or {@code null} when it is not one. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> optObject(Object v) {
        return v instanceof Map ? (Map<String, Object>) v : null;
    }

    /** An unmodifiable copy of an object (nested values are shared). */
    static Map<String, Object> frozen(Map<String, Object> m) {
        return m == null ? Map.of() : Collections.unmodifiableMap(new java.util.LinkedHashMap<>(m));
    }

    /** The reply without the {@code ok} field. */
    static Map<String, Object> body(Map<String, Object> reply) {
        reply.remove("ok");
        return reply;
    }

    static String abbreviate(String s) {
        return s.length() <= 200 ? s : s.substring(0, 200) + "...";
    }

    // =================================================================== validation

    static DenisException invalid(String message) {
        return new DenisException(DenisException.INVALID, message);
    }

    private static boolean isSpaceLike(char c) {
        return Character.isWhitespace(c) || Character.isSpaceChar(c) || Character.isISOControl(c);
    }

    /** One word, not a flag. Used for keys, KEYS patterns, group names and tokens. */
    static String word(String what, String s) {
        if (s == null || s.isEmpty()) {
            throw invalid(what + " must not be null or empty");
        }
        for (int i = 0; i < s.length(); i++) {
            if (isSpaceLike(s.charAt(i))) {
                throw invalid(what + " must not contain whitespace or control characters: " + quoteForError(s));
            }
        }
        if (s.startsWith("-&")) {
            throw invalid(what + " must not start with -& (reserved for flags): " + quoteForError(s));
        }
        return s;
    }

    /** Like {@link #word}, but the error message does not echo the value (for secrets such as the main token). */
    static String secretWord(String what, String s) {
        if (s == null || s.isEmpty()) {
            throw invalid(what + " must not be null or empty");
        }
        for (int i = 0; i < s.length(); i++) {
            if (isSpaceLike(s.charAt(i))) {
                throw invalid(what + " must not contain whitespace or control characters");
            }
        }
        if (s.startsWith("-&")) {
            throw invalid(what + " must not start with -&");
        }
        return s;
    }

    static String key(String key) {
        return word("key", key);
    }

    /**
     * Values are sent verbatim after the key: no line breaks and no word
     * (space separated) starting with {@code -&}. Empty values and leading or
     * trailing spaces are carried as-is (protocol 2 only strips leading
     * whitespace of the whole line).
     */
    static String value(String value) {
        if (value == null) {
            throw invalid("value must not be null");
        }
        noLineBreaks("value", value);
        if (value.startsWith("-&") || value.contains(" -&")) {
            throw invalid("value must not contain a word starting with -& (reserved for flags); encode it, e.g. as JSON or base64");
        }
        return value;
    }

    static String noLineBreaks(String what, String s) {
        if (s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
            throw invalid(what + " must not contain line breaks");
        }
        return s;
    }

    static String password(String password) {
        if (password == null || password.isEmpty()) {
            throw invalid("password must not be null or empty");
        }
        return noLineBreaks("password", password);
    }

    /** Seconds with millisecond precision, e.g. {@code 1.5}. */
    static String seconds(Duration d, String what) {
        if (d == null || d.isNegative() || d.isZero()) {
            throw invalid(what + " must be positive");
        }
        long millis;
        try {
            millis = d.toMillis();
        } catch (ArithmeticException e) {
            throw invalid(what + " is too large");
        }
        if (millis < 1) {
            throw invalid(what + " must be at least 1 ms");
        }
        return BigDecimal.valueOf(millis, 3).stripTrailingZeros().toPlainString();
    }

    private static String quoteForError(String s) {
        return Json.quote(s.length() > 64 ? s.substring(0, 64) + "..." : s);
    }

    // =================================================================== SQL parameters

    /** Convert a Java value into something the server's {@code QUERY} accepts. */
    static Object param(Object v) {
        if (v == null || v instanceof String || v instanceof Boolean || v instanceof Long
                || v instanceof Double || v instanceof BigDecimal || v instanceof BigInteger) {
            if (v instanceof Double && (((Double) v).isNaN() || ((Double) v).isInfinite())) {
                throw invalid("SQL parameter cannot be " + v);
            }
            return v;
        }
        if (v instanceof Integer || v instanceof Short || v instanceof Byte) {
            return ((Number) v).longValue();
        }
        if (v instanceof Float) {
            float f = (Float) v;
            if (Float.isNaN(f) || Float.isInfinite(f)) {
                throw invalid("SQL parameter cannot be " + v);
            }
            return new BigDecimal(Float.toString(f));
        }
        if (v instanceof java.util.concurrent.atomic.AtomicInteger || v instanceof java.util.concurrent.atomic.AtomicLong) {
            return ((Number) v).longValue();
        }
        if (v instanceof CharSequence || v instanceof Character || v instanceof UUID || v instanceof TemporalAccessor) {
            return v.toString();
        }
        if (v instanceof Enum) {
            return ((Enum<?>) v).name();
        }
        throw invalid("unsupported SQL parameter type " + v.getClass().getName()
                + " (use String, Number, Boolean, null, UUID, Enum or java.time values)");
    }
}
