package github.hacimertgokhan.denis.query;

import java.util.ArrayList;
import java.util.List;

/**
 * Parser for the {@code QUERY} document language: a GraphQL-shaped selection
 * over a project, written on one line.
 *
 * <pre>
 *   { user: get("user:1") { name email }  orders: table("orders", where: "user_id = 1", limit: 10) { id total } }
 * </pre>
 *
 * Grammar:
 * <pre>
 *   document  := '{' field* '}'
 *   field     := [alias ':'] name ['(' args ')'] [selection]
 *   args      := arg (',' arg)*          arg := [name ':'] value
 *   value     := string | number | true | false | null | identifier
 *   selection := '{' field* '}'          (a sub-field is a name with an optional alias and selection)
 * </pre>
 * Strings are double-quoted with backslash escapes. Commas between fields are
 * optional. Errors carry the character offset so a client can point at them.
 */
public final class QueryParser {

    /** One requested field: what to call it, which resolver, its arguments and the projection below it. */
    public record Field(String alias, String name, List<Arg> args, List<Field> selection) {
        public Object arg(int index) {
            return index < args.size() ? args.get(index).value() : null;
        }

        /** A named argument, or the positional one at {@code index} when no name matches. */
        public Object arg(String name, int index) {
            for (Arg a : args) {
                if (name.equals(a.name())) {
                    return a.value();
                }
            }
            int position = 0;
            for (Arg a : args) {
                if (a.name() == null) {
                    if (position == index) {
                        return a.value();
                    }
                    position++;
                }
            }
            return null;
        }

        public boolean hasSelection() {
            return !selection.isEmpty();
        }
    }

    /** {@code name: value} or a positional {@code value} (name is null). */
    public record Arg(String name, Object value) {
    }

    public static final class ParseException extends RuntimeException {
        private final int offset;

        ParseException(String message, int offset) {
            super(message + " at " + offset);
            this.offset = offset;
        }

        public int offset() {
            return offset;
        }
    }

    private final String src;
    private int pos;

    private QueryParser(String src) {
        this.src = src;
    }

    /** Parses a whole document; the outer braces are required. */
    public static List<Field> parse(String document) {
        QueryParser p = new QueryParser(document);
        p.skipSpace();
        p.expect('{');
        List<Field> fields = p.fields();
        p.expect('}');
        p.skipSpace();
        if (p.pos != p.src.length()) {
            throw new ParseException("unexpected '" + p.src.charAt(p.pos) + "' after the document", p.pos);
        }
        if (fields.isEmpty()) {
            throw new ParseException("the document selects nothing", 0);
        }
        return fields;
    }

    private List<Field> fields() {
        List<Field> out = new ArrayList<>();
        while (true) {
            skipSpace();
            if (pos >= src.length()) {
                throw new ParseException("unterminated selection, expected '}'", pos);
            }
            char c = src.charAt(pos);
            if (c == '}') {
                return out;
            }
            if (c == ',') {
                pos++;
                continue;
            }
            out.add(field());
        }
    }

    private Field field() {
        int start = pos;
        String first = identifier();
        String alias = null;
        String name = first;
        skipSpace();
        if (peek(':')) {
            pos++;
            skipSpace();
            alias = first;
            name = identifier();
            skipSpace();
        }
        List<Arg> args = new ArrayList<>();
        if (peek('(')) {
            pos++;
            while (true) {
                skipSpace();
                if (pos >= src.length()) {
                    throw new ParseException("unterminated arguments, expected ')'", pos);
                }
                if (peek(')')) {
                    pos++;
                    break;
                }
                if (peek(',')) {
                    pos++;
                    continue;
                }
                args.add(arg());
            }
            skipSpace();
        }
        List<Field> selection = new ArrayList<>();
        if (peek('{')) {
            pos++;
            selection = fields();
            expect('}');
        }
        if (name.isEmpty()) {
            throw new ParseException("expected a field name", start);
        }
        return new Field(alias == null ? name : alias, name, args, selection);
    }

    private Arg arg() {
        int start = pos;
        if (isIdentStart(src.charAt(pos))) {
            int save = pos;
            String ident = identifier();
            skipSpace();
            if (peek(':')) {
                pos++;
                skipSpace();
                return new Arg(ident, value());
            }
            pos = save;
        }
        Object v = value();
        if (v == null && start == pos) {
            throw new ParseException("expected an argument", start);
        }
        return new Arg(null, v);
    }

    private Object value() {
        skipSpace();
        if (pos >= src.length()) {
            throw new ParseException("expected a value", pos);
        }
        char c = src.charAt(pos);
        if (c == '"') {
            return string();
        }
        if (c == '-' || Character.isDigit(c)) {
            int start = pos;
            pos++;
            while (pos < src.length() && (Character.isDigit(src.charAt(pos)) || src.charAt(pos) == '.')) {
                pos++;
            }
            String text = src.substring(start, pos);
            try {
                return text.contains(".") ? (Object) Double.parseDouble(text) : (Object) Long.parseLong(text);
            } catch (NumberFormatException e) {
                throw new ParseException("bad number '" + text + "'", start);
            }
        }
        if (isIdentStart(c)) {
            String word = identifier();
            return switch (word) {
                case "true" -> Boolean.TRUE;
                case "false" -> Boolean.FALSE;
                case "null" -> null;
                default -> word;
            };
        }
        throw new ParseException("unexpected '" + c + "'", pos);
    }

    private String string() {
        int start = pos;
        pos++; // opening quote
        StringBuilder sb = new StringBuilder();
        while (pos < src.length()) {
            char c = src.charAt(pos++);
            if (c == '"') {
                return sb.toString();
            }
            if (c == '\\' && pos < src.length()) {
                char e = src.charAt(pos++);
                switch (e) {
                    case 'n' -> sb.append('\n');
                    case 't' -> sb.append('\t');
                    case '"' -> sb.append('"');
                    case '\\' -> sb.append('\\');
                    default -> sb.append(e);
                }
                continue;
            }
            sb.append(c);
        }
        throw new ParseException("unterminated string", start);
    }

    private String identifier() {
        int start = pos;
        while (pos < src.length() && isIdentPart(src.charAt(pos))) {
            pos++;
        }
        if (start == pos) {
            throw new ParseException(pos < src.length() ? "unexpected '" + src.charAt(pos) + "'" : "unexpected end", pos);
        }
        return src.substring(start, pos);
    }

    private static boolean isIdentStart(char c) {
        return Character.isLetter(c) || c == '_';
    }

    private static boolean isIdentPart(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '.' || c == '-' || c == '*';
    }

    private boolean peek(char c) {
        return pos < src.length() && src.charAt(pos) == c;
    }

    private void expect(char c) {
        skipSpace();
        if (!peek(c)) {
            throw new ParseException("expected '" + c + "'", pos);
        }
        pos++;
    }

    private void skipSpace() {
        while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) {
            pos++;
        }
    }
}
