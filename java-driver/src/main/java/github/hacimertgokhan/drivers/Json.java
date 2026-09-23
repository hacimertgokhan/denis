package github.hacimertgokhan.drivers;

import java.lang.reflect.Array;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Minimal, strict JSON (RFC 8259) reader and writer used by the driver so that it
 * needs no runtime dependencies.
 *
 * <p>Mapping: object &rarr; {@link LinkedHashMap} (insertion order, last duplicate
 * key wins), array &rarr; {@link ArrayList}, string &rarr; {@link String},
 * integer &rarr; {@link Long} (or {@link BigInteger} when it does not fit),
 * decimal/exponent &rarr; {@link Double} (or {@link BigDecimal} when it overflows
 * a double), {@code true/false} &rarr; {@link Boolean}, {@code null} &rarr; {@code null}.
 */
final class Json {
    /** Nesting limit for both reading and writing (guards against stack overflow). */
    static final int MAX_DEPTH = 512;

    private static final char[] HEX = "0123456789abcdef".toCharArray();
    /** U+2028 and U+2029: valid in JSON strings but escaped, as JavaScript line terminators. */
    private static final char LINE_SEPARATOR = (char) 0x2028;
    private static final char PARAGRAPH_SEPARATOR = (char) 0x2029;

    private Json() {
    }

    /** Thrown for malformed input or values that cannot be written as JSON. */
    static final class JsonException extends RuntimeException {
        private static final long serialVersionUID = 1L;
        private final int position;

        JsonException(String message, int position) {
            super(position >= 0 ? message + " at position " + position : message);
            this.position = position;
        }

        int position() {
            return position;
        }
    }

    // =================================================================== reading

    /** Parse one JSON document; surrounding whitespace is allowed, anything else is not. */
    static Object parse(String text) {
        if (text == null) {
            throw new JsonException("input is null", -1);
        }
        return new Parser(text).document();
    }

