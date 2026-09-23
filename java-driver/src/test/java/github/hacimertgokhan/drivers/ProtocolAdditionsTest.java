package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisAuthException;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import github.hacimertgokhan.drivers.exceptions.DenisQuotaException;
import github.hacimertgokhan.drivers.exceptions.DenisSqlException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Admin, quota, SQL shapes, QUERY documents, INFO, MGET and HEAVEN of the merged protocol (fake server). */
@Timeout(value = 60, unit = TimeUnit.SECONDS)
class ProtocolAdditionsTest {
    private FakeServer server;
    private final List<DenisClient> clients = new ArrayList<>();

    @BeforeEach
    void start() throws IOException {
        server = new FakeServer();
    }

    @AfterEach
    void stop() throws IOException {
        for (DenisClient c : clients) {
            c.close();
        }
        server.close();
    }

    private DenisClient client(DenisClient.Builder builder) {
        DenisClient c = builder.build();
        clients.add(c);
        return c;
    }

    private DenisClient authed() {
        return client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x").poolSize(1));
    }

    private List<String> sent() {
        return server.connection(0).received;
    }

    private String lastSent() {
        List<String> s = sent();
        return s.get(s.size() - 1);
    }

    // =================================================================== SQL shapes

    @Test
    void objectRowsFollowTheColumnOrderOfColumns() {
        DenisClient client = authed();
        // the fake server sends {"params":..,"sql":..} while "columns" says sql, params
        QueryResult r = client.query("SELECT * FROM t WHERE id = ?", 5);
        assertEquals(QueryResult.ROWS, r.type());
        assertEquals(List.of("sql", "params"), r.columns());
        assertEquals("SELECT * FROM t WHERE id = ?", r.get(0, 0));
        assertEquals("[5]", r.get(0, 1));
        assertEquals(List.of("sql", "params"), new ArrayList<>(r.toMaps().get(0).keySet()));
        assertEquals(1L, ((Number) r.asMap().get("count")).longValue());
        assertFalse(r.asMap().containsKey("ok"));

        // 0.1 servers: rows as arrays, no "type"
        server.override = (c, line) -> line.startsWith("QUERY") ? FakeServer.ok("\"columns\":[\"a\",\"b\"],\"rows\":[[1,\"x\"],[2,null]]") : null;
        QueryResult legacy = client.query("SELECT a, b FROM t");
        assertEquals(QueryResult.ROWS, legacy.type());
        assertEquals(2L, legacy.getLong(1, "a"));
        assertNull(legacy.getString(1, "b"));

        // no "columns": the keys of the row objects, in order of appearance
        server.override = (c, line) -> line.startsWith("QUERY")
                ? FakeServer.ok("\"type\":\"rows\",\"rows\":[{\"id\":1,\"name\":\"Ada\"},{\"id\":2,\"extra\":true}]") : null;
        QueryResult derived = client.query("SELECT * FROM t");
        assertEquals(List.of("id", "name", "extra"), derived.columns());
        assertEquals(java.util.Arrays.asList(2L, null, true), derived.rows().get(1));

        server.override = (c, line) -> line.startsWith("QUERY") ? FakeServer.ok("\"type\":\"rows\",\"columns\":[\"a\"],\"rows\":[7]") : null;
        assertEquals(DenisException.PROTOCOL, assertThrows(DenisException.class, () -> client.query("SELECT a FROM t")).code());
    }

    @Test
    void sqlIsStructuredSqlTextIsTextAndExecuteCountsRows() {
        DenisClient client = authed();
        QueryResult rows = client.sql("SELECT 1");
        assertTrue(rows.isResultSet());
        assertEquals("rows", rows.asMap().get("type"));
        QueryResult change = client.sql("INSERT INTO t VALUES (1)");
        assertEquals(QueryResult.AFFECTED, change.type());
        assertFalse(change.isResultSet());
        assertEquals(1, change.affected());
        assertEquals(7L, change.lastRowId());
        assertEquals("1 row inserted", change.message());
        assertEquals("OK: 1 row inserted", client.sqlText("INSERT INTO t VALUES (1)"));
        assertTrue(lastSent().startsWith("QUERY {\"sql\":\"INSERT INTO t VALUES (1)\""), lastSent());

        assertEquals(1, client.execute("UPDATE t SET a = ? WHERE id = ?", "x", 1));
        assertEquals("QUERY {\"sql\":\"UPDATE t SET a = ? WHERE id = ?\",\"params\":[\"x\",1]}", lastSent());
        assertEquals(1, client.execute("DELETE FROM t WHERE id = ?", List.of(2)));
        DenisException notAChange = assertThrows(DenisException.class, () -> client.execute("SELECT * FROM t"));
        assertTrue(notAChange.getMessage().contains("query()"), notAChange.getMessage());
        assertInstanceOf(DenisSqlException.class, assertThrows(DenisException.class, () -> client.execute("BAD")));

        // without "data" the text form is built like a master-line server prints it
        server.override = (c, line) -> {
            if (line.contains("NODATA-CHANGE")) {
                return FakeServer.ok("\"type\":\"affected\",\"affected\":2,\"message\":\"2 rows updated\"");
            }
            if (line.contains("NODATA-ROWS")) {
                return FakeServer.ok("\"type\":\"rows\",\"columns\":[\"id\"],\"rows\":[{\"id\":1}],\"count\":1");
            }
            return null;
        };
        assertEquals("OK: 2 rows updated", client.sqlText("NODATA-CHANGE"));
        assertEquals("[{\"id\":1}]", client.sqlText("NODATA-ROWS"));
    }

