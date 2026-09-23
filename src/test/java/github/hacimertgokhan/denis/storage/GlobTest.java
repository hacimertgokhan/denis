package github.hacimertgokhan.denis.storage;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GlobTest {
    @Test
    void redisStylePatterns() {
        assertTrue(new Glob("*").matches("anything"));
        assertTrue(new Glob("user:*").matches("user:42"));
        assertFalse(new Glob("user:*").matches("order:42"));
        assertTrue(new Glob("h?llo").matches("hello"));
        assertTrue(new Glob("h[ae]llo").matches("hallo"));
        assertFalse(new Glob("h[^e]llo").matches("hello"));
        assertTrue(new Glob("h[a-c]llo").matches("hbllo"));
        assertTrue(new Glob("a\\*b").matches("a*b"));
        assertFalse(new Glob("a\\*b").matches("axb"));
        assertTrue(new Glob("*:*:end").matches("a:b:end"));
    }

    @Test
    void pathologicalPatternsStayLinear() {
        String text = "a".repeat(5000);
        assertTimeoutPreemptively(java.time.Duration.ofSeconds(2),
                () -> assertFalse(new Glob("*a*a*a*a*a*a*a*b").matches(text)));
    }
}
