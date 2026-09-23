package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisAuthException;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import github.hacimertgokhan.drivers.exceptions.DenisSqlException;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Runs against a live server. The group must be an admin group (the bootstrap group is).
 * <pre>
 *   DENIS_INTEGRATION=1 DENIS_PORT=5142 DENIS_GROUP=ci DENIS_PASSWORD=ci-password mvn test
 * </pre>
 */
@EnabledIfEnvironmentVariable(named = "DENIS_INTEGRATION", matches = "1")
@Timeout(value = 120, unit = TimeUnit.SECONDS)
class DenisClientIntegrationTest {
    static final String HOST = env("DENIS_HOST", "127.0.0.1");
    static final int PORT = Integer.parseInt(env("DENIS_PORT", "5142"));
    static final String GROUP = env("DENIS_GROUP", "ci");
    static final String PASSWORD = env("DENIS_PASSWORD", "ci-password");

    private static DenisClient client;

    static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    static DenisClient.Builder builder() {
        return DenisClient.builder().host(HOST).port(PORT).credentials(GROUP, PASSWORD);
    }

    @BeforeAll
    static void connect() {
        client = builder().createProject(true).poolSize(3).build();
    }

    @AfterAll
    static void cleanup() {
        if (client != null) {
            try {
                client.deleteProject(client.token());
            } finally {
                client.close();
            }
        }
    }

    @Test
    void helloPingAndWhoami() {
        assertTrue(client.ping());
        ServerHello hello = client.hello();
        assertEquals("denis", hello.server());
        assertEquals(2, hello.protocol());
        assertTrue(hello.hasFeature("sql-params"));
        Map<String, Object> who = client.whoami();
        assertEquals(GROUP, who.get("group"));
        assertEquals(client.token(), who.get("project"));
        assertEquals(128, client.token().length());
        assertTrue(client.info().containsKey("server"));
        assertFalse(client.help().isEmpty());
    }

    @Test
    void keyValueRoundTrips() {
        String value = "say \"hi\" — çğüşöı ✓ 😀 with  spaces, a-&b and {\"json\":[1,2]}";
        client.set("kv:greeting", value);
        assertEquals(value, client.get("kv:greeting"));
        assertEquals(Optional.of(value), client.find("kv:greeting"));
        assertNull(client.get("kv:missing"));
        assertEquals(Optional.empty(), client.find("kv:missing"));
        assertTrue(client.exists("kv:greeting"));
        assertFalse(client.exists("kv:missing"));

        client.update("kv:greeting", "changed");
        assertEquals("changed", client.get("kv:greeting"));

        client.set("kv:durable", "on disk", SetOptions.persist());
        assertEquals("on disk", client.getPersistent("kv:durable"));
        assertTrue(client.del("kv:durable", DelOptions.cacheOnly()));
        assertEquals("on disk", client.get("kv:durable"), "the durable value survives a cache-only delete");
        assertTrue(client.del("kv:durable"));
        assertFalse(client.del("kv:durable"));
        assertTrue(client.del("kv:greeting"));
        assertNull(client.get("kv:greeting"));
    }

    @Test
    void mgetKeysAndCounters() {
        client.set("mk:a", "1");
        client.set("mk:b", "2");
        Map<String, String> m = client.mget("mk:b", "mk:none", "mk:a");
        assertEquals(List.of("mk:b", "mk:none", "mk:a"), new ArrayList<>(m.keySet()));
        assertEquals("2", m.get("mk:b"));
        assertNull(m.get("mk:none"));
        assertTrue(client.keys("mk:*").containsAll(List.of("mk:a", "mk:b")));
        assertEquals(1, client.keys("mk:*", KeysOptions.withLimit(1)).size());

        assertEquals(1, client.incr("mk:counter"));
        assertEquals(6, client.incrBy("mk:counter", 5));
        assertEquals(5, client.decr("mk:counter"));
        assertEquals(-5, client.decrBy("mk:counter", 10));
        assertEquals("-5", client.get("mk:counter"));
        client.set("mk:text", "abc");
        assertEquals("TYPE", assertThrows(DenisException.class, () -> client.incr("mk:text")).code());
    }

