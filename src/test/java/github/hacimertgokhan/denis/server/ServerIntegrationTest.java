package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.backup.BackupManager;
import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.denis.security.LoginGuard;
import github.hacimertgokhan.denis.security.PasswordHasher;
import github.hacimertgokhan.denis.sql.SqlEngine;
import github.hacimertgokhan.denis.storage.StorageConfig;
import github.hacimertgokhan.denis.storage.StorageEngine;
import github.hacimertgokhan.denis.storage.wal.FsyncPolicy;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The wire protocol end to end over real sockets. */
class ServerIntegrationTest {
    @TempDir
    Path dir;

    private StorageEngine storage;
    private DenisServer server;
    private ThreadPoolExecutor workers;
    private final List<Client> clients = new ArrayList<>();

    private void start(FsyncPolicy fsync, int maxLine, int maxPerIp, int loginFailures) throws IOException {
        StorageConfig storageConfig = StorageConfig.defaults(dir.resolve("data")).withFsync(fsync).withCheckpoint(0, 0);
        ServerConfig config = new ServerConfig("127.0.0.1", 0, 100, maxPerIp, maxLine, 2, 2, 64, 0, 1 << 20, false,
                loginFailures, 60, 20_000, true, 1000, 1000, dir.resolve("denis.toml"), dir.resolve("ddb.json"),
                dir.resolve("backups"), 0, 3, storageConfig);
        storage = new StorageEngine(storageConfig).open();
        GroupManager groups = new GroupManager(config.groupsFile(), new PasswordHasher(20_000));
        groups.create("admin", "admin-pw", true);
        groups.create("app", "app-pw", false);
        groups.create("other", "other-pw", false);
        workers = new ThreadPoolExecutor(2, 2, 1, TimeUnit.SECONDS, new ArrayBlockingQueue<>(64));
        ServerContext context = new ServerContext(config, storage, new SqlEngine(storage, 1000), groups,
                new ProjectRegistry(config.projectsFile()),
                new BackupManager(storage, config.backupDir(), config.groupsFile(), config.projectsFile(), 3, "test"),
                new LoginGuard(loginFailures, 60_000), new ServerMetrics(), workers, "test");
        server = new DenisServer(config, context);
        server.start();
    }

    private void start() throws IOException {
        start(FsyncPolicy.EVERYSEC, 64 * 1024, 50, 10);
    }

    @AfterEach
    void stop() {
        clients.forEach(Client::close);
        if (server != null) {
            server.close();
        }
        if (workers != null) {
            workers.shutdownNow();
        }
        if (storage != null) {
            storage.close();
        }
    }

    private final class Client implements AutoCloseable {
        final Socket socket;
        final BufferedReader in;
        final Writer out;

        Client() throws IOException {
            socket = new Socket("127.0.0.1", server.port());
            socket.setSoTimeout(10_000);
            in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            out = new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8);
            clients.add(this);
        }

        String send(String line) throws IOException {
            out.write(line + "\n");
            out.flush();
            return in.readLine();
        }

        JSONObject json(String line) throws IOException {
            String reply = send(line);
            return new JSONObject(reply);
        }