    /** Parse a document that must be a JSON object. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> parseObject(String text) {
        Object value = parse(text);
        if (!(value instanceof Map)) {
            throw new JsonException("expected a JSON object", 0);
        }
        return (Map<String, Object>) value;
    }

    private static final class Parser {
        private final String s;
        private final int len;
        private int pos;
        private int depth;

        Parser(String s) {
            this.s = s;
            this.len = s.length();
        }

        Object document() {
            skipWhitespace();
            Object value = value();
            skipWhitespace();
            if (pos != len) {
                throw error("unexpected trailing characters");
            }
            return value;
        }

        private JsonException error(String message) {
            return new JsonException(message, pos);
        }

        private void skipWhitespace() {
            while (pos < len) {
                char c = s.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                    pos++;
                } else {
                    break;
                }
            }
        }

        private Object value() {
            if (pos >= len) {
                throw error("unexpected end of input");
            }
            char c = s.charAt(pos);
            switch (c) {
                case '{':
                    return object();
                case '[':
                    return array();
                case '"':
                    return string();
                case 't':
                    literal("true");
                    return Boolean.TRUE;
                case 'f':
                    literal("false");
                    return Boolean.FALSE;
                case 'n':
                    literal("null");
                    return null;
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) {
                        return number();
                    }
                    throw error("unexpected character '" + printable(c) + "'");
            }
        }

        private void literal(String word) {
            if (!s.startsWith(word, pos)) {
                throw error("invalid literal, expected " + word);
            }
            pos += word.length();
        }

        private void enter() {
            if (++depth > MAX_DEPTH) {
                throw error("nesting deeper than " + MAX_DEPTH);
            }
        }

        private Map<String, Object> object() {
            enter();
            pos++; // '{'
            Map<String, Object> map = new LinkedHashMap<>();
            skipWhitespace();
            if (pos < len && s.charAt(pos) == '}') {
                pos++;
                depth--;
                return map;
            }
            while (true) {
                skipWhitespace();
                if (pos >= len || s.charAt(pos) != '"') {
                    throw error("expected a string key");
                }
                String key = string();
                skipWhitespace();
                if (pos >= len || s.charAt(pos) != ':') {
                    throw error("expected ':'");
                }
                pos++;
                skipWhitespace();
                map.put(key, value());
                skipWhitespace();
                if (pos >= len) {
                    throw error("unterminated object");
                }
                char c = s.charAt(pos++);
                if (c == ',') {
                    continue;
                }
                if (c == '}') {
                    break;
                }
                pos--;
                throw error("expected ',' or '}'");
            }
            depth--;
            return map;
        }

        private List<Object> array() {
            enter();
            pos++; // '['
            List<Object> list = new ArrayList<>();
            skipWhitespace();
            if (pos < len && s.charAt(pos) == ']') {
                pos++;
                depth--;
                return list;
            }
            while (true) {
                skipWhitespace();
                list.add(value());
                skipWhitespace();
                if (pos >= len) {
                    throw error("unterminated array");
                }
                char c = s.charAt(pos++);
                if (c == ',') {
                    continue;
                }
                if (c == ']') {
                    break;
                }
                pos--;
                throw error("expected ',' or ']'");
            }
            depth--;
            return list;
        }

        private String string() {
            pos++; // opening quote
            int start = pos;
            StringBuilder sb = null;
            while (true) {
                if (pos >= len) {
                    throw error("unterminated string");
                }
                char c = s.charAt(pos);
                if (c == '"') {
                    String result = sb == null ? s.substring(start, pos) : sb.append(s, start, pos).toString();
                    pos++;
                    return result;
                }
                if (c == '\\') {
                    if (sb == null) {
                        sb = new StringBuilder(Math.max(16, (pos - start) * 2));
                    }
                    sb.append(s, start, pos);
                    pos++;
                    if (pos >= len) {
                        throw error("unterminated escape");
                    }
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"':
                            sb.append('"');
                            break;
                        case '\\':
                            sb.append('\\');
                            break;
                        case '/':
                            sb.append('/');
                            break;
                        case 'b':
                            sb.append('\b');
                            break;
                        case 'f':
                            sb.append('\f');
                            break;
                        case 'n':
                            sb.append('\n');
                            break;
                        case 'r':
                            sb.append('\r');
                            break;
                        case 't':
                            sb.append('\t');
                            break;
                        case 'u':
                            sb.append(hex4());
                            break;
                        default:
                            pos--;
                            throw error("invalid escape '\\" + printable(e) + "'");
                    }
                    start = pos;
                    continue;
                }
                if (c < 0x20) {
                    throw error("unescaped control character in string");
                }
                pos++;
            }
        }

        private char hex4() {
            if (pos + 4 > len) {
                throw error("truncated \\u escape");
            }
            int value = 0;
            for (int i = 0; i < 4; i++) {
                char h = s.charAt(pos);
                int digit = Character.digit(h, 16);
                if (digit < 0 || h > 'f') {
                    throw error("invalid hex digit in \\u escape");
                }
                value = (value << 4) | digit;
                pos++;
            }
            return (char) value;
        }

        private Object number() {
            int start = pos;
            boolean integral = true;
            if (s.charAt(pos) == '-') {
                pos++;
            }
            if (pos >= len) {
                throw error("invalid number");
            }
            char c = s.charAt(pos);
            if (c == '0') {
                pos++;
            } else if (c >= '1' && c <= '9') {
                while (pos < len && isDigit(s.charAt(pos))) {
                    pos++;
                }
            } else {
                throw error("invalid number");
            }
            if (pos < len && s.charAt(pos) == '.') {
                integral = false;
                pos++;
                if (pos >= len || !isDigit(s.charAt(pos))) {
                    throw error("expected digit after decimal point");
                }
                while (pos < len && isDigit(s.charAt(pos))) {
                    pos++;
                }
            }
            if (pos < len && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                integral = false;
                pos++;
                if (pos < len && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) {
                    pos++;
                }
                if (pos >= len || !isDigit(s.charAt(pos))) {
                    throw error("expected digit in exponent");
                }
                while (pos < len && isDigit(s.charAt(pos))) {
                    pos++;
                }
            }
            String text = s.substring(start, pos);
            if (integral) {
                if (text.length() <= 18) {
                    return Long.parseLong(text);
                }
                try {
                    return Long.parseLong(text);
                } catch (NumberFormatException e) {
                    return new BigInteger(text);
                }
            }
            double d = Double.parseDouble(text);
            if (Double.isInfinite(d)) {
                return new BigDecimal(text);
            }
            return d;
        }

        private static boolean isDigit(char c) {
            return c >= '0' && c <= '9';
        }

        private static String printable(char c) {
            return c < 0x20 || c > 0x7e ? String.format("\\u%04x", (int) c) : String.valueOf(c);
        }
    }

    // =================================================================== writing

    /** Serialize {@code value} as compact JSON (one line: every control character is escaped). */
    static String write(Object value) {
        StringBuilder sb = new StringBuilder(64);
        write(sb, value, 0);
        return sb.toString();
    }

