package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.TestContext;
import org.json.JSONObject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Boots a real server on an ephemeral port and talks to it over TCP. */
class DenisServerTest {
    @TempDir
    Path dir;
    private ServerContext ctx;
    private DenisServer server;
    private Thread acceptor;

    @BeforeEach
    void start() throws IOException {
        ctx = TestContext.open(dir, 50);
        server = new DenisServer(ctx, new DenisServer.Options("127.0.0.1", 0, 32, 12, 0));
        server.start();
        acceptor = new Thread(server::serve, "test-acceptor");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    @AfterEach
    void stop() {
        server.stop();
    }

    /** A tiny blocking client in json mode. */
    private final class Client implements AutoCloseable {
        final Socket socket = new Socket("127.0.0.1", server.port());
        final BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        final PrintWriter out = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);

        Client() throws IOException {
            socket.setSoTimeout(5_000);
            assertTrue(send("MODE json").getBoolean("ok"));
        }

        JSONObject send(String line) throws IOException {
            out.println(line);
            String reply = in.readLine();
            assertTrue(reply != null, "connection closed");
            return new JSONObject(reply);
        }

        String loginAndCreate() throws IOException {
            assertTrue(send("LIN " + TestContext.GROUP + " " + TestContext.PASSWORD).getBoolean("ok"));
            String token = send("AUTH CREATE").getString("token");
            assertTrue(send("AUTH " + token).getBoolean("ok"));
            return token;
        }

        @Override
        public void close() throws IOException {
            socket.close();
        }
    }

    @Test
    void fullSessionOverTcp() throws IOException {
        try (Client c = new Client()) {
            assertEquals("PONG", c.send("PING").getString("message"));
            String token = c.loginAndCreate();
            assertTrue(c.send("SET greeting hello world -&save").getBoolean("ok"));
            assertEquals("hello world", c.send("GET greeting").getString("data"));
            assertEquals("çğüşöı ✓ \"quoted\"", roundTrip(c, "çğüşöı ✓ \"quoted\""));

            try (Client other = new Client()) {
                other.send("LIN " + TestContext.GROUP + " " + TestContext.PASSWORD);
                assertTrue(other.send("AUTH " + token).getBoolean("ok"));
                assertEquals("hello world", other.send("GET greeting").getString("data"));
            }
            JSONObject info = c.send("INFO");
            assertEquals(1, info.getJSONObject("connections").getInt("open"));
            assertEquals(2, info.getJSONObject("connections").getInt("total"));
            assertTrue(c.send("SAVE").getBoolean("ok"));
            assertFalse(ctx.persistence().isDirty());
        }
    }

    private static String roundTrip(Client c, String value) throws IOException {
        assertTrue(c.send("SET u " + value).getBoolean("ok"));
        return c.send("GET u").getString("data");
    }

    @Test
    void perIpLimitRefusesExtraConnections() throws IOException {
        List<Client> clients = new ArrayList<>();
        try {
            // more than the pool's core threads: every one of them must be served at once
            for (int i = 0; i < 12; i++) {
                clients.add(new Client());
            }
            for (Client c : clients) {
                assertEquals("PONG", c.send("PING").getString("message"));
            }
            Socket extra = new Socket("127.0.0.1", server.port());
            extra.setSoTimeout(5_000);
            assertNull(new BufferedReader(new InputStreamReader(extra.getInputStream())).readLine(), "13th connection must be closed");
            extra.close();
        } finally {
            for (Client c : clients) {
                c.close();
            }
        }
    }

    @Test
    void manyConcurrentClientsShareOneProject() throws Exception {
        String token;
        try (Client c = new Client()) {
            token = c.loginAndCreate();
        }
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Future<?>> tasks = new ArrayList<>();
            for (int t = 0; t < 8; t++) {
                int thread = t;
                tasks.add(pool.submit(() -> {
                    try (Client c = new Client()) {
                        c.send("LIN " + TestContext.GROUP + " " + TestContext.PASSWORD);
                        c.send("AUTH " + token);
                        for (int i = 0; i < 100; i++) {
                            assertTrue(c.send("SET k" + thread + "-" + i + " v" + i + " -&save").getBoolean("ok"));
                        }
                        c.send("CREATE TABLE IF NOT EXISTS log (t INT, i INT)");
                        for (int i = 0; i < 20; i++) {
                            assertTrue(c.send("INSERT INTO log (t, i) VALUES (" + thread + ", " + i + ")").getBoolean("ok"));
                        }
                    }
                    return null;
                }));
            }
            for (Future<?> task : tasks) {
                task.get(60, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        try (Client c = new Client()) {
            c.send("LIN " + TestContext.GROUP + " " + TestContext.PASSWORD);
            c.send("AUTH " + token);
            assertEquals(800, c.send("KEYS").getInt("count"));
            assertEquals(160, c.send("SELECT COUNT(*) FROM log").getJSONArray("rows").getJSONObject(0).getInt("count"));
        }
        server.stop();
        assertEquals(800 + 2 + 160, ctx.persistence().keyCount());
    }
}