    @Test
    void ttlExpireAndPersist() throws InterruptedException {
        client.set("ttl:a", "v", Duration.ofSeconds(30));
        long ttl = client.ttl("ttl:a");
        assertTrue(ttl > 0 && ttl <= 30, "ttl " + ttl);
        assertTrue(client.pttl("ttl:a") > 0);
        assertTrue(client.persist("ttl:a"));
        assertEquals(-1, client.ttl("ttl:a"));
        assertEquals(-2, client.ttl("ttl:none"));
        assertTrue(client.expire("ttl:a", Duration.ofMillis(200)));
        Thread.sleep(400);
        assertNull(client.get("ttl:a"));
        client.set("ttl:b", "v", SetOptions.cache().ttl(Duration.ofMillis(1500)));
        assertTrue(client.pttl("ttl:b") <= 1500);
    }

    @Test
    void sqlWithParameters() {
        client.sql("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, score REAL)");
        QueryResult insert = client.query("INSERT INTO users (id, name, age, score) VALUES (?, ?, ?, ?)", 1, "Ada", 36, 9.5);
        assertEquals(1, insert.affected());
        assertFalse(insert.isResultSet());
        client.query("INSERT INTO users (id, name, age, score) VALUES (?, ?, ?, ?)", 2, "Bob'); DROP TABLE users; --", 25, null);
        client.query("INSERT INTO users (id, name, age, score) VALUES (?, ?, ?, ?)", List.of(3, "Çağla ✓", 41, 7.25));

        QueryResult r = client.query("SELECT id, name, age, score FROM users WHERE age > ? ORDER BY id", 30);
        assertTrue(r.isResultSet());
        assertEquals(List.of("id", "name", "age", "score"), r.columns());
        assertEquals(2, r.size());
        assertEquals(1L, r.getLong(0, "id"));
        assertEquals("Ada", r.getString(0, "name"));
        assertEquals(9.5, r.getDouble(0, "score"));
        assertEquals("Çağla ✓", r.toMaps().get(1).get("name"));

        QueryResult injection = client.query("SELECT name, score FROM users WHERE id = ?", 2);
        assertEquals("Bob'); DROP TABLE users; --", injection.getString(0, "name"));
        assertNull(injection.getDouble(0, "score"));

        String legacy = client.sql("SELECT name FROM users\nWHERE id = 1");
        assertTrue(legacy.contains("Ada"), legacy);

        DenisSqlException e = assertThrows(DenisSqlException.class, () -> client.query("SELECT * FROM nope"));
        assertEquals("SQL", e.code());
        assertTrue(e.data().startsWith("ERROR:"));
        client.sql("DROP TABLE users");
    }

    @Test
    void asyncAndPipeline() throws Exception {
        List<CompletableFuture<Void>> writes = new ArrayList<>();
        for (int i = 0; i < 500; i++) {
            writes.add(client.async().set("async:" + i, "value " + i));
        }
        CompletableFuture.allOf(writes.toArray(new CompletableFuture<?>[0])).get(30, TimeUnit.SECONDS);
        assertEquals("value 499", client.async().get("async:499").get(10, TimeUnit.SECONDS));

        Pipeline p = client.pipeline();
        for (int i = 0; i < 1000; i++) {
            p.set("pipe:" + i, Integer.toString(i));
        }
        CompletableFuture<String> last = p.get("pipe:999");
        p.incr("pipe:counter");
        p.get("pipe:none");
        p.query("SELECT * FROM does_not_exist");
        List<Object> results = p.execute();
        assertEquals(1004, results.size());
        assertNull(results.get(0));
        assertEquals("999", results.get(1000));
        assertEquals(1L, results.get(1001));
        assertNull(results.get(1002));
        assertInstanceOf(DenisSqlException.class, results.get(1003));
        assertEquals("999", last.get());
    }

