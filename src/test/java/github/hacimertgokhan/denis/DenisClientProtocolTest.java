package github.hacimertgokhan.denis;

import github.hacimertgokhan.pointers.Any;
import org.json.JSONObject;
import org.junit.jupiter.api.Test;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The parts of the wire protocol that need no login: MODE, PING, EXIT and the
 * login gate itself. Everything after LIN touches denis.toml / ddb.json on
 * disk and is covered by the Node client integration test against the Docker
 * image (clients/node/test/integration.test.js).
 */
class DenisClientProtocolTest {
    private final ConcurrentHashMap<String, Any> store = new ConcurrentHashMap<>();
    private final DenisClient client = new DenisClient(null, store);

    private String send(String line) {
        StringWriter buffer = new StringWriter();
        PrintWriter out = new PrintWriter(buffer, true);
        client.handleLine(line, out);
        return buffer.toString().trim();
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
        JSONObject mode = new JSONObject(send("MODE json"));
        assertTrue(mode.getBoolean("ok"));
        assertEquals("mode json", mode.getString("message"));

        JSONObject ping = new JSONObject(send("PING"));
        assertTrue(ping.getBoolean("ok"));
        assertEquals("PONG", ping.getString("message"));

        JSONObject refused = new JSONObject(send("GET x"));
        assertFalse(refused.getBoolean("ok"));
        assertTrue(refused.getString("error").contains("LIN"));

        JSONObject usage = new JSONObject(send("LIN onlygroup"));
        assertFalse(usage.getBoolean("ok"));
        assertTrue(usage.getString("error").startsWith("USAGE"));
    }

    @Test
    void modeCanBeSwitchedBack() {
        send("MODE json");
        // the confirmation already uses the newly selected format
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
}
