package github.hacimertgokhan.denis.sql;

import github.hacimertgokhan.denis.storage.Keyspace;
import github.hacimertgokhan.denis.storage.StorageConfig;
import github.hacimertgokhan.denis.storage.StorageEngine;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SqlEngineTest {
    @TempDir
    Path dir;

    private StorageEngine storage;
    private SqlEngine sql;
    private Keyspace ks;

    @BeforeEach
    void setUp() throws IOException {
        storage = new StorageEngine(StorageConfig.inMemory()).open();
        sql = new SqlEngine(storage, 10_000);
        ks = storage.keyspace("project-token");
    }

    @AfterEach
    void tearDown() {
        storage.close();
    }

    private SqlResult run(String statement, Object... params) {
        return sql.execute(ks, statement, params);
    }

    private List<List<Object>> rows(String statement, Object... params) {
        List<List<Object>> out = new ArrayList<>();
        for (Object[] row : run(statement, params).rows()) {
            out.add(Arrays.asList(row));
        }
        return out;
    }

    private Object scalar(String statement, Object... params) {
        return run(statement, params).rows().get(0)[0];
    }

    private void users() {
        run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INT, city TEXT)");
        run("INSERT INTO users (id, name, age, city) VALUES (1, 'Ada', 36, 'London'), (2, 'Grace', 45, 'NYC'),"
                + " (3, 'Linus', 28, 'Helsinki'), (4, 'Alan', 41, 'London'), (5, 'Hedy', NULL, 'Vienna')");
    }

    // ------------------------------------------------------------------ compatibility with 0.0.x

    @Test
    void legacyRepliesAreUnchanged() {
        assertEquals("OK: table created", run("CREATE TABLE users (id INT, name TEXT)").legacyText());
        assertEquals("OK: 1 row inserted", run("INSERT INTO users (id, name) VALUES (1, 'Ada')").legacyText());
        String result = run("SELECT id, name FROM users WHERE id = 1").legacyText();
        assertTrue(result.contains("\"id\":1"), result);
        assertTrue(result.contains("\"name\":\"Ada\""), result);
        assertEquals("OK: 1 row(s) updated", run("UPDATE users SET name = 'Grace' WHERE id = 1").legacyText());
        assertTrue(run("SELECT * FROM users WHERE id = 1").legacyText().contains("Grace"));
        assertEquals("OK: 1 row(s) deleted", run("DELETE FROM users WHERE id = 1").legacyText());
        assertEquals("[]", run("SELECT * FROM users WHERE id = 1").legacyText());
        assertEquals("OK: table dropped", run("SQL DROP TABLE users;").legacyText());
        SqlException e = assertThrows(SqlException.class, () -> run("SELECT * FROM users"));
        assertEquals("Table not found: users", e.getMessage());
    }

    @Test
    void doubleQuotedStringsStillWork() {
        run("CREATE TABLE t (a TEXT)");
        run("INSERT INTO t (a) VALUES (\"hello\")");
        assertEquals("hello", scalar("SELECT a FROM t"));
    }

    // ------------------------------------------------------------------ types and constraints

    @Test
    void valuesAreCoercedToColumnTypes() {
        run("CREATE TABLE m (i INT, r REAL, t TEXT, b BOOLEAN)");
        run("INSERT INTO m VALUES ('42', 1, 7, 'true')");
        assertEquals(List.of(List.of(42L, 1.0, "7", true)), rows("SELECT i, r, t, b FROM m"));
        assertThrows(SqlException.class, () -> run("INSERT INTO m (i) VALUES ('abc')"));
    }

    @Test
    void primaryKeyIsUniqueNotNullAndAutoAssigned() {
        run("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
        run("INSERT INTO t (v) VALUES ('a'), ('b')");
        run("INSERT INTO t (id, v) VALUES (10, 'c')");
        run("INSERT INTO t (v) VALUES ('d')");
        assertEquals(List.of(List.of(1L), List.of(2L), List.of(10L), List.of(11L)), rows("SELECT id FROM t ORDER BY id"));
        SqlException dup = assertThrows(SqlException.class, () -> run("INSERT INTO t (id, v) VALUES (2, 'x')"));
        assertTrue(dup.getMessage().startsWith("UNIQUE constraint failed"), dup.getMessage());
        // a failing multi-row insert changes nothing
        assertThrows(SqlException.class, () -> run("INSERT INTO t (id, v) VALUES (20, 'y'), (20, 'z')"));
        assertEquals(4L, scalar("SELECT COUNT(*) FROM t"));
    }

    @Test
    void notNullAndDefaults() {
        run("CREATE TABLE t (a TEXT NOT NULL, b INT DEFAULT 7, c TEXT DEFAULT 'x')");
        run("INSERT INTO t (a) VALUES ('v')");
        assertEquals(List.of(List.of("v", 7L, "x")), rows("SELECT * FROM t"));
        SqlException e = assertThrows(SqlException.class, () -> run("INSERT INTO t (b) VALUES (1)"));
        assertTrue(e.getMessage().startsWith("NOT NULL constraint failed: a"), e.getMessage());
    }

    @Test
    void upsertReplacesTheConflictingRow() {
        run("CREATE TABLE kv (k TEXT PRIMARY KEY, v INT)");
        run("INSERT INTO kv VALUES ('a', 1)");
        run("UPSERT INTO kv VALUES ('a', 2)");
        run("REPLACE INTO kv VALUES ('b', 3)");
        assertEquals(List.of(List.of("a", 2L), List.of("b", 3L)), rows("SELECT k, v FROM kv ORDER BY k"));
    }

    @Test
    void uniqueSwapInOneUpdateIsAllowed() {
        run("CREATE TABLE t (id INT PRIMARY KEY, pos INT UNIQUE)");
        run("INSERT INTO t VALUES (1, 1), (2, 2)");
        run("UPDATE t SET pos = 3 - pos");
        assertEquals(List.of(List.of(1L, 2L), List.of(2L, 1L)), rows("SELECT id, pos FROM t ORDER BY id"));
        assertThrows(SqlException.class, () -> run("UPDATE t SET pos = 5"));
    }

    // ------------------------------------------------------------------ queries

    @Test
    void whereOperatorsAndThreeValuedLogic() {
        users();
        assertEquals(3L, scalar("SELECT COUNT(*) FROM users WHERE age > 30"));
        assertEquals(1L, scalar("SELECT COUNT(*) FROM users WHERE age IS NULL"));
        assertEquals(2L, scalar("SELECT COUNT(*) FROM users WHERE city IN ('London') "));
        assertEquals(2L, scalar("SELECT COUNT(*) FROM users WHERE age BETWEEN 30 AND 42"));
        assertEquals(3L, scalar("SELECT COUNT(*) FROM users WHERE name LIKE 'a%' OR name LIKE '%y'"));
        assertEquals(3L, scalar("SELECT COUNT(*) FROM users WHERE NOT (age < 30) AND age IS NOT NULL"));
        // NULL never equals anything, not even with NOT
        assertEquals(0L, scalar("SELECT COUNT(*) FROM users WHERE age = NULL"));
        assertEquals(4L, scalar("SELECT COUNT(*) FROM users WHERE age != 1000"));
    }

    @Test
    void orderLimitOffsetDistinct() {
        users();
        assertEquals(List.of(List.of("Grace"), List.of("Alan")), rows("SELECT name FROM users ORDER BY age DESC LIMIT 2"));
        assertEquals(List.of(List.of("Alan")), rows("SELECT name FROM users ORDER BY age DESC LIMIT 1 OFFSET 1"));
        assertEquals(List.of(List.of("Alan")), rows("SELECT name FROM users ORDER BY age DESC LIMIT 1, 1"));
        assertEquals(List.of(List.of("Helsinki"), List.of("London"), List.of("NYC"), List.of("Vienna")),
                rows("SELECT DISTINCT city FROM users ORDER BY city"));
        assertEquals(List.of(List.of("Hedy"), List.of("Linus")), rows("SELECT name FROM users ORDER BY age LIMIT 2"),
                "NULL sorts first ascending");
        assertEquals(List.of(List.of("Ada", 36L)), rows("SELECT name, age AS years FROM users ORDER BY years LIMIT 1 OFFSET 2"));
    }

    @Test
    void groupByHavingAndAggregates() {
        users();
        assertEquals(List.of(List.of("London", 2L, 38.5, 36L, 41L)),
                rows("SELECT city, COUNT(*) AS n, AVG(age), MIN(age), MAX(age) FROM users GROUP BY city HAVING n > 1"));
        assertEquals(150L, scalar("SELECT SUM(age) FROM users"));
        assertEquals(4L, scalar("SELECT COUNT(age) FROM users"));
        assertEquals(4L, scalar("SELECT COUNT(DISTINCT city) FROM users"));
        assertEquals(0L, scalar("SELECT COUNT(*) FROM users WHERE age > 1000"));
        assertNull(scalar("SELECT SUM(age) FROM users WHERE age > 1000"));
        assertEquals("Ada,Alan", scalar("SELECT GROUP_CONCAT(name) FROM users WHERE city = 'London'"));
        assertEquals(List.of(List.of("London", 2L), List.of("Helsinki", 1L)),
                rows("SELECT city, COUNT(*) FROM users GROUP BY city ORDER BY COUNT(*) DESC, city LIMIT 2"));
    }

    @Test
    void expressionsAndFunctions() {
        users();
        assertEquals("ADA", scalar("SELECT UPPER(name) FROM users WHERE id = 1"));
        assertEquals(37L, scalar("SELECT age + 1 FROM users WHERE id = 1"));
        assertEquals(3L, scalar("SELECT 7 / 2"));
        assertEquals(3.5, scalar("SELECT 7.0 / 2"));
        assertNull(scalar("SELECT 1 / 0"));
        assertEquals("Ada from London", scalar("SELECT name || ' from ' || city FROM users WHERE id = 1"));
        assertEquals("unknown", scalar("SELECT COALESCE(age, 'unknown') FROM users WHERE id = 5"));
        assertEquals("young", scalar("SELECT CASE WHEN age < 30 THEN 'young' ELSE 'other' END FROM users WHERE id = 3"));
        assertEquals(3.14, scalar("SELECT ROUND(3.14159, 2)"));
        assertEquals("ell", scalar("SELECT SUBSTR('hello', 2, 3)"));
        assertEquals(21.5, scalar("SELECT JSON_EXTRACT('{\"t\":{\"c\":21.5}}', '$.t.c')"));
        assertEquals(2L, scalar("SELECT JSON_EXTRACT('{\"a\":[1,2]}', '$.a[1]')"));
    }

    @Test
    void parametersAreBoundNotSpliced() {
        users();
        assertEquals("Ada", scalar("SELECT name FROM users WHERE city = ? AND age < ?", "London", 40L));
        // an injection attempt is just a strange string
        assertEquals(0L, scalar("SELECT COUNT(*) FROM users WHERE name = ?", "x' OR '1'='1"));
        run("INSERT INTO users (id, name) VALUES (?, ?)", 9L, "it's ok");
        assertEquals("it's ok", scalar("SELECT name FROM users WHERE id = ?", 9L));
        assertThrows(SqlException.class, () -> run("SELECT name FROM users WHERE id = ?"));
    }

    @Test
    void joins() {
        users();
        run("CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, total REAL)");
        run("INSERT INTO orders VALUES (1, 1, 10.0), (2, 1, 5.5), (3, 2, 7.25), (4, 99, 1.0)");
        assertEquals(List.of(List.of("Ada", 15.5), List.of("Grace", 7.25)),
                rows("SELECT u.name, SUM(o.total) FROM users u JOIN orders o ON o.user_id = u.id GROUP BY u.name ORDER BY u.name"));
        // Ada has two orders, Grace one, the other three none
        assertEquals(6L, scalar("SELECT COUNT(*) FROM users u LEFT JOIN orders o ON o.user_id = u.id"));
        assertEquals(List.of(List.of("Alan"), List.of("Hedy"), List.of("Linus")),
                rows("SELECT u.name FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE o.id IS NULL ORDER BY u.name"));
        assertEquals(20L, scalar("SELECT COUNT(*) FROM users CROSS JOIN orders"));
        // same result without an index on the join column (hash join)
        run("CREATE TABLE plain (user_id INT, tag TEXT)");
        run("INSERT INTO plain VALUES (1, 'x'), (1, 'y'), (3, 'z')");
        assertEquals(List.of(List.of("Ada", "x"), List.of("Ada", "y"), List.of("Linus", "z")),
                rows("SELECT u.name, p.tag FROM users u JOIN plain p ON p.user_id = u.id ORDER BY u.name, p.tag"));
        assertTrue(plan("SELECT * FROM users u JOIN plain p ON p.user_id = u.id").contains("HASH TABLE"));
        assertTrue(plan("SELECT * FROM plain p JOIN users u ON u.id = p.user_id").contains("USING INDEX pk_users_id"));
    }

    // ------------------------------------------------------------------ planning

    private String plan(String statement) {
        StringBuilder sb = new StringBuilder();
        for (Object[] row : run("EXPLAIN " + statement).rows()) {
            sb.append(row[0]).append('\n');
        }
        return sb.toString();
    }

    @Test
    void plannerUsesIndexes() {
        users();
        run("CREATE INDEX idx_city ON users (city)");
        run("CREATE INDEX idx_age ON users (age)");
        assertTrue(plan("SELECT * FROM users WHERE id = 3").contains("UNIQUE INDEX pk_users_id"));
        assertTrue(plan("SELECT * FROM users WHERE city = 'London'").contains("INDEX idx_city"));
        assertTrue(plan("SELECT * FROM users WHERE city IN ('a', 'b')").contains("IN (...)"));
        assertTrue(plan("SELECT * FROM users WHERE age > 30 ORDER BY age DESC LIMIT 2").contains("age range, descending"));
        assertTrue(plan("SELECT * FROM users ORDER BY id DESC LIMIT 2").contains("ordered by id descending"));
        assertTrue(plan("SELECT * FROM users WHERE name = 'Ada'").contains("SCAN users"));
        assertTrue(plan("SELECT * FROM users WHERE _rowid = 1").contains("BY _rowid"));
        // and the indexed plans return the same rows as a scan would
        assertEquals(List.of(List.of("Grace"), List.of("Alan")), rows("SELECT name FROM users WHERE age > 30 ORDER BY age DESC LIMIT 2"));
        assertEquals(List.of(List.of("Ada"), List.of("Alan")), rows("SELECT name FROM users WHERE city = 'London' ORDER BY name"));
        assertEquals(List.of(List.of(5L), List.of(4L)), rows("SELECT id FROM users ORDER BY id DESC LIMIT 2"));
        // an index lookup with a differently typed constant falls back to a scan and still matches
        assertEquals(1L, scalar("SELECT COUNT(*) FROM users WHERE id = '3'"));
    }

    @Test
    void indexesStayConsistentThroughChanges() {
        users();
        // two users live in London
        assertThrows(SqlException.class, () -> run("CREATE UNIQUE INDEX u ON users (city)"));
        run("CREATE INDEX idx_city ON users (city)");
        run("UPDATE users SET city = 'Paris' WHERE city = 'London'");
        assertEquals(0L, scalar("SELECT COUNT(*) FROM users WHERE city = 'London'"));
        assertEquals(2L, scalar("SELECT COUNT(*) FROM users WHERE city = 'Paris'"));
        run("DELETE FROM users WHERE city = 'Paris'");
        assertEquals(0L, scalar("SELECT COUNT(*) FROM users WHERE city = 'Paris'"));
        assertEquals(3L, scalar("SELECT COUNT(*) FROM users"));
        run("DROP INDEX idx_city");
        assertThrows(SqlException.class, () -> run("DROP INDEX pk_users_id"));
    }

    @Test
    void schemaStatements() {
        users();
        run("ALTER TABLE users ADD COLUMN email TEXT DEFAULT 'none'");
        assertEquals("none", scalar("SELECT email FROM users WHERE id = 1"));
        assertEquals(List.of("table", "rows", "columns", "indexes", "bytes"), run("SHOW TABLES").columns());
        assertEquals(5, run("DESCRIBE users").rows().size());
        assertEquals("OK: 5 row(s) deleted", run("TRUNCATE TABLE users").legacyText());
        assertEquals(0L, scalar("SELECT COUNT(*) FROM users"));
        assertEquals("OK: table already exists", run("CREATE TABLE IF NOT EXISTS users (x INT)").legacyText());
        assertEquals("OK: table does not exist", run("DROP TABLE IF EXISTS nope").legacyText());
    }

    @Test
    void errorsAreReadable() {
        SqlException syntax = assertThrows(SqlException.class, () -> run("SELEC * FROM x"));
        assertTrue(syntax.getMessage().startsWith("Syntax error"), syntax.getMessage());
        users();
        assertTrue(assertThrows(SqlException.class, () -> run("SELECT nope FROM users")).getMessage().contains("Column not found"));
        assertTrue(assertThrows(SqlException.class, () -> run("SELECT name FROM users u JOIN users v ON u.id = v.id"))
                .getMessage().contains("Ambiguous"));
    }

    @Test
    void resultSizeIsBounded() {
        SqlEngine small = new SqlEngine(storage, 10);
        run("CREATE TABLE big (i INT)");
        for (int i = 0; i < 20; i++) {
            run("INSERT INTO big VALUES (?)", (long) i);
        }
        assertThrows(SqlException.class, () -> small.execute(ks, "SELECT * FROM big", null));
        assertEquals(5, small.execute(ks, "SELECT * FROM big LIMIT 5", null).rows().size());
        assertEquals(3, small.execute(ks, "SELECT * FROM big ORDER BY i DESC LIMIT 3", null).rows().size());
    }

    // ------------------------------------------------------------------ durability

    @Test
    void tablesSurviveRestart() throws IOException {
        StorageConfig config = StorageConfig.defaults(dir.resolve("data")).withCheckpoint(0, 0);
        try (StorageEngine engine = new StorageEngine(config).open()) {
            SqlEngine engineSql = new SqlEngine(engine, 1000);
            Keyspace space = engine.keyspace("p");
            engineSql.execute(space, "CREATE TABLE t (id INT PRIMARY KEY, v TEXT)", null);
            engineSql.execute(space, "CREATE INDEX idx_v ON t (v)", null);
            engineSql.execute(space, "INSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c')", null);
            engineSql.execute(space, "UPDATE t SET v = 'B' WHERE id = 2", null);
            engineSql.execute(space, "DELETE FROM t WHERE id = 3", null);
            engineSql.execute(space, "ALTER TABLE t ADD COLUMN n INT DEFAULT 0", null);
            engine.checkpoint();
            engineSql.execute(space, "INSERT INTO t VALUES (4, 'd', 9)", null);
        }
        try (StorageEngine engine = new StorageEngine(config).open()) {
            SqlEngine engineSql = new SqlEngine(engine, 1000);
            Keyspace space = engine.findKeyspace("p");
            List<List<Object>> result = new ArrayList<>();
            for (Object[] row : engineSql.execute(space, "SELECT id, v, n FROM t ORDER BY id", null).rows()) {
                result.add(Arrays.asList(row));
            }
            assertEquals(List.of(List.of(1L, "a", 0L), List.of(2L, "B", 0L), List.of(4L, "d", 9L)), result);
            assertTrue(plan(engineSql, space, "SELECT * FROM t WHERE v = 'a'").contains("idx_v"));
            assertFalse(engineSql.execute(space, "SHOW INDEXES FROM t", null).rows().isEmpty());
        }
    }

    private static String plan(SqlEngine engine, Keyspace space, String statement) {
        StringBuilder sb = new StringBuilder();
        for (Object[] row : engine.execute(space, "EXPLAIN " + statement, null).rows()) {
            sb.append(row[0]).append('\n');
        }
        return sb.toString();
    }

    @Test
    void dumpAndImportRoundTrip() {
        users();
        run("CREATE INDEX idx_city ON users (city)");
        var dump = sql.dumpTables(ks);
        Keyspace other = storage.keyspace("other");
        sql.importTable(other, "users", dump.getJSONObject("users"), false, false);
        assertEquals(5L, sql.execute(other, "SELECT COUNT(*) FROM users", null).rows().get(0)[0]);
        assertTrue(plan(sql, other, "SELECT * FROM users WHERE city = 'x'").contains("idx_city"));
        assertThrows(SqlException.class, () -> sql.importTable(other, "users", dump.getJSONObject("users"), false, false));
        sql.importTable(other, "users", dump.getJSONObject("users"), true, false);
        assertEquals(5L, sql.execute(other, "SELECT COUNT(*) FROM users", null).rows().get(0)[0]);
        // appending the same rows again violates the primary key and changes nothing
        assertThrows(SqlException.class, () -> sql.importTable(other, "users", dump.getJSONObject("users"), false, true));
        assertEquals(5L, sql.execute(other, "SELECT COUNT(*) FROM users", null).rows().get(0)[0]);
        var more = new org.json.JSONObject(dump.getJSONObject("users").toString());
        more.put("rows", new org.json.JSONArray().put(new org.json.JSONArray().put(6).put("Barbara").put(52).put("MIT")));
        assertEquals(1, sql.importTable(other, "users", more, false, true));
        assertEquals(6L, sql.execute(other, "SELECT COUNT(*) FROM users", null).rows().get(0)[0]);
    }
}
