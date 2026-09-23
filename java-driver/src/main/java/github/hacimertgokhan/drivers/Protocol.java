package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisAuthException;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import github.hacimertgokhan.drivers.exceptions.DenisSqlException;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Duration;
import java.time.temporal.TemporalAccessor;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Reply decoding, error mapping and argument validation for protocol version 2. */
final class Protocol {
    private Protocol() {
    }

    // =================================================================== replies

    static boolean isOk(Map<String, Object> reply) {
        return Boolean.TRUE.equals(reply.get("ok"));
    }

    static String code(Map<String, Object> reply) {
        Object code = reply.get("code");
        return code instanceof String ? (String) code : DenisException.ERROR;
    }

    /** The exception for an {@code {"ok":false,...}} reply. */
    static DenisException error(Map<String, Object> reply) {
        String code = code(reply);
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
