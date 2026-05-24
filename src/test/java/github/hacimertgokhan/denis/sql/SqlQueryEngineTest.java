package github.hacimertgokhan.denis.sql;

import github.hacimertgokhan.pointers.Any;
import org.junit.jupiter.api.Test;

import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SqlQueryEngineTest {
    private final ConcurrentHashMap<String, Any> store = new ConcurrentHashMap<>();
    private final SqlQueryEngine sql = new SqlQueryEngine(store, "project-token");

    @Test
    void supportsCreateInsertSelect() {
        assertEquals("OK: table created", sql.execute("CREATE TABLE users (id INT, name TEXT)"));
        assertEquals("OK: 1 row inserted", sql.execute("INSERT INTO users (id, name) VALUES (1, 'Ada')"));

        String result = sql.execute("SELECT id, name FROM users WHERE id = 1");

        assertTrue(result.contains("\"id\":1"));
        assertTrue(result.contains("\"name\":\"Ada\""));
    }

    @Test
    void supportsUpdateAndDelete() {
        sql.execute("CREATE TABLE users (id INT, name TEXT)");
        sql.execute("INSERT INTO users (id, name) VALUES (1, 'Ada')");

        assertEquals("OK: 1 row(s) updated", sql.execute("UPDATE users SET name = 'Grace' WHERE id = 1"));
        assertTrue(sql.execute("SELECT * FROM users WHERE id = 1").contains("Grace"));

        assertEquals("OK: 1 row(s) deleted", sql.execute("DELETE FROM users WHERE id = 1"));
        assertEquals("[]", sql.execute("SELECT * FROM users WHERE id = 1"));
    }

    @Test
    void supportsSqlPrefixAndDropTable() {
        sql.execute("SQL CREATE TABLE users (id INT)");

        assertEquals("OK: table dropped", sql.execute("SQL DROP TABLE users;"));
        assertEquals("ERROR: Table not found: users", sql.execute("SELECT * FROM users"));
    }
}
