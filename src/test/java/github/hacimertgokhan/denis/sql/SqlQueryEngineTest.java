package github.hacimertgokhan.denis.sql;

import github.hacimertgokhan.denis.server.ProjectStore;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.proto.ProtoDatabase;
import org.json.JSONArray;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SqlQueryEngineTest {
    @TempDir
    Path dir;
    private ConcurrentHashMap<String, Any> cache;
    private ProtoDatabase persistence;
    private SqlQueryEngine sql;

    @BeforeEach
    void setUp() throws IOException {
        cache = new ConcurrentHashMap<>();
        persistence = new ProtoDatabase(dir.resolve("database.bin"), 0);
        sql = new SqlQueryEngine(new ProjectStore("project-token", cache, persistence));
    }

    private JSONArray rows(String query) {
        SqlResult result = sql.execute(query);
        assertTrue(result.ok(), result.toText());
        return result.rows();
    }

    @Test
    void supportsCreateInsertSelect() {
        assertEquals("OK: table created", sql.execute("CREATE TABLE users (id INT, name TEXT)").toText());
        assertEquals("OK: 1 row inserted", sql.execute("INSERT INTO users (id, name) VALUES (1, 'Ada')").toText());

        String result = sql.execute("SELECT id, name FROM users WHERE id = 1").toText();

        assertTrue(result.contains("\"id\":1"));
        assertTrue(result.contains("\"name\":\"Ada\""));
    }

    @Test
    void supportsUpdateAndDelete() {
        sql.execute("CREATE TABLE users (id INT, name TEXT)");
        sql.execute("INSERT INTO users (id, name) VALUES (1, 'Ada')");

        assertEquals("OK: 1 row(s) updated", sql.execute("UPDATE users SET name = 'Grace' WHERE id = 1").toText());
        assertTrue(sql.execute("SELECT * FROM users WHERE id = 1").toText().contains("Grace"));

        assertEquals("OK: 1 row(s) deleted", sql.execute("DELETE FROM users WHERE id = 1").toText());
        assertEquals("[]", sql.execute("SELECT * FROM users WHERE id = 1").toText());
    }

    @Test
    void supportsSqlPrefixAndDropTable() {
        sql.execute("SQL CREATE TABLE users (id INT)");

        assertEquals("OK: table dropped", sql.execute("SQL DROP TABLE users;").toText());
        assertEquals("ERROR: Table not found: users", sql.execute("SELECT * FROM users").toText());
        assertEquals("OK: table does not exist", sql.execute("DROP TABLE IF EXISTS users").toText());
        assertEquals(0, persistence.keyCount());
    }

    @Test
    void multiRowInsertOrderByLimitAndCount() {
        sql.execute("CREATE TABLE t (n INT, s TEXT)");
        assertEquals(3, sql.execute("INSERT INTO t (n, s) VALUES (3, 'c'), (1, 'a'), (2, 'b, with comma')").affected());

        JSONArray ordered = rows("SELECT n FROM t ORDER BY n DESC LIMIT 2");
        assertEquals(2, ordered.length());
        assertEquals(3, ordered.getJSONObject(0).getInt("n"));
        assertEquals(2, ordered.getJSONObject(1).getInt("n"));

        JSONArray offset = rows("SELECT n FROM t ORDER BY n LIMIT 1 OFFSET 1");
        assertEquals(2, offset.getJSONObject(0).getInt("n"));

        assertEquals(3, rows("SELECT COUNT(*) FROM t").getJSONObject(0).getInt("count"));
        assertEquals("b, with comma", rows("SELECT s FROM t WHERE n = 2").getJSONObject(0).getString("s"));
    }

    @Test
    void whereSupportsOperatorsAndBooleanLogic() {
        sql.execute("CREATE TABLE p (id INT, name TEXT, price REAL, active BOOL)");
        sql.execute("INSERT INTO p (id, name, price, active) VALUES (1, 'Apple', 1.5, true), (2, 'Banana', 0.5, false), (3, 'Cherry', 3, true), (4, NULL, 2, true)");

        assertEquals(3, rows("SELECT id FROM p WHERE price > 1 AND active = true").length());
        assertEquals(2, rows("SELECT id FROM p WHERE price > 1 AND active = true AND id < 4").length());
        assertEquals(3, rows("SELECT id FROM p WHERE price <= 0.5 OR active = true AND id != 4").length());
        assertEquals(1, rows("SELECT id FROM p WHERE name LIKE 'ban%'").length());
        assertEquals(1, rows("SELECT id FROM p WHERE name IS NULL").length());
        assertEquals(3, rows("SELECT id FROM p WHERE name IS NOT NULL").length());
        assertEquals(1, rows("SELECT id FROM p WHERE name <> 'Apple' AND price >= 2 AND name IS NOT NULL").length());
    }

    @Test
    void showTablesAndDescribe() {
        sql.execute("CREATE TABLE users (id INT, name TEXT)");
        sql.execute("CREATE TABLE IF NOT EXISTS users (id INT)");
        sql.execute("INSERT INTO users (id, name) VALUES (1, 'Ada')");

        SqlResult tables = sql.execute("SHOW TABLES");
        assertEquals(SqlResult.Type.TABLES, tables.type());
        assertEquals(1, tables.rows().length());
        assertEquals("users", tables.rows().getJSONObject(0).getString("name"));
        assertEquals(1, tables.rows().getJSONObject(0).getInt("rows"));
        assertEquals("INT", tables.rows().getJSONObject(0).getJSONArray("columns").getJSONObject(0).getString("type"));

        assertEquals(tables.toJson().getJSONArray("tables").toString(), sql.execute("DESCRIBE users").toJson().getJSONArray("tables").toString());
        assertFalse(sql.execute("DESCRIBE nope").ok());
    }

    @Test
    void tablesArePersistedAndSurviveCacheLoss() {
        sql.execute("CREATE TABLE users (id INT, name TEXT)");
        sql.execute("INSERT INTO users (id, name) VALUES (1, 'Ada')");
        assertTrue(persistence.exists("project-token", "__sql:users:schema"));
        assertTrue(persistence.exists("project-token", "__sql:users:row:1"));

        cache.clear();
        assertEquals("Ada", rows("SELECT name FROM users").getJSONObject(0).getString("name"));
        sql.execute("INSERT INTO users (id, name) VALUES (2, 'Grace')");
        assertEquals(2, rows("SELECT COUNT(*) FROM users").getJSONObject(0).getInt("count"));
    }

    @Test
    void errorsAreReported() {
        assertEquals("ERROR: Unsupported SQL query", sql.execute("ALTER TABLE x").toText());
        sql.execute("CREATE TABLE users (id INT)");
        assertEquals("ERROR: Column not found: nope", sql.execute("SELECT nope FROM users").toText());
        assertEquals("ERROR: Column count does not match value count", sql.execute("INSERT INTO users (id) VALUES (1, 2)").toText());
        assertEquals("ERROR: Table already exists: users", sql.execute("CREATE TABLE users (id INT)").toText());
        assertFalse(sql.execute("SELECT * FROM users WHERE id LIKE").ok());
    }
}
