package github.hacimertgokhan.readers;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DenisPropertiesTest {

    @Test
    void bundledDefaultsAreReadWhenNothingOverrides() {
        DenisProperties props = new DenisProperties(Map.of());

        assertEquals(5142, props.getInt("ddb-port", 0));
        assertEquals("localhost", props.getProperty("ddb-address"));
        assertFalse(props.isFromEnvironment("ddb-port"));
    }

    @Test
    void prefixedEnvironmentVariablesOverrideEveryKey() {
        DenisProperties props = new DenisProperties(Map.of(
                "DENIS_DDB_PORT", "6000",
                "DENIS_MAX_CONNECTIONS_PER_IP", "3",
                "DENIS_LANGUAGE", "tr"));

        assertEquals(6000, props.getInt("ddb-port", 0));
        assertEquals(3, props.getInt("max-connections-per-ip", 0));
        assertEquals("tr", props.getProperty("language"));
        assertTrue(props.isFromEnvironment("ddb-port"));
    }

    @Test
    void ddbKeysAcceptTheShortDockerNames() {
        DenisProperties props = new DenisProperties(Map.of(
                "DDB_PORT", "7000",
                "DDB_MAIN_TOKEN", "t".repeat(128)));

        assertEquals(7000, props.getInt("ddb-port", 0));
        assertEquals("t".repeat(128), props.getProperty("ddb-main-token"));
    }

    @Test
    void prefixedNameWinsOverShortName() {
        DenisProperties props = new DenisProperties(Map.of("DENIS_DDB_PORT", "1", "DDB_PORT", "2"));

        assertEquals(1, props.getInt("ddb-port", 0));
    }

    @Test
    void blankEnvironmentValuesFallThrough() {
        DenisProperties props = new DenisProperties(Map.of("DDB_PORT", "   "));

        assertEquals(5142, props.getInt("ddb-port", 0));
    }

    @Test
    void nonNumericValueIsAClearError() {
        DenisProperties props = new DenisProperties(Map.of("DDB_PORT", "abc"));

        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> props.getInt("ddb-port", 0));
        assertTrue(e.getMessage().contains("ddb-port"));
    }

    @Test
    void environmentNamesFollowTheDocumentedMapping() {
        assertEquals("DENIS_MAX_CONNECTIONS_PER_IP", DenisProperties.environmentNames("max-connections-per-ip")[0]);
        assertEquals(1, DenisProperties.environmentNames("max-connections-per-ip").length);
        assertEquals("DENIS_DDB_MAIN_TOKEN", DenisProperties.environmentNames("ddb-main-token")[0]);
        assertEquals("DDB_MAIN_TOKEN", DenisProperties.environmentNames("ddb-main-token")[1]);
    }
}
