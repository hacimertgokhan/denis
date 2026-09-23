package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisAuthException;
import github.hacimertgokhan.drivers.exceptions.DenisConnectionException;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import github.hacimertgokhan.drivers.exceptions.DenisSqlException;
import github.hacimertgokhan.drivers.exceptions.DenisTimeoutException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.io.IOException;
import java.net.ServerSocket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

@Timeout(value = 60, unit = TimeUnit.SECONDS)
class DenisClientTest {
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

    private DenisClient authed(int poolSize) {
        return client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x").poolSize(poolSize));
    }

    private static void eventually(String what, BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > deadline) {
                fail("timed out waiting for: " + what);
            }
            Thread.sleep(10);
        }
    }

    private static DenisException failure(CompletableFuture<?> f) {
        ExecutionException e = assertThrows(ExecutionException.class, () -> f.get(10, TimeUnit.SECONDS));
        return assertInstanceOf(DenisException.class, e.getCause());
    }

    // =================================================================== handshake and framing

    @Test
    void handshakeSwitchesToJsonLogsInAndSelectsTheProjectOnEveryConnection() {
        authed(3);
        assertEquals(3, server.connections.size());
        for (FakeServer.Conn c : server.connections) {
            assertEquals(List.of("MODE json", "LIN grp pass with spaces", "AUTH tok-x"), c.received);
        }
    }

    @Test
    void createProjectOnBuildCreatesOnceAndSelectsEverywhere() {
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).createProject(true).poolSize(2));
        assertEquals("tok-1", client.token());
        assertEquals(List.of("MODE json", "LIN grp pass with spaces", "AUTH CREATE", "AUTH tok-1"), server.connection(0).received);
        assertEquals(List.of("MODE json", "LIN grp pass with spaces", "AUTH tok-1"), server.connection(1).received);
    }

    @Test
    void wrongPasswordFailsTheBuildWithAuth() {
        DenisAuthException e = assertThrows(DenisAuthException.class,
                () -> client(server.builder().credentials(FakeServer.GROUP, "nope").poolSize(2)));
        assertEquals("AUTH", e.code());
        assertNotNull(e.reply());
        assertEquals(1, server.connections.size(), "the other connections are not attempted after a failed login");
    }

    @Test
    void connectionRefusedIsAConnectionError() throws IOException {
        int port;
        try (ServerSocket s = new ServerSocket(0)) {
            port = s.getLocalPort();
        }
        DenisConnectionException e = assertThrows(DenisConnectionException.class,
                () -> DenisClient.builder().port(port).connectTimeout(Duration.ofSeconds(2)).build());
        assertEquals(DenisException.CONNECTION, e.code());
    }

    @Test
    void textModeServerIsAProtocolError() {
        server.override = (c, line) -> "[Info - today]: mode json";
        DenisException e = assertThrows(DenisException.class, () -> client(server.builder()));
        assertEquals(DenisException.PROTOCOL, e.code());
    }

    @Test
    void crlfLargeAndUnicodeRepliesAreFramedCorrectly() throws Exception {
        String big = "x".repeat(3_000_000) + "çğüşöı ✓ 😀";
        server.override = (c, line) -> {
            try {
                if (line.equals("GET crlf")) {
                    c.send("{\"ok\":true,\"key\":\"crlf\",\"data\":\"a\"}\r\n");
                    return "";
                }
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
            if (line.equals("GET big")) {
                return "{\"ok\":true,\"key\":\"big\",\"data\":" + Json.quote(big) + "}";
            }
            return null;
        };
        DenisClient client = authed(1);
        assertEquals("a", client.get("crlf"));
        assertEquals(big, client.get("big"));
        assertTrue(client.ping());
    }

    @Test
    void repliesSplitAtEveryByteBoundaryAreReassembled() throws Exception {
        String reply = "{\"ok\":true,\"key\":\"k\",\"data\":\"ç✓😀 end\"}\r\n";
        byte[] bytes = reply.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        server.override = (c, line) -> {
            if (!line.equals("GET k")) {
                return null;
            }
            try {
                for (byte b : bytes) {
                    c.socket.getOutputStream().write(b);
                    c.socket.getOutputStream().flush();
                }
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
            return "";
        };
        DenisClient client = authed(1);
        for (int i = 0; i < 3; i++) {
            assertEquals("ç✓😀 end", client.get("k"));
        }
    }

    // =================================================================== commands

    @Test
    void keyValueCommandsSendTheRightLinesAndDecodeReplies() {
        DenisClient client = authed(1);
        client.set("k", "hello world");
        client.set("p", "v", SetOptions.persist().ttl(Duration.ofMillis(1500)));
        client.set("t", "v", Duration.ofSeconds(30));
        client.set("legacy", "v", true);
        assertEquals("hello world", client.get("k"));
        assertNull(client.get("missing"));
        assertEquals(Optional.empty(), client.find("missing"));
        assertEquals(Optional.of("hello world"), client.find("k"));
        assertTrue(client.exists("k"));
        assertFalse(client.exists("missing"));
        Map<String, String> m = client.mget("k", "missing", "p");
        assertEquals(List.of("k", "missing", "p"), new ArrayList<>(m.keySet()));
        assertEquals("hello world", m.get("k"));
        assertNull(m.get("missing"));
        assertEquals(1, client.incr("n"));
        assertEquals(6, client.incrBy("n", 5));
        assertEquals(5, client.decr("n"));
        assertEquals(2, client.decrBy("n", 3));
        assertEquals(12, client.incrBy("n", 10, true));
        assertTrue(client.expire("k", Duration.ofSeconds(10)));
        assertEquals(10, client.ttl("k"));
        assertEquals(10_000, client.pttl("k"));
        assertTrue(client.persist("k"));
        assertEquals(-1, client.ttl("k"));
        assertEquals(-2, client.ttl("missing"));
        assertTrue(client.del("k"));
        assertFalse(client.del("k", DelOptions.cacheOnly()));
        assertFalse(client.delete("k"));
        client.update("u", "new value");
        assertEquals(List.of("legacy", "n", "p", "t", "u"), client.keys());
        client.keys("user:*", KeysOptions.cacheOnly().limit(10));
        assertEquals(new DbSize(5, 5, 0, 0), client.dbsize());
        client.clear();
        assertEquals(0, client.dbsize().keys());

        List<String> sent = server.connection(0).received;
        assertTrue(sent.contains("SET k hello world"));
        assertTrue(sent.contains("SET p v -&save -&ttl=1.5"));
        assertTrue(sent.contains("SET t v -&ttl=30"));
        assertTrue(sent.contains("SET legacy v -&save"));
        assertTrue(sent.contains("MGET k missing p"));
        assertTrue(sent.contains("INCR n"));
        assertTrue(sent.contains("INCR n 5"));
        assertTrue(sent.contains("DECR n"));
        assertTrue(sent.contains("DECR n 3"));
        assertTrue(sent.contains("INCR n 10 -&save"));
        assertTrue(sent.contains("EXPIRE k 10"));
        assertTrue(sent.contains("DEL k -&cache"));
        assertTrue(sent.contains("KEYS user:* -&cache -&limit=10"));
        assertTrue(sent.contains("HEAVEN"));
    }

    @Test
    void adminAndInfoCommandsDecode() {
        DenisClient client = authed(1);
        ServerHello hello = client.hello();
        assertEquals(2, hello.protocol());
        assertTrue(hello.hasFeature("sql-params"));
        assertEquals("grp", client.whoami().get("group"));
        assertEquals("tok-x", client.whoami().get("project"));
        assertEquals(Map.of("version", "0.2.0"), client.info().details().get("server"));
        List<Project> projects = client.projects();
        assertEquals(2, projects.size());
        assertEquals("tok-1", projects.get(0).token());
        assertTrue(projects.get(0).current());
        assertNull(projects.get(1).owner());
        assertEquals(10, client.save().bytes());
        BackupInfo b = client.backup();
        assertEquals("b1.zip", b.name());
        assertEquals(99, b.bytes());
        assertNotNull(b.createdAtInstant());
        assertEquals(1, client.backups().size());
        assertFalse(client.command("PING").containsKey("ok"));
        assertEquals("PONG", client.command("  PING  ").get("message"));
    }

    @Test
    void queryBindsParametersAsJsonAndDecodesResults() {
        DenisClient client = authed(1);
        QueryResult r = client.query("SELECT * FROM t WHERE a = ? AND b = ?\nAND c = ?", 1, "it's \"quoted\"", null, true, 2.5, 7L,
                java.util.UUID.fromString("00000000-0000-0000-0000-000000000001"));
        assertTrue(r.isResultSet());
        assertEquals(List.of("sql", "params"), r.columns());
        assertEquals(1, r.size());
        assertEquals("SELECT * FROM t WHERE a = ? AND b = ?\nAND c = ?", r.getString(0, "sql"));
        assertEquals("[1,\"it's \\\"quoted\\\"\",null,true,2.5,7,\"00000000-0000-0000-0000-000000000001\"]", r.getString(0, "PARAMS"));
        assertEquals(List.of(Map.of("sql", r.get(0, 0), "params", r.get(0, 1))), r.toMaps());
        String sent = server.connection(0).received.get(3);
        assertTrue(sent.startsWith("QUERY {\"sql\":\"SELECT * FROM t WHERE a = ? AND b = ?\\nAND c = ?\",\"params\":[1,"), sent);

        QueryResult change = client.query("INSERT INTO t VALUES (?)", List.of(1));
        assertFalse(change.isResultSet());
        assertEquals(1, change.affected());
        assertEquals(7L, change.lastRowId());
        assertEquals("OK: 1 row inserted", change.data());
        assertEquals("OK: 1 row inserted", client.sqlText("INSERT INTO t VALUES (1)"));

        DenisSqlException e = assertThrows(DenisSqlException.class, () -> client.query("BAD SQL"));
        assertEquals("SQL", e.code());
        assertEquals("ERROR: Table not found: t", e.data());
        assertThrows(DenisException.class, () -> client.query("SELECT ?", new Object()));
    }

    @Test
    void serverErrorCodesBecomeTypedExceptions() {
        server.override = (c, line) -> {
            switch (line) {
                case "GET busy":
                    return FakeServer.error("BUSY", "server is busy, try again");
                case "GET oom":
                    return FakeServer.error("OOM", "max-memory reached");
                case "GET forbidden":
                    return FakeServer.error("FORBIDDEN", "admin only");
                case "GET nocode":
                    return "{\"ok\":false,\"error\":\"strange\"}";
                case "GET oddreply":
                    return "{\"ok\":true,\"data\":42}";
                default:
                    return null;
            }
        };
        DenisClient client = authed(1);
        DenisException busy = assertThrows(DenisException.class, () -> client.get("busy"));
        assertEquals("BUSY", busy.code());
        assertTrue(busy.isRetryable());
        assertTrue(busy.isServerError());
        assertEquals("server is busy, try again", busy.reply().get("error"));
        assertEquals("OOM", assertThrows(DenisException.class, () -> client.get("oom")).code());
        assertInstanceOf(DenisAuthException.class, assertThrows(DenisException.class, () -> client.get("forbidden")));
        assertEquals(DenisException.ERROR, assertThrows(DenisException.class, () -> client.get("nocode")).code());
        assertEquals(DenisException.PROTOCOL, assertThrows(DenisException.class, () -> client.get("oddreply")).code());
        assertTrue(client.ping(), "the connection survives error replies");
        DenisException notFound = assertThrows(DenisException.class, () -> client.command("GET missing"));
        assertEquals("NOTFOUND", notFound.code());
        assertEquals("missing", notFound.reply().get("key"));
    }

    @Test
    void invalidArgumentsAreRejectedBeforeAnythingIsSent() {
        DenisClient client = authed(1);
        int before = server.connection(0).received.size();
        String[] badKeys = {null, "", "a b", "a\tb", "a\nb", "-&save", "a b"};
        for (String key : badKeys) {
            DenisException e = assertThrows(DenisException.class, () -> client.get(key), String.valueOf(key));
            assertEquals(DenisException.INVALID, e.code());
        }
        String[] badValues = {null, "a\nb", "a\rb", "-&save", "x -&ttl=1", " -&x", "end\n"};
        for (String value : badValues) {
            assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.set("k", value)).code());
        }
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.expire("k", Duration.ZERO)).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.mget()).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.command("")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.command("PING\nPING")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.command("MODE text")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.command("lin a b")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.command("AUTH tok")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.command("quit")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.login("g", "line\nbreak")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.login("g", "")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.query(" ")).code());
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.async().get("a b")).code());
        assertEquals(before, server.connection(0).received.size());
        // values may contain spaces, quotes, dashes and unicode
        client.set("k", "  leading spaces, \"quotes\", a-&b, -- and ✓");
        assertEquals("  leading spaces, \"quotes\", a-&b, -- and ✓", server.data.get("k"));
        // empty values and trailing whitespace are carried verbatim (protocol 2 only strips leading whitespace of a line)
        client.set("empty", "");
        client.set("trailing", "x \t");
        client.set("flagged", "y  ", SetOptions.persist());
        List<String> sent = server.connection(0).received;
        assertEquals(List.of("SET empty ", "SET trailing x \t", "SET flagged y   -&save"), sent.subList(sent.size() - 3, sent.size()));
    }

    @Test
    void builderRejectsBadSettings() {
        assertThrows(DenisException.class, () -> DenisClient.builder().port(0).build());
        assertThrows(DenisException.class, () -> DenisClient.builder().poolSize(0).build());
        assertThrows(DenisException.class, () -> DenisClient.builder().credentials("a b", "x").build());
        assertThrows(DenisException.class, () -> DenisClient.builder().token("tok").build());
        assertThrows(DenisException.class, () -> DenisClient.builder().commandTimeout(Duration.ofSeconds(-1)).build());
    }

    // =================================================================== pipelining and concurrency

    @Test
    void concurrentCallersGetTheirOwnRepliesInOrder() throws Exception {
        server.override = (c, line) -> line.startsWith("GET ") ? FakeServer.ok("\"data\":" + Json.quote("v:" + line.substring(4))) : null;
        DenisClient client = authed(2);
        int threads = 8;
        int perThread = 2000;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Future<?>> tasks = new ArrayList<>();
        for (int t = 0; t < threads; t++) {
            int id = t;
            tasks.add(pool.submit(() -> {
                List<CompletableFuture<String>> futures = new ArrayList<>();
                for (int i = 0; i < perThread; i++) {
                    futures.add(client.async().get("k" + id + "-" + i));
                    if (i % 100 == 0) {
                        assertEquals("v:s" + id + "-" + i, client.get("s" + id + "-" + i));
                    }
                }
                for (int i = 0; i < perThread; i++) {
                    assertEquals("v:k" + id + "-" + i, futures.get(i).join());
                }
                return null;
            }));
        }
        for (Future<?> f : tasks) {
            f.get();
        }
        pool.shutdown();
        long total = server.connection(0).received.size() + server.connection(1).received.size();
        assertEquals(threads * (perThread + perThread / 100) + 6, total);
        assertTrue(server.connection(0).received.size() > 100 && server.connection(1).received.size() > 100,
                "load is spread over both connections");
    }

    @Test
    void coalescedFlushesNeverStrandACommand() throws Exception {
        // command timeouts off: a command left unflushed in the write buffer would hang this test
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(2).commandTimeout(Duration.ZERO));
        ExecutorService pool = Executors.newFixedThreadPool(6);
        List<Future<?>> tasks = new ArrayList<>();
        for (int t = 0; t < 6; t++) {
            int id = t;
            tasks.add(pool.submit(() -> {
                java.util.Random random = new java.util.Random(id);
                for (int round = 0; round < 200; round++) {
                    List<CompletableFuture<Long>> burst = new ArrayList<>();
                    int size = 1 + random.nextInt(40);
                    for (int i = 0; i < size; i++) {
                        burst.add(client.async().incr("n" + id));
                    }
                    if (random.nextInt(4) == 0) {
                        client.ping(); // a blocking call in between
                    }
                    CompletableFuture.allOf(burst.toArray(new CompletableFuture<?>[0])).get(20, TimeUnit.SECONDS);
                    if (random.nextInt(8) == 0) {
                        Thread.sleep(1); // let every connection go idle
                    }
                }
                return null;
            }));
        }
        for (Future<?> f : tasks) {
            f.get(60, TimeUnit.SECONDS);
        }
        pool.shutdown();
    }

    @Test
    void pipelineSendsEverythingOnOneConnectionAndReturnsResultsInOrder() {
        DenisClient client = authed(2);
        Pipeline p = client.pipeline();
        p.set("a", "1");
        CompletableFuture<String> a = p.get("a");
        p.incr("counter");
        p.get("missing");
        p.query("BAD");
        p.exists("a");
        assertEquals(6, p.size());
        List<Object> results = p.execute();
        assertEquals(0, p.size());
        assertEquals(6, results.size());
        assertNull(results.get(0));
        assertEquals("1", results.get(1));
        assertEquals(1L, results.get(2));
        assertNull(results.get(3));
        assertInstanceOf(DenisSqlException.class, results.get(4));
        assertEquals(true, results.get(5));
        assertEquals("1", a.join());
        List<String> one = server.connection(0).received.size() > 3 ? server.connection(0).received : server.connection(1).received;
        assertEquals(List.of("SET a 1", "GET a", "INCR counter", "GET missing"), one.subList(3, 7));
        assertEquals(List.of(), client.pipeline().execute());
        Pipeline q = client.pipeline();
        q.set("b", "2");
        q.get("b");
        assertEquals(java.util.Arrays.asList(null, "2"), q.executeAsync().join());
    }

    @Test
    void leastPendingRoutingAvoidsASlowConnection() throws Exception {
        CountDownLatch slowStarted = new CountDownLatch(1);
        server.override = (c, line) -> {
            if (line.equals("GET slow")) {
                slowStarted.countDown();
                try {
                    Thread.sleep(1500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return FakeServer.ok("\"data\":\"slow\"");
            }
            return null;
        };
        DenisClient client = authed(2);
        CompletableFuture<String> slow = client.async().get("slow");
        assertTrue(slowStarted.await(5, TimeUnit.SECONDS));
        long start = System.nanoTime();
        for (int i = 0; i < 20; i++) {
            assertTrue(client.ping());
        }
        assertTrue(System.nanoTime() - start < TimeUnit.MILLISECONDS.toNanos(1000), "pings were not queued behind the slow command");
        assertEquals("slow", slow.get(5, TimeUnit.SECONDS));
    }

    // =================================================================== failures

    @Test
    void timeoutFailsTheCommandClosesTheConnectionAndFailsTheRestWithClosed() throws Exception {
        server.override = (c, line) -> line.equals("GET hang") ? c.hang() : null;
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(1).commandTimeout(Duration.ofMillis(300)).reconnectBackoff(Duration.ofMillis(20), Duration.ofMillis(200)));
        CompletableFuture<String> hanging = client.async().get("hang");
        CompletableFuture<String> behind = client.async().get("behind");
        long start = System.nanoTime();
        DenisException first = failure(hanging);
        assertInstanceOf(DenisTimeoutException.class, first);
        assertEquals(DenisException.TIMEOUT, first.code());
        DenisException second = failure(behind);
        assertInstanceOf(DenisConnectionException.class, second);
        assertEquals(DenisException.CLOSED, second.code());
        assertTrue(System.nanoTime() - start < TimeUnit.SECONDS.toNanos(3));

        // reconnected with the full handshake; the failed commands were not replayed
        eventually("reconnect", () -> server.connections.size() == 2 && client.isConnected());
        assertTrue(client.ping());
        assertEquals(List.of("MODE json", "LIN grp pass with spaces", "AUTH tok-x", "PING"), server.connection(1).received);
        assertEquals(1, server.allReceived().stream().filter(l -> l.equals("GET hang")).count());
    }

    @Test
    void synchronousCallsTimeOut() {
        server.override = (c, line) -> line.equals("GET hang") ? c.hang() : null;
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(1).commandTimeout(Duration.ofMillis(200)));
        long start = System.nanoTime();
        DenisTimeoutException e = assertThrows(DenisTimeoutException.class, () -> client.get("hang"));
        assertEquals(DenisException.TIMEOUT, e.code());
        assertTrue(System.nanoTime() - start < TimeUnit.SECONDS.toNanos(2));
    }

    @Test
    void droppedConnectionFailsInFlightCommandsWithClosedAndNeverReplaysThem() throws Exception {
        CountDownLatch received = new CountDownLatch(1);
        server.override = (c, line) -> {
            if (line.equals("SET boom 1")) {
                received.countDown();
                c.close();
                return "";
            }
            return null;
        };
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(1).reconnectBackoff(Duration.ofMillis(20), Duration.ofMillis(200)));
        CompletableFuture<Void> boom = client.async().set("boom", "1");
        CompletableFuture<Long> after = client.async().incr("after");
        assertEquals(DenisException.CLOSED, failure(boom).code());
        assertEquals(DenisException.CLOSED, failure(after).code());
        eventually("reconnect", client::isConnected);
        assertEquals(1, client.incr("other"));
        assertEquals(1, server.allReceived().stream().filter(l -> l.equals("SET boom 1")).count());
        assertEquals(List.of("MODE json", "LIN grp pass with spaces", "AUTH tok-x", "INCR other"), server.connection(1).received);
    }

    @Test
    void commandsIssuedWhileDisconnectedWaitForTheReconnect() throws Exception {
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(1).commandTimeout(Duration.ofSeconds(5)).reconnectBackoff(Duration.ofMillis(20), Duration.ofMillis(100)));
        server.refuse = true;
        server.connection(0).close();
        eventually("disconnect", () -> !client.isConnected());
        CompletableFuture<Boolean> ping = client.async().ping();
        Thread.sleep(300);
        assertFalse(ping.isDone());
        server.refuse = false;
        assertTrue(ping.get(5, TimeUnit.SECONDS));
    }

    @Test
    void commandsFailFastWhenReconnectIsOff() throws Exception {
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(1).reconnect(false));
        server.connection(0).close();
        eventually("disconnect", () -> !client.isConnected());
        DenisConnectionException e = assertThrows(DenisConnectionException.class, client::ping);
        assertEquals(DenisException.CONNECTION, e.code());
        Thread.sleep(200);
        assertEquals(1, server.connections.size(), "no reconnect attempts");
    }

    @Test
    void reconnectReplaysTheLatestSession() throws Exception {
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(2).reconnectBackoff(Duration.ofMillis(20), Duration.ofMillis(100)));
        client.use("tok-2");
        assertEquals("AUTH tok-2", server.connection(0).received.get(3));
        assertEquals("AUTH tok-2", server.connection(1).received.get(3));
        server.connection(0).close();
        server.connection(1).close();
        eventually("both reconnected", () -> server.connections.size() == 4 && client.isConnected());
        eventually("handshakes", () -> server.connection(2).received.size() == 3 && server.connection(3).received.size() == 3);
        assertEquals(List.of("MODE json", "LIN grp pass with spaces", "AUTH tok-2"), server.connection(2).received);
        assertEquals(List.of("MODE json", "LIN grp pass with spaces", "AUTH tok-2"), server.connection(3).received);
        assertEquals("tok-2", client.token());
    }

    @Test
    void malformedReplyFailsWithProtocolAndReconnects() throws Exception {
        server.override = (c, line) -> line.equals("GET garbage") ? "this is not json" : null;
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(1).reconnectBackoff(Duration.ofMillis(20), Duration.ofMillis(100)));
        DenisException e = assertThrows(DenisException.class, () -> client.get("garbage"));
        assertEquals(DenisException.PROTOCOL, e.code());
        eventually("reconnect", client::isConnected);
        assertTrue(client.ping());
    }

    @Test
    void unsolicitedReplyClosesTheConnection() throws Exception {
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(1).reconnect(false));
        server.connection(0).send("{\"ok\":true,\"surprise\":1}\n");
        eventually("closed", () -> !client.isConnected());
    }

    @Test
    void blockingInsideACallbackOnTheReaderThreadIsRejected() throws Exception {
        DenisClient client = authed(1);
        AtomicReference<Throwable> error = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        CompletableFuture<Void> slowReply = new CompletableFuture<>();
        server.override = (c, line) -> {
            if (line.equals("GET first")) {
                slowReply.join();
                return FakeServer.ok("\"data\":\"1\"");
            }
            return null;
        };
        client.async().get("first").whenComplete((v, t) -> {
            try {
                client.get("second");
            } catch (Throwable x) {
                error.set(x);
            }
            done.countDown();
        });
        slowReply.complete(null);
        assertTrue(done.await(5, TimeUnit.SECONDS));
        assertEquals(DenisException.INVALID, ((DenisException) error.get()).code());
    }

    // =================================================================== session management

    @Test
    void loginUseAndCreateProjectApplyToEveryConnection() {
        DenisClient client = client(server.builder().poolSize(2));
        assertThrows(DenisAuthException.class, () -> client.get("k"));
        assertThrows(DenisAuthException.class, () -> client.login(FakeServer.GROUP, "wrong"));
        client.login(FakeServer.GROUP, FakeServer.PASSWORD);
        String token = client.createProject();
        assertEquals(token, client.token());
        client.set("k", "v");
        assertEquals("v", client.get("k"));
        for (FakeServer.Conn c : server.connections) {
            assertTrue(c.received.contains("LIN grp pass with spaces"));
            assertTrue(c.received.contains("AUTH " + token));
        }
        DenisAuthException bad = assertThrows(DenisAuthException.class, () -> client.use("bad-token"));
        assertEquals("AUTH", bad.code());
        assertEquals(token, client.token(), "a failed use() keeps the previous project");
        String second = client.createProject(false);
        assertEquals(token, client.token());
        client.async().use(second).join();
        assertEquals(second, client.token());
    }

    @Test
    void deletingTheSelectedProjectReopensConnectionsWithoutIt() {
        DenisClient client = authed(2);
        client.deleteProject("tok-x");
        assertNull(client.token());
        DenisAuthException e = assertThrows(DenisAuthException.class, () -> client.get("k"));
        assertEquals("NOPROJECT", e.code());
        assertEquals(4, server.connections.size());
        assertEquals(List.of("MODE json", "LIN grp pass with spaces"), server.connection(2).received.subList(0, 2));
    }

    @Test
    void legacyApiStillWorks() {
        DenisClient client = new DenisClient("127.0.0.1", server.port());
        clients.add(client);
        assertFalse(client.isConnected());
        client.connect();
        assertTrue(client.isConnected());
        client.login(FakeServer.GROUP, FakeServer.PASSWORD);
        String token = client.createProject();
        assertEquals(token, client.getToken());
        client.authenticate(token);
        client.set("user:1", "{\"id\":1}", true);
        assertEquals("{\"id\":1}", client.get("user:1"));
        client.update("user:1", "x");
        assertTrue(client.delete("user:1"));
        assertEquals("OK: 1 row inserted", client.sqlText("INSERT INTO t VALUES (1)"));
        // the 1.2 API (master line): the same names, typed results instead of org.json
        client.set("user:2", "v", true);
        assertTrue(client.exists("user:2"));
        assertEquals(List.of("user:2"), client.keys("user:*"));
        assertEquals("v", client.mget(List.of("user:2", "nope")).get("user:2"));
        assertEquals("affected", client.sql("INSERT INTO t VALUES (1)").asMap().get("type"));
        assertEquals("rows", client.sql("SELECT * FROM t").type());
        assertEquals("SELECT * FROM t", client.query("SELECT * FROM t").toMaps().get(0).get("sql"));
        assertEquals(1, client.execute("INSERT INTO t (id, name) VALUES (1, 'Ada')"));
        assertEquals("users", client.tables().get(0).name());
        assertTrue(client.info().has("version"));
        client.save();
        client.clear();
        assertTrue(client.ping());
        client.close();
        assertFalse(client.isConnected());
        assertEquals(1, server.connections.size());
    }

    // =================================================================== dump / import

    @Test
    void dumpStripsOkAndImportSplitsLargeDumps() {
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(1).importChunkBytes(1024));
        client.set("a", "1");
        String dump = client.dump();
        Map<String, Object> parsed = Json.parseObject(dump);
        assertFalse(parsed.containsKey("ok"));
        assertEquals(Map.of("a", "1"), parsed.get("cache"));

        Map<String, Object> cache = new LinkedHashMap<>();
        Map<String, Object> ttl = new LinkedHashMap<>();
        Map<String, Object> persistent = new LinkedHashMap<>();
        for (int i = 0; i < 200; i++) {
            cache.put("key:" + i, "value number " + i);
            persistent.put("p:" + i, "durable " + i);
            if (i % 3 == 0) {
                ttl.put("key:" + i, 60_000L + i);
            }
        }
        Map<String, Object> big = new LinkedHashMap<>();
        big.put("ok", true);
        big.put("format", 1);
        big.put("cache", cache);
        big.put("persistent", persistent);
        big.put("ttl", ttl);
        big.put("tables", Map.of("users", Map.of("columns", List.of(), "rows", List.of()), "orders", Map.of("columns", List.of())));
        int before = server.connection(0).received.size();
        ImportResult result = client.importDump(Json.write(big), true);
        assertEquals(200, result.cache());
        assertEquals(200, result.persistent());
        assertEquals(2, result.tables());
        List<String> lines = server.connection(0).received.subList(before, server.connection(0).received.size());
        assertTrue(lines.size() > 5, "split into several IMPORT lines: " + lines.size());
        for (String line : lines) {
            assertTrue(line.startsWith("IMPORT {"));
            assertTrue(line.length() < 1400, "line too long: " + line.length());
            Map<String, Object> chunk = Json.parseObject(line.substring(7));
            assertEquals(true, chunk.get("replace"));
            assertFalse(chunk.containsKey("ok"));
            if (chunk.get("ttl") instanceof Map) {
                for (Object k : ((Map<?, ?>) chunk.get("ttl")).keySet()) {
                    assertTrue(((Map<?, ?>) chunk.get("cache")).containsKey(k), "ttl travels with its cache value");
                }
            }
        }
        assertEquals(DenisException.INVALID, assertThrows(DenisException.class, () -> client.importDump("not json", false)).code());
    }

    @Test
    void bigTablesAreCreatedThenAppendedInOrderAndImportStopsAtTheFirstFailure() {
        DenisClient client = client(server.builder().credentials(FakeServer.GROUP, FakeServer.PASSWORD).token("tok-x")
                .poolSize(3).importChunkBytes(2048));
        List<Object> rows = new ArrayList<>();
        for (int i = 0; i < 300; i++) {
            rows.add(List.of(i, "row number " + i));
        }
        Map<String, Object> table = new LinkedHashMap<>();
        table.put("columns", List.of(Map.of("name", "id", "type", "INTEGER"), Map.of("name", "name", "type", "TEXT")));
        table.put("indexes", List.of(Map.of("name", "idx", "column", "name", "unique", false)));
        table.put("rows", rows);
        String dump = Json.write(Map.of("format", 1, "tables", Map.of("big", table)));

        ImportResult result = client.importDump(dump, false);
        assertEquals(300, result.rows());
        List<String> lines = new ArrayList<>();
        for (String line : server.arrivals) {
            if (line.startsWith("IMPORT ")) {
                lines.add(line);
            }
        }
        assertTrue(lines.size() > 3, "table split over several lines");
        List<Object> seen = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            assertTrue(lines.get(i).length() < 2300, "line " + i + " is " + lines.get(i).length() + " bytes");
            Map<String, Object> chunk = Json.parseObject(lines.get(i).substring(7));
            Map<?, ?> def = (Map<?, ?>) ((Map<?, ?>) chunk.get("tables")).get("big");
            assertEquals(i > 0, Boolean.TRUE.equals(chunk.get("append")), "only follow-up lines append");
            assertEquals(i == 0, def.containsKey("indexes"), "indexes are created with the table");
            assertTrue(def.containsKey("columns"));
            seen.addAll((List<?>) def.get("rows"));
        }
        assertEquals(Json.parse(Json.write(rows)), seen, "all rows, in order");

        // the first line fails: nothing else may be sent (appending to someone else's table would be wrong)
        server.override = (c, line) -> line.startsWith("IMPORT ") ? FakeServer.error("SQL", "Table already exists: big") : null;
        int before = server.allReceived().size();
        DenisSqlException e = assertThrows(DenisSqlException.class, () -> client.importDump(dump, false));
        assertEquals("SQL", e.code());
        assertEquals(1, server.allReceived().size() - before);
    }

    // =================================================================== shutdown

    @Test
    void closeLetsInFlightCommandsFinishThenRejectsNewOnes() throws Exception {
        server.override = (c, line) -> {
            if (line.equals("GET slowish")) {
                try {
                    Thread.sleep(300);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return FakeServer.ok("\"data\":\"done\"");
            }
            return null;
        };
        DenisClient client = authed(2);
        CompletableFuture<String> slow = client.async().get("slowish");
        client.close();
        assertEquals("done", slow.getNow("not finished"));
        DenisConnectionException e = assertThrows(DenisConnectionException.class, client::ping);
        assertEquals(DenisException.CLOSED, e.code());
        assertEquals(DenisException.CLOSED, failure(client.async().get("x")).code());
        client.close(); // idempotent
    }

    @Test
    void allDriverThreadsAreDaemonsAndStopAfterClose() throws Exception {
        DenisClient client = authed(3);
        client.async().ping().join();
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (t.getName().startsWith("denis-")) {
                assertTrue(t.isDaemon(), t.getName() + " must be a daemon thread");
            }
        }
        client.close();
        eventually("driver threads stop", () -> Thread.getAllStackTraces().keySet().stream()
                .noneMatch(t -> t.isAlive() && (t.getName().startsWith("denis-reader") || t.getName().startsWith("denis-timer"))));
    }
}