        @Override
        public void close() {
            try {
                socket.close();
            } catch (IOException ignored) {
                // test cleanup
            }
        }
    }

    private Client jsonClient(String group, String password) throws IOException {
        Client c = new Client();
        assertTrue(c.json("MODE json").getBoolean("ok"));
        JSONObject login = c.json("LIN " + group + " " + password);
        assertTrue(login.getBoolean("ok"), login.toString());
        return c;
    }

    private String createProject(Client c) throws IOException {
        JSONObject created = c.json("AUTH CREATE");
        assertTrue(created.getBoolean("ok"), created.toString());
        String token = created.getString("token");
        assertTrue(c.json("AUTH " + token).getBoolean("ok"));
        return token;
    }

    @Test
    void textModeRepliesMatchDenis00x() throws IOException {
        start();
        Client c = new Client();
        assertEquals("PONG", c.send("PING"));
        assertTrue(c.send("SET a b").startsWith("[Error - "));
        assertTrue(c.send("LIN app app-pw").endsWith("Logged in to group: app"));
        assertTrue(c.send("GET x").endsWith("Please authenticate first using AUTH command"));
        String created = c.send("AUTH CREATE");
        String token = created.substring(created.indexOf("Token: ") + 7);
        assertTrue(c.send("AUTH " + token).endsWith("Authenticated to project: " + token));
        assertTrue(c.send("SET greeting hello world").endsWith("Ok (Cache)"));
        assertEquals("hello world", c.send("GET greeting"));
        assertTrue(c.send("SET saved value -&save").endsWith("Ok (Protobuf)"));
        assertTrue(c.send("SET both value -&cache -&save").endsWith("Ok (Cache, Protobuf)"));
        assertEquals("{\"data\":\"hello world\",\"key\":\"greeting\"}", new JSONObject(c.send("GET greeting -&asa-json")).toString());
        assertEquals("err: missing not found in cache or protobuff", c.send("GET missing"));
        assertTrue(c.send("DEL greeting").endsWith("Ok (Cache,Protobuf)."));
        assertEquals("USAGE: SET <key> <value> [-&save] [-&cache] [-&protobuff] [-&ttl=<seconds>]", c.send("SET onlykey"));
        assertEquals("OK: table created", c.send("CREATE TABLE t (id INT, name TEXT)"));
        assertEquals("OK: 1 row inserted", c.send("INSERT INTO t (id, name) VALUES (1, 'Ada')"));
        assertEquals("Ada", new JSONArray(c.send("SELECT * FROM t")).getJSONObject(0).getString("name"));
        assertTrue(c.send("EXIT").endsWith("Bye."));
        assertNull(c.in.readLine(), "the server closes after EXIT");
    }

    @Test
    void jsonModeKeyValueApi() throws IOException {
        start();
        Client c = jsonClient("app", "app-pw");
        createProject(c);
        assertTrue(c.json("SET counter 41").getBoolean("ok"));
        assertEquals(42, c.json("INCR counter").getLong("value"));
        assertEquals("42", c.json("GET counter").getString("data"));
        JSONObject missing = c.json("GET nope");
        assertFalse(missing.getBoolean("ok"));
        assertEquals("not found", missing.getString("error"));
        assertTrue(c.json("SET s v -&ttl=60").getBoolean("ok"));
        long ttl = c.json("TTL s").getLong("ttl");
        assertTrue(ttl > 50 && ttl <= 60, "ttl " + ttl);
        assertTrue(c.json("EXISTS s").getBoolean("exists"));
        c.json("SET user:1 a -&save");
        c.json("SET user:2 b");
        JSONObject keys = c.json("KEYS user:*");
        assertEquals(2, keys.getInt("count"));
        assertEquals(1, c.json("KEYS user:* -&protobuff").getInt("count"));
        JSONObject mget = c.json("MGET user:1 user:2 nope");
        assertEquals("a", mget.getJSONObject("data").getString("user:1"));
        assertTrue(mget.getJSONObject("data").isNull("nope"));
        assertEquals(4, c.json("DBSIZE").getLong("keys"));
        JSONObject del = c.json("DEL user:1");
        assertTrue(del.getBoolean("deleted"));
        assertEquals("NOTFOUND", c.json("GET user:1").getString("code"));
        JSONObject unknown = c.json("FROB x");
        assertEquals("UNKNOWN", unknown.getString("code"));
    }

    @Test
    void pipelinedCommandsAreAnsweredInOrder() throws IOException {
        start();
        Client c = jsonClient("app", "app-pw");
        createProject(c);
        StringBuilder batch = new StringBuilder();
        int n = 2000;
        for (int i = 0; i < n; i++) {
            batch.append("SET k").append(i).append(" v").append(i).append('\n');
            batch.append("GET k").append(i).append('\n');
            if (i % 100 == 0) {
                // a slow command in the middle must not reorder replies
                batch.append("SQL SELECT ").append(i).append('\n');
            }
        }
        c.out.write(batch.toString());
        c.out.flush();
        for (int i = 0; i < n; i++) {
            assertTrue(new JSONObject(c.in.readLine()).getBoolean("ok"));
            assertEquals("v" + i, new JSONObject(c.in.readLine()).getString("data"));
            if (i % 100 == 0) {
                assertEquals(i, new JSONObject(c.in.readLine()).getJSONArray("rows").getJSONArray(0).getLong(0));
            }
        }
    }

    @Test
    void sqlOverTheWireWithParameters() throws IOException {
        start();
        Client c = jsonClient("app", "app-pw");
        createProject(c);
        assertTrue(c.json("SQL CREATE TABLE readings (id INTEGER PRIMARY KEY, sensor TEXT, value REAL)").getBoolean("ok"));
        for (int i = 0; i < 10; i++) {
            JSONObject q = new JSONObject().put("sql", "INSERT INTO readings (sensor, value) VALUES (?, ?)")
                    .put("params", new JSONArray().put(i % 2 == 0 ? "a" : "b").put(i * 1.5));
            JSONObject r = c.json("QUERY " + q);
            assertEquals(1, r.getInt("affected"), r.toString());
        }
        JSONObject q = new JSONObject().put("sql", "SELECT sensor, COUNT(*) AS n, MAX(value) FROM readings WHERE sensor = ? GROUP BY sensor")
                .put("params", new JSONArray().put("a"));
        JSONObject result = c.json("QUERY " + q);
        assertEquals(List.of("sensor", "n", "MAX(value)"), result.getJSONArray("columns").toList());
        assertEquals("[[\"a\",5,12]]", result.getJSONArray("rows").toString().replace("12.0", "12"));
        JSONObject error = c.json("SQL SELECT * FROM nothing");
        assertFalse(error.getBoolean("ok"));
        assertEquals("SQL", error.getString("code"));
        assertEquals("ERROR: Table not found: nothing", error.getString("data"));
    }

    @Test
    void projectsBelongToTheirGroup() throws IOException {
        start();
        Client app = jsonClient("app", "app-pw");
        String token = createProject(app);
        Client other = jsonClient("other", "other-pw");
        assertFalse(other.json("AUTH " + token).getBoolean("ok"), "another group cannot open the project");
        assertEquals(0, other.json("PROJECTS").getInt("count"));
        assertFalse(other.json("AUTH DELETE " + token).getBoolean("ok"));
        Client admin = jsonClient("admin", "admin-pw");
        assertTrue(admin.json("AUTH " + token).getBoolean("ok"), "admins can open every project");
        assertEquals(1, app.json("PROJECTS").getInt("count"));
        assertEquals("FORBIDDEN", app.json("SAVE").getString("code"));
        assertTrue(admin.json("SAVE").getBoolean("ok"));
        JSONObject backup = admin.json("BACKUP");
        assertTrue(backup.getBoolean("ok"), backup.toString());
        assertEquals(1, admin.json("BACKUPS").getJSONArray("backups").length());
        assertTrue(app.json("AUTH DELETE " + token).getBoolean("ok"));
        assertFalse(app.json("AUTH " + token).getBoolean("ok"));
    }

    @Test
    void repeatedLoginFailuresLockTheAddressOut() throws IOException {
        start(FsyncPolicy.EVERYSEC, 64 * 1024, 50, 3);
        Client c = new Client();
        c.json("MODE json");
        for (int i = 0; i < 3; i++) {
            assertEquals("AUTH", c.json("LIN app wrong").getString("code"));
        }
        JSONObject locked = c.json("LIN app app-pw");
        assertEquals("LOCKED", locked.getString("code"), "even the right password waits out the lockout");
    }

    @Test
    void overlongLinesCloseTheConnection() throws IOException {
        start(FsyncPolicy.EVERYSEC, 1024, 50, 10);
        Client c = jsonClient("app", "app-pw");
        createProject(c);
        String reply = c.send("SET big " + "x".repeat(5000));
        assertEquals("LIMIT", new JSONObject(reply).getString("code"));
        assertNull(c.in.readLine());
    }

    @Test
    void connectionsPerAddressAreLimited() throws IOException {
        start(FsyncPolicy.EVERYSEC, 64 * 1024, 2, 10);
        Client a = new Client();
        Client b = new Client();
        assertEquals("PONG", a.send("PING"));
        assertEquals("PONG", b.send("PING"));
        Client third = new Client();
        String refusal = third.in.readLine();
        assertEquals("LIMIT", new JSONObject(refusal).getString("code"));
    }

    @Test
    void dumpAndImportMoveAProject() throws IOException {
        start();
        Client c = jsonClient("app", "app-pw");
        createProject(c);
        c.json("SET a 1 -&save");
        c.json("SET b 2");
        c.json("SQL CREATE TABLE t (id INT PRIMARY KEY, v TEXT)");
        c.json("SQL INSERT INTO t VALUES (1, 'x'), (2, 'y')");
        JSONObject dump = c.json("DUMP");
        assertTrue(dump.getBoolean("ok"));
        dump.remove("ok");

        createProject(c);
        JSONObject imported = c.json("IMPORT " + dump);
        assertTrue(imported.getBoolean("ok"), imported.toString());
        assertEquals("1", c.json("GET a").getString("data"));
        assertEquals("2", c.json("GET b").getString("data"));
        assertEquals(2, c.json("SQL SELECT COUNT(*) FROM t").getJSONArray("rows").getJSONArray(0).getInt(0));
    }

    @Test
    void fsyncAlwaysAcknowledgesDurableWrites() throws IOException {
        start(FsyncPolicy.ALWAYS, 64 * 1024, 50, 10);
        Client c = jsonClient("app", "app-pw");
        createProject(c);
        for (int i = 0; i < 50; i++) {
            assertTrue(c.json("SET k" + i + " v -&save").getBoolean("ok"));
        }
        assertTrue(storage.stats().walFsyncs() > 0);
    }

    @Test
    void infoAndHello() throws IOException {
        start();
        Client c = new Client();
        c.json("MODE json");
        JSONObject hello = c.json("HELLO");
        assertEquals(Session.PROTOCOL_VERSION, hello.getInt("protocol"));
        c.json("LIN admin admin-pw");
        JSONObject info = c.json("INFO").getJSONObject("info");
        assertTrue(info.getJSONObject("clients").getInt("connected") >= 1);
        assertTrue(info.getJSONObject("persistence").getBoolean("enabled"));
        assertTrue(info.has("recovery"));
    }
}
