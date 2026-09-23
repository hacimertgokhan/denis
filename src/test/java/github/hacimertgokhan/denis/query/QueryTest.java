package github.hacimertgokhan.denis.query;

import github.hacimertgokhan.denis.query.QueryParser.Field;
import github.hacimertgokhan.denis.server.TestSessions;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The QUERY document language: parser on its own, then whole documents through the protocol. */
class QueryTest {
    @TempDir
    Path dir;
    private TestSessions sessions;
    private TestSessions.Client client;

    @BeforeEach
    void setUp() throws IOException {
        sessions = new TestSessions(dir);
        client = sessions.client();
        send("MODE json");
        send("LIN " + TestSessions.GROUP + " " + TestSessions.PASSWORD);
        String token = new JSONObject(send("AUTH CREATE")).getString("token");
        send("AUTH " + token);
        send("SET user:1 {\"name\":\"Ada\",\"email\":\"ada@example.com\",\"address\":{\"city\":\"London\",\"zip\":\"N1\"}} -&save");
        send("SET user:2 {\"name\":\"Grace\",\"email\":\"grace@example.com\"}");
        send("SET greeting hello world");
        send("SET cart:1:a {\"sku\":\"pen\",\"qty\":2}");
        send("SET cart:1:b {\"sku\":\"book\",\"qty\":1}");
        send("CREATE TABLE orders (id INT, user_id INT, total REAL, note TEXT)");
        send("INSERT INTO orders (id, user_id, total, note) VALUES (1, 1, 36, 'first'), (2, 1, 40, 'second'), (3, 2, 5, 'other')");
    }

    @AfterEach
    void tearDown() {
        sessions.close();
    }

    private String send(String line) {
        return client.send(line);
    }

    private JSONObject query(String document) {
        return new JSONObject(send("QUERY " + document));
    }

    // ------------------------------------------------------------------ parser

    @Test
    void parsesAliasesArgumentsAndSelections() {
        List<Field> fields = QueryParser.parse("{ u: get(\"user:1\") { name address { city } } orders: table(\"orders\", where: \"user_id = 1\", limit: 5) { id total } keys(\"cart:*\") }");
        assertEquals(3, fields.size());
        Field u = fields.get(0);
        assertEquals("u", u.alias());
        assertEquals("get", u.name());
        assertEquals("user:1", u.arg("key", 0));
        assertEquals(2, u.selection().size());
        assertEquals("city", u.selection().get(1).selection().get(0).name());
        Field orders = fields.get(1);
        assertEquals("orders", orders.arg("name", 0));
        assertEquals("user_id = 1", orders.arg("where", 1));
        assertEquals(5L, orders.arg("limit", -1));
        assertEquals("keys", fields.get(2).alias());
    }

    @Test
    void parserReportsWhereItFailed() {
        QueryParser.ParseException e = assertThrows(QueryParser.ParseException.class, () -> QueryParser.parse("{ get(\"a\" }"));
        assertTrue(e.getMessage().contains("at "));
        assertThrows(QueryParser.ParseException.class, () -> QueryParser.parse("get(\"a\")"));
        assertThrows(QueryParser.ParseException.class, () -> QueryParser.parse("{ }"));
        assertThrows(QueryParser.ParseException.class, () -> QueryParser.parse("{ get(\"unterminated) }"));
    }

    // --------------------------------------------------------------- documents

    @Test
    void oneRoundTripManyReads() {
        JSONObject reply = query("{ user: get(\"user:1\") { name address { city } } hello: get(\"greeting\") missing: get(\"nope\") has: exists(\"greeting\") cart: keys(\"cart:1:*\") }");
        assertTrue(reply.getBoolean("ok"));
        assertFalse(reply.has("errors"));
        JSONObject data = reply.getJSONObject("data");
        JSONObject user = data.getJSONObject("user");
        assertEquals("Ada", user.getString("name"));
        assertEquals("London", user.getJSONObject("address").getString("city"));
        assertFalse(user.has("email"), "unselected fields are dropped");
        assertFalse(user.getJSONObject("address").has("zip"));
        assertEquals("hello world", data.getString("hello"));
        assertTrue(data.isNull("missing"));
        assertTrue(data.getBoolean("has"));
        assertEquals(2, data.getJSONArray("cart").length());
    }

    @Test
    void tablesProjectColumnsAndCountIsOneNumber() {
        JSONObject data = query("{ orders: table(\"orders\", where: \"user_id = 1\", order: \"total desc\", limit: 1) { id total } n: count(\"orders\") all: sql(\"SELECT id FROM orders WHERE total > 10\") { id } }").getJSONObject("data");
        JSONArray orders = data.getJSONArray("orders");
        assertEquals(1, orders.length());
        assertEquals(2, orders.getJSONObject(0).getInt("id"));
        assertFalse(orders.getJSONObject(0).has("note"));
        assertEquals(3, data.getInt("n"));
        assertEquals(2, data.getJSONArray("all").length());
    }

    @Test
    void mgetAndPrefixShapeEveryValue() {
        JSONObject data = query("{ users: mget(\"user:1\", \"user:2\", \"user:9\") { name } cart: prefix(\"cart:1:\") { sku } }").getJSONObject("data");
        JSONObject users = data.getJSONObject("users");
        assertEquals("Ada", users.getJSONObject("user:1").getString("name"));
        assertEquals("Grace", users.getJSONObject("user:2").getString("name"));
        assertTrue(users.isNull("user:9"));
        JSONObject cart = data.getJSONObject("cart");
        assertEquals("pen", cart.getJSONObject("cart:1:a").getString("sku"));
        assertFalse(cart.getJSONObject("cart:1:a").has("qty"));
    }

    @Test
    void aFailingFieldDoesNotFailTheOthers() {
        JSONObject reply = query("{ ok: get(\"greeting\") bad: get(\"greeting\") { name } nope: count(\"missing_table\") write: sql(\"DELETE FROM orders\") }");
        assertTrue(reply.getBoolean("ok"));
        JSONObject data = reply.getJSONObject("data");
        assertEquals("hello world", data.getString("ok"));
        assertTrue(data.isNull("bad"));
        assertTrue(data.isNull("nope"));
        assertTrue(data.isNull("write"));
        JSONArray errors = reply.getJSONArray("errors");
        assertEquals(3, errors.length());
        assertEquals("bad", errors.getJSONObject(0).getString("path"));
        assertTrue(errors.getJSONObject(0).getString("error").contains("not JSON"));
        assertTrue(errors.getJSONObject(2).getString("error").contains("only runs SELECT"));
        // nothing was deleted
        assertEquals(3, query("{ n: count(\"orders\") }").getJSONObject("data").getInt("n"));
    }

    @Test
    void syntaxErrorsAndUnknownResolvers() {
        JSONObject bad = query("{ get(\"a\" }");
        assertFalse(bad.getBoolean("ok"));
        assertTrue(bad.getString("error").startsWith("syntax:"));
        assertTrue(bad.has("offset"));
        JSONObject unknown = query("{ x: frobnicate(\"a\") }");
        assertTrue(unknown.getBoolean("ok"));
        assertTrue(unknown.getJSONArray("errors").getJSONObject(0).getString("error").contains("unknown resolver"));
        assertNull(unknown.getJSONObject("data").opt("missing"));
    }

    @Test
    void describeAndTablesAreAvailable() {
        JSONObject data = query("{ schema: tables() orders: describe(\"orders\") }").getJSONObject("data");
        assertEquals("orders", data.getJSONArray("schema").getJSONObject(0).getString("name"));
        assertEquals(4, data.getJSONObject("orders").getJSONArray("columns").length());
    }
}
