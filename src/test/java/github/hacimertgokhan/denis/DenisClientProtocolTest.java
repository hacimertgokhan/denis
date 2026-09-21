package github.hacimertgokhan.denis;

import github.hacimertgokhan.denis.server.ServerContext;
import org.json.JSONObject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The wire protocol, driven line by line through {@link DenisClient#handleLine}. */
class DenisClientProtocolTest {
    @TempDir
    Path dir;
    private ServerContext ctx;
    private DenisClient client;

    @BeforeEach
    void setUp() throws IOException {
        ctx = TestContext.open(dir);
        client = new DenisClient(ctx);
    }

    @AfterEach
    void tearDown() throws IOException {
        ctx.close();
    }

    private String send(String line) {
        StringWriter buffer = new StringWriter();
        PrintWriter out = new PrintWriter(buffer, true);
        client.handleLine(line, out);
        return buffer.toString().trim();
    }

    private JSONObject json(String line) {
        return new JSONObject(send(line));
    }

    private void loginAndCreateProject() {
        send("MODE json");
        assertTrue(json("LIN " + TestContext.GROUP + " " + TestContext.PASSWORD).getBoolean("ok"));
        JSONObject created = json("AUTH CREATE");
        assertTrue(created.getBoolean("ok"));
        assertTrue(json("AUTH " + created.getString("token")).getBoolean("ok"));
    }

    @Test
    void pingNeedsNoLogin() {
        assertEquals("PONG", send("PING"));
    }

    @Test
    void commandsBeforeLoginAreRefused() {
        String reply = send("SET a b");
        assertTrue(reply.startsWith("[Error - "), reply);
        assertTrue(reply.contains("LIN"), reply);
    }

    @Test
    void jsonModeAnswersOneObjectPerLine() {
        JSONObject mode = json("MODE json");
        assertTrue(mode.getBoolean("ok"));
        assertEquals("mode json", mode.getString("message"));

        JSONObject ping = json("PING");
        assertTrue(ping.getBoolean("ok"));
        assertEquals("PONG", ping.getString("message"));

        JSONObject refused = json("GET x");
        assertFalse(refused.getBoolean("ok"));
        assertTrue(refused.getString("error").contains("LIN"));

        JSONObject usage = json("LIN onlygroup");
        assertFalse(usage.getBoolean("ok"));
        assertTrue(usage.getString("error").startsWith("USAGE"));
    }

    @Test
    void modeCanBeSwitchedBack() {
        send("MODE json");
        String back = send("MODE text");
        assertTrue(back.startsWith("[Info - ") && back.endsWith("mode text"), back);
        assertEquals("PONG", send("PING"));
    }

    @Test
    void exitClosesTheConnection() {
        StringWriter buffer = new StringWriter();
        assertFalse(client.handleLine("EXIT", new PrintWriter(buffer, true)));
        assertTrue(buffer.toString().contains("Bye"));
    }

    @Test
    void wrongPasswordIsRefused() {
        send("MODE json");
        JSONObject reply = json("LIN " + TestContext.GROUP + " nope");
        assertFalse(reply.getBoolean("ok"));
        assertFalse(json("AUTH CREATE").getBoolean("ok"));
    }

    @Test
    void keyValueRoundTrip() {
        loginAndCreateProject();
        assertTrue(json("SET greeting hello world").getBoolean("ok"));
        assertEquals("hello world", json("GET greeting").getString("data"));
        assertTrue(json("EXISTS greeting").getBoolean("exists"));
        assertFalse(json("EXISTS nope").getBoolean("exists"));

        JSONObject missing = json("GET nope");
        assertFalse(missing.getBoolean("ok"));
        assertEquals("not found", missing.getString("error"));

        assertTrue(json("DEL greeting").getBoolean("ok"));
        assertFalse(json("GET greeting").getBoolean("ok"));
    }

    @Test
    void flagsAreNotPartOfTheValue() {
        loginAndCreateProject();
        JSONObject set = json("SET k persisted value -&cache -&save");
        assertEquals("Ok (Cache, Protobuf)", set.getString("message"));
        assertEquals("persisted value", json("GET k").getString("data"));
        assertEquals("persisted value", json("GET k -&from-protobuff").getString("data"));
        assertEquals("persisted value", ctx.persistence().getData(client.getProjectToken(), "k"));
    }

    @Test
    void heavenDropsCacheButKeepsPersistedKeys() {
        loginAndCreateProject();
        send("SET cached only");
        send("SET saved forever -&save");
        JSONObject heaven = json("HEAVEN");
        assertTrue(heaven.getBoolean("ok"));
        assertEquals(2, heaven.getInt("removed"));
        assertFalse(json("GET cached").getBoolean("ok"));
        assertEquals("forever", json("GET saved").getString("data"));
    }

    @Test
    void keysAndMget() {
        loginAndCreateProject();
        send("SET user:1 ada");
        send("SET user:2 grace -&save");
        send("SET other x");
        JSONObject keys = json("KEYS user:*");
        assertEquals(2, keys.getInt("count"));
        assertEquals("user:1", keys.getJSONArray("keys").getString(0));
        assertEquals(3, json("KEYS").getInt("count"));

        JSONObject values = json("MGET user:1 nope").getJSONObject("values");
        assertEquals("ada", values.getString("user:1"));
        assertTrue(values.isNull("nope"));
    }

    @Test
    void projectsAreIsolatedAndSharedBetweenConnections() {
        loginAndCreateProject();
        String first = client.getProjectToken();
        send("SET shared 1");

        DenisClient other = new DenisClient(ctx);
        StringWriter buffer = new StringWriter();
        PrintWriter out = new PrintWriter(buffer, true);
        other.handleLine("MODE json", out);
        other.handleLine("LIN " + TestContext.GROUP + " " + TestContext.PASSWORD, out);
        other.handleLine("AUTH " + first, out);
        buffer.getBuffer().setLength(0);
        other.handleLine("GET shared", out);
        assertEquals("1", new JSONObject(buffer.toString().trim()).getString("data"));

        JSONObject second = json("AUTH CREATE");
        send("AUTH " + second.getString("token"));
        assertFalse(json("GET shared").getBoolean("ok"));
    }

    @Test
    void sqlRepliesAreStructured() {
        loginAndCreateProject();
        JSONObject created = json("CREATE TABLE users (id INT, name TEXT)");
        assertTrue(created.getBoolean("ok"));
        assertEquals("affected", created.getString("type"));
        assertEquals(2, json("INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Grace')").getInt("affected"));

        JSONObject rows = json("SELECT name FROM users WHERE id = 2");
        assertEquals("rows", rows.getString("type"));
        assertEquals(1, rows.getInt("count"));
        assertEquals("Grace", rows.getJSONArray("rows").getJSONObject(0).getString("name"));

        JSONObject tables = json("SHOW TABLES");
        assertEquals("users", tables.getJSONArray("tables").getJSONObject(0).getString("name"));
        assertEquals(2, tables.getJSONArray("tables").getJSONObject(0).getInt("rows"));

        JSONObject error = json("SELECT * FROM missing");
        assertFalse(error.getBoolean("ok"));
        assertEquals("Table not found: missing", error.getString("error"));

        // tables are persisted ...
        assertTrue(ctx.persistence().exists(client.getProjectToken(), "__sql:users:schema"));
        // ... and do not show up as ordinary keys
        assertEquals(0, json("KEYS").getInt("count"));
    }

    @Test
    void helpAndInfoAreMachineReadable() {
        send("MODE json");
        JSONObject help = json("HELP");
        assertTrue(help.getJSONArray("commands").length() > 10);
        loginAndCreateProject();
        JSONObject info = json("INFO");
        assertTrue(info.getBoolean("ok"));
        assertEquals(1, info.getInt("projects"));
        assertTrue(info.has("uptimeSeconds"));
        assertTrue(info.getJSONObject("project").has("cachedKeys"));
    }
}
