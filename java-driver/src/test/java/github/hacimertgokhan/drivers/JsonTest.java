package github.hacimertgokhan.drivers;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JsonTest {

    @Test
    void parsesScalars() {
        assertEquals(Boolean.TRUE, Json.parse("true"));
        assertEquals(Boolean.FALSE, Json.parse(" false "));
        assertNull(Json.parse("null"));
        assertEquals("", Json.parse("\"\""));
        assertEquals(0L, Json.parse("0"));
        assertEquals(0L, Json.parse("-0"));
        assertEquals(42L, Json.parse("42"));
        assertEquals(-7L, Json.parse("-7"));
    }

    @Test
    void integersAreLongsAndBigIntegersBeyondLong() {
        assertEquals(Long.MAX_VALUE, Json.parse(Long.toString(Long.MAX_VALUE)));
        assertEquals(Long.MIN_VALUE, Json.parse(Long.toString(Long.MIN_VALUE)));
        assertEquals(new BigInteger("9223372036854775808"), Json.parse("9223372036854775808"));
        assertEquals(new BigInteger("-123456789012345678901234567890"), Json.parse("-123456789012345678901234567890"));
    }

    @Test
    void decimalsAreDoublesAndHugeOnesBigDecimals() {
        assertEquals(1.5, Json.parse("1.5"));
        assertEquals(-0.25, Json.parse("-0.25"));
        assertEquals(1e10, Json.parse("1e10"));
        assertEquals(1.5e-7, Json.parse("1.5E-7"));
        assertEquals(2.0, Json.parse("2E+0"));
        assertInstanceOf(Double.class, Json.parse("1.0"));
        assertEquals(new BigDecimal("1e400"), Json.parse("1e400"));
    }

    @Test
    void parsesNestedStructuresPreservingOrder() {
        Object v = Json.parse(" { \"b\" : [1, 2.5, \"x\", null, true, {\"c\": []}], \"a\": {} } ");
        Map<?, ?> map = (Map<?, ?>) v;
        assertEquals(List.of("b", "a"), new ArrayList<>(map.keySet()));
        List<?> b = (List<?>) map.get("b");
        assertEquals(6, b.size());
        assertEquals(1L, b.get(0));
        assertEquals(2.5, b.get(1));
        assertEquals("x", b.get(2));
        assertNull(b.get(3));
        assertEquals(true, b.get(4));
        assertEquals(Map.of("c", List.of()), b.get(5));
        assertEquals(Map.of(), map.get("a"));
    }

    @Test
    void lastDuplicateKeyWins() {
        assertEquals(Map.of("a", 2L), Json.parse("{\"a\":1,\"a\":2}"));
    }

    @Test
    void decodesAllEscapes() {
        assertEquals("\" \\ / \b \f \n \r \t", Json.parse("\"\\\" \\\\ \\/ \\b \\f \\n \\r \\t\""));
        assertEquals("A\u00e9\u4e2d", Json.parse("\"\\u0041\\u00E9\\u4e2d\""));
        assertEquals("\u0000\u001f", Json.parse("\"\\u0000\\u001F\""));
    }

    @Test
    void decodesSurrogatePairsAndRawUnicode() {
        String emoji = "\uD83D\uDE00"; // U+1F600
        assertEquals(emoji, Json.parse("\"\\uD83D\\uDE00\""));
        assertEquals(emoji, Json.parse("\"\\ud83d\\ude00\""));
        assertEquals("çğüşöı ✓ " + emoji, Json.parse("\"çğüşöı ✓ " + emoji + "\""));
        assertEquals(1, emoji.codePointCount(0, emoji.length()));
        // lone surrogates survive a round trip through escapes
        assertEquals("\uD800x", Json.parse("\"\\uD800x\""));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "", " ", "{", "}", "[", "[1,]", "[1 2]", "{\"a\"}", "{\"a\":}", "{\"a\":1,}", "{a:1}", "{'a':1}",
            "\"abc", "\"\\x\"", "\"\\u12\"", "\"\\u12G4\"", "\"a\nb\"", "\"tab\there\"",
            "01", "-", "1.", ".5", "1e", "1e+", "+1", "0x10", "NaN", "Infinity", "-Infinity",
            "tru", "nul", "falsey", "true false", "{} {}", "[1]]", "1 2", "\u00a0 1"
    })
    void rejectsMalformedInput(String text) {
        Json.JsonException e = assertThrows(Json.JsonException.class, () -> Json.parse(text));
        assertFalse(e.getMessage().isEmpty());
    }

    @Test
    void rejectsExcessiveNesting() {
        String deep = "[".repeat(Json.MAX_DEPTH + 1) + "]".repeat(Json.MAX_DEPTH + 1);
        assertThrows(Json.JsonException.class, () -> Json.parse(deep));
        String ok = "[".repeat(Json.MAX_DEPTH) + "]".repeat(Json.MAX_DEPTH);
        assertInstanceOf(List.class, Json.parse(ok));
    }

    @Test
    void parseObjectRequiresAnObject() {
        assertThrows(Json.JsonException.class, () -> Json.parseObject("[1]"));
        assertThrows(Json.JsonException.class, () -> Json.parse(null));
        assertEquals(Map.of("ok", true), Json.parseObject("{\"ok\":true}"));
    }

    @Test
    void writesCompactJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("s", "a\"b\\c");
        m.put("i", 1);
        m.put("l", 2L);
        m.put("d", 1.5);
        m.put("f", 0.1f);
        m.put("bd", new BigDecimal("12.3400"));
        m.put("bi", new BigInteger("123456789012345678901234567890"));
        m.put("t", true);
        m.put("n", null);
        m.put("list", List.of(1, "x"));
        m.put("arr", new int[]{1, 2});
        m.put("objs", new Object[]{"y", null});
        m.put("c", 'q');
        assertEquals("{\"s\":\"a\\\"b\\\\c\",\"i\":1,\"l\":2,\"d\":1.5,\"f\":0.1,\"bd\":12.3400,"
                + "\"bi\":123456789012345678901234567890,\"t\":true,\"n\":null,\"list\":[1,\"x\"],\"arr\":[1,2],"
                + "\"objs\":[\"y\",null],\"c\":\"q\"}", Json.write(m));
    }

    @Test
    void writerEscapesEverythingThatWouldBreakALine() {
        String s = "line1\nline2\r\u0001\t\b\f\u2028\u2029";
        String json = Json.write(s);
        assertEquals("\"line1\\nline2\\r\\u0001\\t\\b\\f\\u2028\\u2029\"", json);
        assertFalse(json.contains("\n") || json.contains("\r"));
        assertEquals(s, Json.parse(json));
    }

    @Test
    void writerKeepsValidPairsAndEscapesLoneSurrogates() {
        assertEquals("\"\uD83D\uDE00\"", Json.write("\uD83D\uDE00"));
        assertEquals("\"\\ud800x\\udc00\"", Json.write("\uD800x\uDC00"));
        assertEquals("\uD800x\uDC00", Json.parse(Json.write("\uD800x\uDC00")));
    }

    @Test
    void writerRejectsNonFiniteNumbersAndUnknownTypes() {
        assertThrows(Json.JsonException.class, () -> Json.write(Double.NaN));
        assertThrows(Json.JsonException.class, () -> Json.write(Double.POSITIVE_INFINITY));
        assertThrows(Json.JsonException.class, () -> Json.write(Float.NEGATIVE_INFINITY));
        assertThrows(Json.JsonException.class, () -> Json.write(new Object()));
        List<Object> cyclic = new ArrayList<>();
        cyclic.add(cyclic);
        assertThrows(Json.JsonException.class, () -> Json.write(cyclic));
    }

    @Test
    void roundTripsNestedDocuments() {
        String[] docs = {
                "{}", "[]", "{\"a\":[1,-2,3.25,\"x\",null,true,false,{\"b\":{\"c\":\"\\u0000\"}}]}",
                "{\"ok\":true,\"columns\":[\"id\",\"name\"],\"rows\":[[1,\"Ada\"],[2,null]],\"count\":2}",
                "[1.0E-7,123456789012345678901234567890,1.7976931348623157E308]"
        };
        for (String doc : docs) {
            Object parsed = Json.parse(doc);
            assertEquals(parsed, Json.parse(Json.write(parsed)), doc);
        }
    }

    @Test
    void randomStringsRoundTrip() {
        Random random = new Random(42);
        for (int i = 0; i < 2000; i++) {
            char[] chars = new char[random.nextInt(40)];
            for (int c = 0; c < chars.length; c++) {
                chars[c] = (char) random.nextInt(0x10000); // includes controls and lone surrogates
            }
            String s = new String(chars);
            String json = Json.write(Arrays.asList(s, Map.of(s, s)));
            assertFalse(json.contains("\n"));
            assertEquals(Arrays.asList(s, Map.of(s, s)), Json.parse(json));
        }
    }

    @Test
    void randomNumbersRoundTrip() {
        Random random = new Random(7);
        for (int i = 0; i < 2000; i++) {
            long l = random.nextLong();
            assertEquals(l, Json.parse(Json.write(l)));
            double d = Double.longBitsToDouble(random.nextLong());
            if (Double.isFinite(d)) {
                Object back = Json.parse(Json.write(d));
                assertEquals(d, ((Number) back).doubleValue());
            }
        }
    }

    @Test
    void utf8LengthMatchesTheEncoder() {
        String s = "a\u00e9\u4e2d\uD83D\uDE00";
        assertEquals(s.getBytes(java.nio.charset.StandardCharsets.UTF_8).length, Json.utf8Length(s));
        assertTrue(Json.utf8Length("") == 0);
    }
}