    /** A JSON string literal for {@code s}. */
    static String quote(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2);
        quote(sb, s);
        return sb.toString();
    }

    private static void write(StringBuilder sb, Object v, int depth) {
        if (depth > MAX_DEPTH) {
            throw new JsonException("nesting deeper than " + MAX_DEPTH + " (cyclic structure?)", -1);
        }
        if (v == null) {
            sb.append("null");
        } else if (v instanceof CharSequence) {
            quote(sb, v.toString());
        } else if (v instanceof Boolean) {
            sb.append(((Boolean) v).booleanValue() ? "true" : "false");
        } else if (v instanceof Long || v instanceof Integer || v instanceof Short || v instanceof Byte
                || v instanceof BigInteger || v instanceof AtomicInteger || v instanceof AtomicLong) {
            sb.append(v.toString());
        } else if (v instanceof BigDecimal) {
            sb.append(v.toString());
        } else if (v instanceof Float) {
            float f = (Float) v;
            if (Float.isNaN(f) || Float.isInfinite(f)) {
                throw new JsonException("JSON cannot represent " + f, -1);
            }
            sb.append(Float.toString(f));
        } else if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) {
                throw new JsonException("JSON cannot represent " + d, -1);
            }
            sb.append(Double.toString(d));
        } else if (v instanceof Character) {
            quote(sb, v.toString());
        } else if (v instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                if (!first) {
                    sb.append(',');
                }
                first = false;
                quote(sb, String.valueOf(e.getKey()));
                sb.append(':');
                write(sb, e.getValue(), depth + 1);
            }
            sb.append('}');
        } else if (v instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object item : (Iterable<?>) v) {
                if (!first) {
                    sb.append(',');
                }
                first = false;
                write(sb, item, depth + 1);
            }
            sb.append(']');
        } else if (v.getClass().isArray()) {
            sb.append('[');
            int n = Array.getLength(v);
            for (int i = 0; i < n; i++) {
                if (i > 0) {
                    sb.append(',');
                }
                write(sb, Array.get(v, i), depth + 1);
            }
            sb.append(']');
        } else {
            throw new JsonException("cannot write " + v.getClass().getName() + " as JSON", -1);
        }
    }

    private static void quote(StringBuilder sb, String s) {
        sb.append('"');
        int n = s.length();
        int start = 0;
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            String escape = null;
            boolean hex = false;
            if (c == '"') {
                escape = "\\\"";
            } else if (c == '\\') {
                escape = "\\\\";
            } else if (c < 0x20) {
                switch (c) {
                    case '\n':
                        escape = "\\n";
                        break;
                    case '\r':
                        escape = "\\r";
                        break;
                    case '\t':
                        escape = "\\t";
                        break;
                    case '\b':
                        escape = "\\b";
                        break;
                    case '\f':
                        escape = "\\f";
                        break;
                    default:
                        hex = true;
                }
            } else if (c == LINE_SEPARATOR || c == PARAGRAPH_SEPARATOR) {
                hex = true;
            } else if (Character.isHighSurrogate(c)) {
                if (i + 1 < n && Character.isLowSurrogate(s.charAt(i + 1))) {
                    i++; // valid pair, copied verbatim
                    continue;
                }
                hex = true; // lone surrogate: escape so it survives UTF-8 encoding
            } else if (Character.isLowSurrogate(c)) {
                hex = true;
            } else {
                continue;
            }
            sb.append(s, start, i);
            if (hex) {
                sb.append("\\u").append(HEX[(c >> 12) & 0xf]).append(HEX[(c >> 8) & 0xf])
                        .append(HEX[(c >> 4) & 0xf]).append(HEX[c & 0xf]);
            } else {
                sb.append(escape);
            }
            start = i + 1;
        }
        sb.append(s, start, n);
        sb.append('"');
    }

    /** Number of bytes {@code s} occupies in UTF-8 (lone surrogates count as 3). */
    static long utf8Length(CharSequence s) {
        long bytes = 0;
        int n = s.length();
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            if (c < 0x80) {
                bytes++;
            } else if (c < 0x800) {
                bytes += 2;
            } else if (Character.isHighSurrogate(c) && i + 1 < n && Character.isLowSurrogate(s.charAt(i + 1))) {
                bytes += 4;
                i++;
            } else {
                bytes += 3;
            }
        }
        return bytes;
    }
}
