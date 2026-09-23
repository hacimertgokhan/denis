package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.storage.wal.FsyncPolicy;
import github.hacimertgokhan.readers.DenisProperties;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The protocol surface of Denis 0.3-0.5 that Denis Cloud, the MCP server and
 * released clients depend on: ADMIN commands with quotas, reply shapes of
 * SQL/INFO/HELP/MGET/HEAVEN, the QUERY document, and the old config keys.
 */
class CompatibilityTest {
    @TempDir
    Path dir;
    private TestSessions sessions;
    private TestSessions.Client c;

    @BeforeEach
    void setUp() throws IOException {
        sessions = new TestSessions(dir);
        c = sessions.client();
        c.send("MODE json");
    }

    @AfterEach
    void tearDown() {
        sessions.close();
    }

    private JSONObject json(String line) {
        return new JSONObject(c.send(line));
    }

    private JSONObject admin(String rest) {
        return json("ADMIN " + TestSessions.MAIN_TOKEN + " " + rest);
    }

    private void login() {
        assertTrue(json("LIN " + TestSessions.GROUP + " " + TestSessions.PASSWORD).getBoolean("ok"));
    }

    @Test
    void adminManagesProjectsWithoutALogin() {
        assertEquals("ADMIN refused: wrong main token", json("ADMIN wrong LIST").getString("error"));

        String token = admin("CREATE 3 1000").getString("token");
        JSONObject usage = admin("USAGE " + token);
        assertEquals(token, usage.getString("token"));
        assertEquals(3, usage.getJSONObject("quota").getLong("maxKeys"));
        assertEquals(0, usage.getJSONObject("usage").getLong("cachedKeys"));
        assertEquals(1, admin("LIST").getInt("count"));

        login();
        assertTrue(json("AUTH " + token).getBoolean("ok"));
        for (int i = 0; i < 3; i++) {
            assertTrue(json("SET k" + i + " v -&save").getBoolean("ok"));
        }
        JSONObject refused = json("SET k3 v");
        assertEquals("QUOTA", refused.getString("code"));
        assertEquals("keys", refused.getString("resource"));
        assertEquals(3, refused.getLong("limit"));
        assertEquals("quota exceeded: keys (limit 3)", refused.getString("error"));
        assertTrue(json("SET k0 overwrite-is-fine").getBoolean("ok"), "replacing a key adds none");

        JSONObject counted = admin("USAGE " + token).getJSONObject("usage");
        assertEquals(3, counted.getLong("cachedKeys"));
        assertEquals(3, counted.getLong("persistedKeys"));
        assertTrue(counted.getLong("persistedBytes") > 0);

        assertTrue(admin("QUOTA " + token + " 0 0").getBoolean("ok"));
        assertTrue(json("SET k3 v").getBoolean("ok"), "0 = unlimited");

        assertTrue(admin("FLUSH " + token).getBoolean("ok"));
        assertEquals("NOTFOUND", json("GET k0").getString("code"));
        assertTrue(json("AUTH " + token).getBoolean("ok"), "FLUSH keeps the project");

        assertTrue(admin("DROP " + token).getBoolean("ok"));
        assertFalse(json("AUTH " + token).getBoolean("ok"));
        assertTrue(json("AUTH " + token).getString("error").startsWith("Cannot auth with"));
        assertTrue(admin("USAGE " + token).getString("error").startsWith("Unknown project"));
    }

    @Test
    void adminImportAdoptsATokenOnce() {
        String token = "A".repeat(128);
        JSONObject first = admin("IMPORT " + token + " 10 0");
        assertTrue(first.getBoolean("added"));
        assertFalse(admin("IMPORT " + token).getBoolean("added"));
        assertEquals(10, admin("USAGE " + token).getJSONObject("quota").getLong("maxKeys"));
        assertEquals("USAGE", admin("IMPORT bad-token!").getString("code"));
    }