    @Test
    void manyThreadsShareOneClient() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(8);
        List<Future<?>> tasks = new ArrayList<>();
        for (int t = 0; t < 8; t++) {
            int id = t;
            tasks.add(pool.submit(() -> {
                for (int i = 0; i < 300; i++) {
                    String key = "mt:" + id + ":" + i;
                    client.set(key, key);
                    assertEquals(key, client.get(key));
                    client.incr("mt:counter");
                }
                return null;
            }));
        }
        for (Future<?> f : tasks) {
            f.get(60, TimeUnit.SECONDS);
        }
        pool.shutdown();
        assertEquals("2400", client.get("mt:counter"));
    }

    @Test
    void dumpAndImportIntoAnotherProject() {
        try (DenisClient source = builder().createProject(true).poolSize(1).build()) {
            try {
                source.set("d:cache", "cached value", Duration.ofMinutes(5));
                source.set("d:durable", "durable value", SetOptions.persist());
                source.sql("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
                source.query("INSERT INTO items (id, name) VALUES (?, ?)", 1, "first");
                String dump = source.dump();
                assertFalse(dump.contains("\"ok\""));
                DbSize size = source.dbsize();
                assertEquals(2, size.keys());
                assertEquals(1, size.tables());

                try (DenisClient target = builder().createProject(true).poolSize(1).importChunkBytes(1024).build()) {
                    try {
                        ImportResult imported = target.importDump(dump, false);
                        assertEquals(1, imported.tables());
                        assertEquals(1, imported.rows());
                        assertEquals("cached value", target.get("d:cache"));
                        assertTrue(target.ttl("d:cache") > 0);
                        assertEquals("durable value", target.getPersistent("d:durable"));
                        assertEquals("first", target.query("SELECT name FROM items WHERE id = ?", 1).getString(0, "name"));
                        assertThrows(DenisSqlException.class, () -> target.importDump(dump, false), "table exists without replace");
                        assertEquals(1, target.importDump(dump, true).tables());
                    } finally {
                        target.deleteProject(target.token());
                    }
                }
            } finally {
                source.deleteProject(source.token());
            }
        }
    }

    @Test
    void projectsUseAndClear() {
        try (DenisClient other = builder().poolSize(2).build()) {
            String token = other.createProject();
            try {
                assertTrue(other.projects().stream().anyMatch(p -> p.token().equals(token) && p.current()));
                other.set("p:k", "v");
                other.clear();
                assertNull(other.get("p:k"));
                other.use(client.token());
                assertEquals(client.token(), other.whoami().get("project"));
            } finally {
                other.deleteProject(token);
            }
        }
    }

    @Test
    void adminCommands() {
        SaveInfo save = client.save();
        assertTrue(save.bytes() >= 0);
        BackupInfo backup = client.backup();
        assertNotNull(backup.name());
        assertTrue(backup.bytes() > 0);
        assertTrue(client.backups().stream().anyMatch(b -> b.name().equals(backup.name())));
    }

    @Test
    void rawCommands() {
        assertEquals("PONG", client.command("PING").get("message"));
        DenisException e = assertThrows(DenisException.class, () -> client.command("NOSUCHCOMMAND"));
        assertEquals("UNKNOWN", e.code());
        assertEquals(false, e.reply().get("ok"));
    }

    @Test
    void wrongPasswordFailsWithAuth() {
        DenisAuthException e = assertThrows(DenisAuthException.class,
                () -> DenisClient.builder().host(HOST).port(PORT).credentials(GROUP, "definitely-wrong").build());
        assertEquals("AUTH", e.code());
    }

    @Test
    void legacyApi() {
        try (DenisClient legacy = new DenisClient(HOST, PORT)) {
            legacy.connect();
            legacy.login(GROUP, PASSWORD);
            String token = legacy.createProject();
            try {
                legacy.set("shared", "persisted value", true);
                assertEquals("persisted value", legacy.get("shared"));
                assertTrue(legacy.sql("CREATE TABLE t (id INTEGER)").startsWith("OK"));
            } finally {
                legacy.deleteProject(token);
            }
        }
    }
}