    @Test
    void tablesAndDescribeAreTyped() {
        DenisClient client = authed();
        List<TableInfo> tables = client.tables();
        assertEquals(2, tables.size());
        TableInfo users = tables.get(0);
        assertEquals("users", users.name());
        assertEquals(2, users.rows());
        assertEquals(List.of("id", "name"), users.columnNames());
        assertEquals("INTEGER", users.columns().get(0).type());
        assertEquals(true, users.column("ID").get("primaryKey"));
        assertNull(users.column("nope"));
        assertEquals("orders", tables.get(1).name());
        assertTrue(lastSent().startsWith("QUERY {\"sql\":\"SHOW TABLES\""), lastSent());

        TableInfo described = client.describe("users");
        assertEquals("users", described.name());
        assertEquals(2, described.columns().size());
        assertTrue(lastSent().startsWith("QUERY {\"sql\":\"DESCRIBE users\""), lastSent());
        assertInstanceOf(DenisSqlException.class, assertThrows(DenisException.class, () -> client.describe("missing")));
        int before = sent().size();
        for (String bad : new String[]{"a b", "t; DROP TABLE x", "t'", "", null}) {
            assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.describe(bad)).code(), bad);
        }
        assertEquals(before, sent().size());

        QueryResult show = client.query("SHOW TABLES");
        assertEquals(QueryResult.TABLES, show.type());
        assertTrue(show.isResultSet());
        assertEquals(List.of("name", "columns", "rows"), show.columns());
        assertEquals("orders", show.getString(1, "name"));
        assertEquals(2L, show.getLong(0, "rows"));
        assertEquals(2, show.tables().size());
    }

    // =================================================================== QUERY documents

    @Test
    void queryGraphSendsTheDocumentOnOneLineAndDecodesDataAndErrors() {
        DenisClient client = authed();
        GraphResult r = client.queryGraph("{\n  user: get(\"user:1\") { name address { city } }\r\n  n: count(\"orders\")\n}");
        assertEquals("QUERY {   user: get(\"user:1\") { name address { city } }    n: count(\"orders\") }", lastSent());
        assertFalse(r.hasErrors());
        assertEquals(List.of("doc", "user", "n"), new ArrayList<>(r.data().keySet()));
        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) r.get("user");
        assertEquals("Ada", user.get("name"));
        assertEquals(Map.of("city", "London"), user.get("address"));
        assertEquals(3L, r.get("n"));

        GraphResult failed = client.queryGraph("{ ok: get(\"a\") broken: table(\"nope\") }");
        assertTrue(failed.hasErrors());
        assertEquals("broken", failed.errors().get(0).path());
        assertEquals("Table not found: nope", failed.errors().get(0).error());
        assertTrue(failed.data().containsKey("broken"));
        assertNull(failed.get("broken"));

        // escaped quotes and "\n" escapes stay as they are
        client.queryGraph("{ a: get(\"say \\\"hi\\\"\\n\") }");
        assertEquals("QUERY { a: get(\"say \\\"hi\\\"\\n\") }", lastSent());

        server.override = (c, line) -> line.startsWith("QUERY {") && line.contains("oops")
                ? "{\"ok\":false,\"error\":\"syntax: expected ')'\",\"offset\":14}" : null;
        DenisException syntax = assertThrows(DenisException.class, () -> client.queryGraph("{ a: get(\"x\" oops }"));
        assertEquals(14L, syntax.reply().get("offset"));
        assertTrue(syntax.getMessage().startsWith("syntax:"), syntax.getMessage());

        int before = sent().size();
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.queryGraph("{ a: get(\"line\nbreak\") }")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.queryGraph("user: get(\"a\")")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.queryGraph("  ")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class,
                () -> client.queryGraph("{ \"sql\": \"DELETE FROM t\", \"params\": [] }")).code());
        assertEquals(before, sent().size());
    }

    // =================================================================== INFO, MGET, HEAVEN

    @Test
    void infoExposesTheSummaryFieldsAndTheDetailedSections() {
        DenisClient client = authed();
        ServerInfo info = client.info();
        assertEquals("0.2.0", info.version());
        assertEquals(42, info.uptimeSeconds());
        assertEquals("2026-09-23T10:00:00Z", info.startedAt());
        assertEquals(3, info.openConnections());
        assertEquals(9, info.totalConnections());
        assertEquals(77, info.commandsTotal());
        assertEquals(5, info.cacheKeys());
        assertEquals(2, info.persistedKeys());
        assertEquals(4, info.projects());
        assertEquals("grp", info.group());
        assertEquals(12, info.memoryUsedMb());
        assertEquals(512, info.memoryMaxMb());
        ProjectUsage project = info.project();
        assertEquals(1, project.cachedKeys());
        assertEquals(10, project.cachedBytes());
        assertEquals(100, project.maxKeys());
        assertEquals(0, project.maxBytes());
        assertTrue(project.hasQuota());
        assertEquals(Map.of("commands", 77L), info.section("stats"));
        assertEquals(1024L, Protocol.path(info.details(), "memory", "usedBytes"));
        assertNull(info.section("nope"));
        assertTrue(info.has("commandsTotal"));
        assertEquals(77L, info.get("commandsTotal"));
        assertFalse(info.asMap().containsKey("ok"));
        assertTrue(info.asMap().containsKey("info"));

        // a server that only sends the detailed object (0.1) or only the summary (master line, 0.6)
        server.override = (c, line) -> line.equals("INFO") ? FakeServer.ok("\"info\":{\"server\":{\"version\":\"0.1.0\",\"uptimeSeconds\":5},"
                + "\"clients\":{\"connected\":2,\"accepted\":6},\"stats\":{\"commands\":11},\"keyspace\":{\"projects\":3,\"cacheKeys\":8,"
                + "\"persistentKeys\":4},\"memory\":{\"heapUsedBytes\":10485760,\"heapMaxBytes\":104857600}}") : null;
        ServerInfo old = client.info();
        assertEquals("0.1.0", old.version());
        assertEquals(5, old.uptimeSeconds());
        assertEquals(2, old.openConnections());
        assertEquals(6, old.totalConnections());
        assertEquals(11, old.commandsTotal());
        assertEquals(3, old.projects());
        assertEquals(8, old.cacheKeys());
        assertEquals(4, old.persistedKeys());
        assertEquals(10, old.memoryUsedMb());
        assertEquals(100, old.memoryMaxMb());
        assertNull(old.project());
        assertNull(old.startedAt());

        server.override = (c, line) -> line.equals("INFO") ? FakeServer.ok("\"version\":\"1.2.0\",\"project\":{\"cachedKeys\":4,\"cachedBytes\":40,"
                + "\"persistedKeys\":1,\"persistedBytes\":9,\"quota\":{\"maxKeys\":0,\"maxBytes\":2048}}") : null;
        ServerInfo summaryOnly = client.info();
        assertEquals("1.2.0", summaryOnly.version());
        assertEquals(Map.of(), summaryOnly.details());
        assertEquals(-1, summaryOnly.commandsTotal());
        assertEquals(4, summaryOnly.project().cachedKeys());
        assertEquals(2048, summaryOnly.project().maxBytes());
    }

    @Test
    void mgetReadsDataOrValuesAndClearReturnsTheRemovedCount() {
        DenisClient client = authed();
        client.set("a", "1");
        client.set("b", "2");
        assertEquals(Map.of("a", "1", "b", "2"), client.mget("a", "b"));
        assertEquals(2, client.clear());
        assertEquals(0, client.clear());

        server.override = (c, line) -> {
            if (line.startsWith("MGET")) {
                return FakeServer.ok("\"values\":{\"a\":\"x\",\"b\":null}"); // master line 0.6: values only
            }
            if (line.equals("HEAVEN")) {
                return FakeServer.ok("\"message\":\"Ok.\""); // 0.1: no count
            }
            return null;
        };
        Map<String, String> m = client.mget(List.of("a", "b"));
        assertEquals("x", m.get("a"));
        assertTrue(m.containsKey("b"));
        assertNull(m.get("b"));
        assertEquals(-1, client.clear());
        assertEquals(-1L, client.async().clear().join());
    }

    // =================================================================== quota and error codes

    @Test
    void quotaErrorsBecomeDenisQuotaException() {
        server.override = (c, line) -> {
            if (line.startsWith("SET full")) {
                return "{\"ok\":false,\"error\":\"quota exceeded: keys (limit 3)\",\"code\":\"QUOTA\",\"resource\":\"keys\",\"limit\":3}";
            }
            if (line.startsWith("SET bytes")) {
                return "{\"ok\":false,\"error\":\"quota exceeded: bytes (limit 1048576)\"}"; // no code: the 0.6 form
            }
            if (line.startsWith("QUERY") && line.contains("INSERT")) {
                return "{\"ok\":false,\"error\":\"quota exceeded: keys (limit 10)\",\"code\":\"QUOTA\",\"resource\":\"keys\",\"limit\":10}";
            }
            return null;
        };
        DenisClient client = authed();
        DenisQuotaException keys = assertThrows(DenisQuotaException.class, () -> client.set("full", "v"));
        assertEquals("QUOTA", keys.code());
        assertEquals("keys", keys.resource());
        assertEquals(3, keys.limit());
        assertEquals(3L, keys.reply().get("limit"));
        assertFalse(keys.isRetryable());

        DenisQuotaException bytes = assertThrows(DenisQuotaException.class, () -> client.set("bytes", "v"));
        assertEquals("bytes", bytes.resource());
        assertEquals(1_048_576, bytes.limit());

        DenisQuotaException sql = assertThrows(DenisQuotaException.class, () -> client.execute("INSERT INTO t VALUES (?)", 1));
        assertEquals(10, sql.limit());
        java.util.concurrent.ExecutionException async = assertThrows(java.util.concurrent.ExecutionException.class,
                () -> client.async().set("full", "v").get(10, TimeUnit.SECONDS));
        assertInstanceOf(DenisQuotaException.class, async.getCause());
    }

    @Test
    void errorsWithoutCodeFromOlderServersAreRecognised() {
        server.override = (c, line) -> {
            switch (line) {
                case "GET gone":
                    return "{\"ok\":false,\"key\":\"gone\",\"error\":\"not found\"}";
                case "GET nologin":
                    return "{\"ok\":false,\"error\":\"Please login first using LIN command\"}";
                case "GET noproject":
                    return "{\"ok\":false,\"error\":\"Please authenticate first using AUTH command\"}";
                case "GET weird":
                    return "{\"ok\":false,\"error\":\"Unknown command: GOT (try HELP)\"}";
                default:
                    break;
            }
            if (line.startsWith("QUERY") && line.contains("nope")) {
                return "{\"ok\":false,\"error\":\"Table not found: nope\"}";
            }
            return null;
        };
        DenisClient client = authed();
        assertNull(client.get("gone"));
        assertEquals("NOAUTH", assertThrows(DenisAuthException.class, () -> client.get("nologin")).code());
        assertEquals("NOPROJECT", assertThrows(DenisAuthException.class, () -> client.get("noproject")).code());
        assertEquals("UNKNOWN", assertThrows(DenisException.class, () -> client.get("weird")).code());
        DenisSqlException sql = assertThrows(DenisSqlException.class, () -> client.query("SELECT * FROM nope"));
        assertEquals("SQL", sql.code());
        assertNull(sql.data());
    }

    // =================================================================== ADMIN

    @Test
    void adminCommandsWorkWithoutLoginAndDecodeUsageAndQuota() {
        DenisClient client = client(server.builder().poolSize(1)); // no credentials
        DenisAdmin admin = client.admin(FakeServer.MAIN_TOKEN);
        assertEquals(List.of(), admin.list());

        String plain = admin.create();
        String limited = admin.create(100, 4096);
        assertEquals("ADMIN " + FakeServer.MAIN_TOKEN + " CREATE 100 4096", lastSent());
        assertTrue(admin.importProject("restored-token"));
        assertFalse(admin.importProject("restored-token"));
        assertTrue(admin.importProject("restored-2", 5, 0));
        assertEquals("ADMIN " + FakeServer.MAIN_TOKEN + " IMPORT restored-2 5 0", lastSent());

        List<ProjectUsage> all = admin.list();
        assertEquals(4, all.size());
        ProjectUsage l = all.stream().filter(p -> p.token().equals(limited)).findFirst().orElseThrow();
        assertEquals(3, l.cachedKeys());
        assertEquals(30, l.cachedBytes());
        assertEquals(1, l.persistedKeys());
        assertEquals(10, l.persistedBytes());
        assertEquals(100, l.maxKeys());
        assertEquals(4096, l.maxBytes());
        assertTrue(l.hasQuota());

        ProjectUsage usage = admin.usage(plain);
        assertEquals(plain, usage.token());
        assertFalse(usage.hasQuota());
        assertEquals("ADMIN " + FakeServer.MAIN_TOKEN + " USAGE " + plain, lastSent());
        ProjectUsage updated = admin.quota(plain, 10, 0);
        assertEquals(10, updated.maxKeys());
        assertEquals("ADMIN " + FakeServer.MAIN_TOKEN + " QUOTA " + plain + " 10 0", lastSent());
        admin.flush(plain);
        assertEquals("ADMIN " + FakeServer.MAIN_TOKEN + " FLUSH " + plain, lastSent());
        admin.drop(plain);
        assertEquals("ADMIN " + FakeServer.MAIN_TOKEN + " DROP " + plain, lastSent());
        assertEquals(3, admin.list().size());

        DenisException unknown = assertThrows(DenisException.class, () -> admin.usage(plain));
        assertEquals("Unknown project: " + plain, unknown.reply().get("error"));

        CompletableFuture<String> created = admin.async().create();
        assertTrue(created.join().startsWith("adm-"));
        assertEquals(4, admin.async().list().join().size());
        assertEquals(10, admin.async().quota(limited, 10, 1).join().maxKeys());

        DenisAuthException refused = assertThrows(DenisAuthException.class, () -> client.admin("wrong").list());
        assertEquals("AUTH", refused.code());
        assertEquals("ADMIN refused: wrong main token", refused.reply().get("error"));
        assertFalse(admin.toString().contains(FakeServer.MAIN_TOKEN));
    }

    @Test
    void adminArgumentsAreValidatedWithoutEchoingTheMainToken() {
        DenisClient client = client(server.builder().poolSize(1));
        int before = sent().size();
        DenisException badToken = assertThrows(DenisException.class, () -> client.admin("secret with space"));
        assertEquals(DenisException.INVALID, badToken.code());
        assertFalse(badToken.getMessage().contains("secret"), badToken.getMessage());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.admin(null)).code());
        DenisAdmin admin = client.admin(FakeServer.MAIN_TOKEN);
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> admin.create(-1, 0)).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> admin.quota("t", 0, -5)).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> admin.usage("a b")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> admin.drop("")).code());
        assertEquals(before, sent().size());

        // code-less refusal (0.6 servers) is still an auth error
        server.override = (c, line) -> line.startsWith("ADMIN") ? "{\"ok\":false,\"error\":\"ADMIN refused: wrong main token\"}" : null;
        assertEquals("AUTH", assertThrows(DenisAuthException.class, admin::list).code());
    }

    // =================================================================== async and pipeline

    @Test
    void newCommandsWorkInPipelinesAndAsync() throws Exception {
        DenisClient client = authed();
        Pipeline p = client.pipeline();
        p.set("a", "1");
        p.execute("INSERT INTO t VALUES (?)", 1);
        p.tables();
        p.describe("users");
        p.queryGraph("{ n: count(\"orders\") }");
        p.sql("SELECT 1");
        p.sqlText("INSERT INTO t VALUES (2)");
        p.info();
        p.clear();
        List<Object> results = p.execute();
        assertEquals(9, results.size());
        assertEquals(1, results.get(1));
        assertEquals(2, ((List<?>) results.get(2)).size());
        assertEquals("users", ((TableInfo) results.get(3)).name());
        assertEquals(3L, ((GraphResult) results.get(4)).get("n"));
        assertEquals(3L, client.graph("{ n: count(\"orders\") }").get("n"));
        assertEquals(QueryResult.ROWS, ((QueryResult) results.get(5)).type());
        assertEquals("OK: 1 row inserted", results.get(6));
        assertEquals("0.2.0", ((ServerInfo) results.get(7)).version());
        assertEquals(1L, results.get(8));

        assertEquals(1, client.async().execute("DELETE FROM t").get(10, TimeUnit.SECONDS));
        assertEquals("users", client.async().describe("users").get(10, TimeUnit.SECONDS).name());
        assertNotNull(client.async().queryGraph("{ n: count(\"t\") }").get(10, TimeUnit.SECONDS).data());
    }
}
