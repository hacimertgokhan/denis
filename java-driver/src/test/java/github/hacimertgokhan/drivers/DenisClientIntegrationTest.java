package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Runs against a live server; see the Dockerfile at the repository root.
 * <pre>
 *   DENIS_INTEGRATION=1 DENIS_GROUP=crm DENIS_PASSWORD=s3cret mvn -q test
 * </pre>
 */
@EnabledIfEnvironmentVariable(named = "DENIS_INTEGRATION", matches = "1")
class DenisClientIntegrationTest {
    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private DenisClient connect() throws IOException {
        DenisClient client = new DenisClient(env("DENIS_HOST", "127.0.0.1"), Integer.parseInt(env("DENIS_PORT", "5142")));
        client.connect();
        client.login(env("DENIS_GROUP", "denis"), env("DENIS_PASSWORD", "change-me"));
        return client;
    }

    @Test
    void roundTripsValuesWithSpacesQuotesAndUnicode() throws IOException {
        try (DenisClient client = connect()) {
            String token = client.createProject();
            assertNotNull(token);
            assertTrue(client.ping());

            String value = "say \"hi\" — çğüşöı ✓ with spaces";
            client.set("greeting", value);
            assertEquals(value, client.get("greeting"));

            client.update("greeting", "changed");
            assertEquals("changed", client.get("greeting"));

            client.delete("greeting");
            assertNull(client.get("greeting"));
        }
    }

    @Test
    void persistedValueIsVisibleToASecondConnectionWithTheSameToken() throws IOException {
        String token;
        try (DenisClient first = connect()) {
            token = first.createProject();
            first.set("shared", "persisted value", true);
        }
        try (DenisClient second = connect()) {
            second.authenticate(token);
            assertEquals("persisted value", second.get("shared"));
            second.delete("shared");
        }
    }

    @Test
    void sqlSubsetWorks() throws IOException {
        try (DenisClient client = connect()) {
            client.createProject();
            assertTrue(client.sql("CREATE TABLE users (id INT, name TEXT)").startsWith("OK"));
            assertTrue(client.sql("INSERT INTO users (id, name) VALUES (1, 'Ada')").startsWith("OK"));
            assertTrue(client.sql("SELECT * FROM users WHERE id = 1").contains("Ada"));
            assertTrue(client.sql("DROP TABLE users").startsWith("OK"));
        }
    }

    @Test
    void wrongPasswordFails() throws IOException {
        try (DenisClient client = new DenisClient(env("DENIS_HOST", "127.0.0.1"), Integer.parseInt(env("DENIS_PORT", "5142")))) {
            client.connect();
            assertThrows(DenisException.class, () -> client.login(env("DENIS_GROUP", "denis"), "definitely-wrong"));
        }
    }
}