    @Test
    void replyShapesOfTheReleasedProtocol() {
        login();
        String token = json("AUTH CREATE").getString("token");
        json("AUTH " + token);

        JSONObject info = json("INFO");
        for (String field : new String[]{"version", "uptimeSeconds", "startedAt", "commandsTotal", "cacheKeys",
                "persistedKeys", "projects", "group", "info"}) {
            assertTrue(info.has(field), "INFO has " + field);
        }
        assertTrue(info.getJSONObject("connections").has("open"));
        assertTrue(info.getJSONObject("memory").has("maxMb"));
        assertTrue(info.getJSONObject("project").has("quota"));

        JSONObject help = json("HELP");
        JSONObject first = help.getJSONArray("commands").getJSONObject(0);
        for (String field : new String[]{"name", "usage", "description", "needsLogin", "needsProject"}) {
            assertTrue(first.has(field), "HELP entries have " + field);
        }

        json("SET a 1");
        assertEquals("1", json("MGET a b").getJSONObject("values").getString("a"));
        assertTrue(c.send("MGET zz a mm").contains("\"data\":{\"zz\":null,\"a\":\"1\",\"mm\":null}"), "request order");
        assertEquals("USAGE", json("QUERY { a: get(").getString("code"));
        for (String cut : new String[]{"{", "{ a", "{ a:", "{ a: get(\"k\"", "{ a: get(\"k", "{ a: get(x:", "{ a { b"}) {
            assertEquals("USAGE", json("QUERY " + cut).getString("code"), cut);
        }
        assertEquals(1, json("HEAVEN").getInt("removed"));
        assertTrue(json("FROB").getString("error").endsWith("(try HELP)"));

        JSONObject created = json("SQL CREATE TABLE t (id INT, name TEXT)");
        assertEquals("affected", created.getString("type"));
        JSONObject inserted = json("INSERT INTO t (id, name) VALUES (1, 'Ada')");
        assertEquals(1, inserted.getInt("affected"));
        JSONObject rows = json("SELECT * FROM t");
        assertEquals("rows", rows.getString("type"));
        assertEquals("Ada", rows.getJSONArray("rows").getJSONObject(0).getString("name"));
        JSONObject tables = json("SHOW TABLES");
        assertEquals("tables", tables.getString("type"));
        JSONObject table = tables.getJSONArray("tables").getJSONObject(0);
        assertEquals("t", table.getString("name"));
        assertEquals(1, table.getInt("rows"));
        assertEquals("id", table.getJSONArray("columns").getJSONObject(0).getString("name"));
        assertEquals("t", json("DESCRIBE t").getJSONArray("tables").getJSONObject(0).getString("name"));
    }

    @Test
    void queryIsADocumentOrBoundSql() {
        login();
        json("AUTH " + json("AUTH CREATE").getString("token"));
        json("SET user:1 {\"name\":\"Ada\"}");
        json("SQL CREATE TABLE t (id INT PRIMARY KEY)");
        JSONObject document = json("QUERY { u: get(\"user:1\") { name } n: count(\"t\") }");
        assertEquals("Ada", document.getJSONObject("data").getJSONObject("u").getString("name"));
        assertEquals(0, document.getJSONObject("data").getInt("n"));
        JSONObject bound = json("QUERY " + new JSONObject().put("sql", "INSERT INTO t (id) VALUES (?)")
                .put("params", new JSONArray().put(7)));
        assertEquals("affected", bound.getString("type"));
        assertEquals(1, json("QUERY { n: count(\"t\") }").getJSONObject("data").getInt("n"));
    }

    @Test
    void configKeysOfEarlierReleasesStillWork() {
        ServerConfig config = ServerConfig.from(new DenisProperties(Map.of(
                "DENIS_MAX_CONNECTIONS", "7",
                "DENIS_CLIENT_IDLE_TIMEOUT_MS", "5000",
                "DENIS_PERSIST_FLUSH_INTERVAL_MS", "0",
                "DENIS_PERSIST_SNAPSHOT_INTERVAL_MS", "30000",
                "DDB_MAIN_TOKEN", "x".repeat(64))));
        assertEquals(7, config.maxClients());
        assertEquals(5, config.clientTimeoutSeconds());
        assertEquals(FsyncPolicy.ALWAYS, config.storage().fsync());
        assertEquals(30_000, config.storage().checkpointIntervalMillis());
        assertEquals("x".repeat(64), config.mainToken());
    }
}
