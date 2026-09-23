package github.hacimertgokhan.denis.storage;

/**
 * Redis-style glob: {@code *} any run, {@code ?} one character, {@code [abc]} /
 * {@code [a-z]} / {@code [^a]} a class, {@code \} escapes. Iterative matcher
 * with single-star backtracking, so a hostile pattern cannot blow up.
 */
public final class Glob {
    private final String pattern;
    private final boolean matchAll;
    private final String literalPrefix;

    public Glob(String pattern) {
        this.pattern = pattern == null || pattern.isEmpty() ? "*" : pattern;
        this.matchAll = this.pattern.equals("*");
        int i = 0;
        while (i < this.pattern.length() && "*?[\\".indexOf(this.pattern.charAt(i)) < 0) {
            i++;
        }
        this.literalPrefix = this.pattern.substring(0, i);
    }

    public boolean matchesAll() {
        return matchAll;
    }

    public boolean matches(String text) {
        if (matchAll) {
            return true;
        }
        if (!text.startsWith(literalPrefix)) {
            return false;
        }
        int p = 0;
        int t = 0;
        int starP = -1;
        int starT = -1;
        while (t < text.length()) {
            if (p < pattern.length()) {
                char c = pattern.charAt(p);
                if (c == '*') {
                    starP = p++;
                    starT = t;
                    continue;
                }
                int consumed = matchOne(p, text.charAt(t));
                if (consumed > 0) {
                    p += consumed;
                    t++;
                    continue;
                }
            }
            if (starP >= 0) {
                p = starP + 1;
                t = ++starT;
                continue;
            }
            return false;
        }
        while (p < pattern.length() && pattern.charAt(p) == '*') {
            p++;
        }
        return p == pattern.length();
    }

    /** @return pattern characters consumed when {@code ch} matches at {@code p}, else 0 */
    private int matchOne(int p, char ch) {
        char c = pattern.charAt(p);
        if (c == '?') {
            return 1;
        }
        if (c == '\\' && p + 1 < pattern.length()) {
            return pattern.charAt(p + 1) == ch ? 2 : 0;
        }
        if (c == '[') {
            int end = pattern.indexOf(']', p + 2);
            if (end < 0) {
                return c == ch ? 1 : 0;
            }
            int i = p + 1;
            boolean negate = pattern.charAt(i) == '^' || pattern.charAt(i) == '!';
            if (negate) {
                i++;
            }
            boolean found = false;
            while (i < end) {
                char lo = pattern.charAt(i);
                if (i + 2 < end && pattern.charAt(i + 1) == '-') {
                    char hi = pattern.charAt(i + 2);
                    if (ch >= lo && ch <= hi) {
                        found = true;
                    }
                    i += 3;
                } else {
                    if (ch == lo) {
                        found = true;
                    }
                    i++;
                }
            }
            return found != negate ? end - p + 1 : 0;
        }
        return c == ch ? 1 : 0;
    }
}
