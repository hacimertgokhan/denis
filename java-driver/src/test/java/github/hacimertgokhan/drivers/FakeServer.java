package github.hacimertgokhan.drivers;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;

/**
 * In-process stand-in for a Denis server speaking protocol 2 in JSON mode.
 * One thread per connection; replies are written in order, one line each.
 * Tests can intercept lines with {@link #override}.
 */
final class FakeServer implements AutoCloseable {
    static final String GROUP = "grp";
    static final String PASSWORD = "pass with spaces";

    final ServerSocket server;
    final List<Conn> connections = new CopyOnWriteArrayList<>();
    /** Every received line of every connection, in global arrival order. */
    final List<String> arrivals = new CopyOnWriteArrayList<>();
    final Map<String, String> data = new ConcurrentHashMap<>();
    final Map<String, Long> ttl = new ConcurrentHashMap<>();
    final AtomicInteger projects = new AtomicInteger();
    final CountDownLatch released = new CountDownLatch(1);
    /** Return a reply line (or "" for no reply) to intercept a command; null falls through to the default handler. */
    volatile BiFunction<Conn, String, String> override;
    /** When set, accepted connections are closed immediately. */
    volatile boolean refuse;
    private final Thread acceptor;
    private volatile boolean closed;

    FakeServer() throws IOException {
        server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
        acceptor = new Thread(this::acceptLoop, "fake-denis-acceptor");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    int port() {
        return server.getLocalPort();
    }

    DenisClient.Builder builder() {
        return DenisClient.builder().host("127.0.0.1").port(port());
    }

    Conn connection(int index) {
        return connections.get(index);
    }

    /** Commands received on all connections, in arrival order per connection. */
    List<String> allReceived() {
        List<String> all = new ArrayList<>();
        for (Conn c : connections) {
            all.addAll(c.received);
        }
        return all;
    }

    private void acceptLoop() {
        while (!closed) {
            try {
                Socket s = server.accept();
                if (refuse) {
                    s.close();
                    continue;
                }
                Conn c = new Conn(s, connections.size());
                connections.add(c);
                Thread t = new Thread(c::serve, "fake-denis-conn-" + c.index);
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                return;
            }
        }
    }

    @Override
    public void close() throws IOException {
        closed = true;
        released.countDown();
        server.close();
        for (Conn c : connections) {
            c.close();
        }
    }

    static String ok(String fields) {
        return fields.isEmpty() ? "{\"ok\":true}" : "{\"ok\":true," + fields + "}";
    }

    static String error(String code, String message) {
        return "{\"ok\":false,\"error\":" + Json.quote(message) + ",\"code\":\"" + code + "\"}";
    }

    final class Conn {
        final Socket socket;
        final int index;
        final List<String> received = new CopyOnWriteArrayList<>();
        private OutputStream out;
        boolean json;
        boolean loggedIn;
        String group;
        String token;

        Conn(Socket socket, int index) {
            this.socket = socket;
            this.index = index;
        }

        void serve() {
            try (Socket s = socket) {
                BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                out = s.getOutputStream();
                String line;
                while ((line = in.readLine()) != null) {
                    received.add(line);
                    arrivals.add(line);
                    String reply = null;
                    BiFunction<Conn, String, String> o = override;
                    if (o != null) {
                        reply = o.apply(this, line);
                    }
                    if (reply == null) {
                        reply = handle(line);
                    }
                    if (socket.isClosed()) {
                        return;
                    }
                    if (!reply.isEmpty()) {
                        send(reply + "\n");
                    }
                }
            } catch (IOException ignored) {
                // client went away
            }
        }

        synchronized void send(String raw) throws IOException {
            out.write(raw.getBytes(StandardCharsets.UTF_8));
            out.flush();
        }

        void close() {
            try {
                socket.close();
            } catch (IOException ignored) {
                // closing
            }
        }

        /** Block this connection (like a stalled server) until the test ends. */
        String hang() {
            try {
                released.await(30, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return "";
        }

        private String handle(String line) {
            String trimmed = line.stripLeading();
            String[] w = trimmed.split(" ", 3);
            String cmd = w[0].toUpperCase();
            switch (cmd) {
                case "MODE":
                    json = true;
                    return ok("\"message\":\"mode json\"");
                case "PING":
                    return ok("\"message\":\"PONG\"");
                case "HELLO":
                    return ok("\"server\":\"denis\",\"version\":\"0.1.0\",\"protocol\":2,\"features\":[\"json\",\"sql-params\"],\"loggedIn\":" + loggedIn);
                case "LIN": {
                    String[] p = trimmed.split(" ", 3);
                    if (p.length == 3 && p[1].equals(GROUP) && p[2].equals(PASSWORD)) {
                        loggedIn = true;
                        group = p[1];
                        return ok("\"message\":\"Logged in to group: grp\",\"group\":\"grp\",\"admin\":true");
                    }
                    return error("AUTH", "Login failed: unknown group or wrong password");
                }
                default:
                    break;
            }
            if (!loggedIn) {
                return error("NOAUTH", "Please login first using LIN command");
            }
            switch (cmd) {
                case "AUTH":
                    if (w[1].equalsIgnoreCase("CREATE")) {
                        return ok("\"message\":\"Project created\",\"token\":\"tok-" + projects.incrementAndGet() + "\"");
                    }
                    if (w[1].equalsIgnoreCase("DELETE")) {
                        if (w[2].equals(token)) {
                            token = null;
                        }
                        return ok("\"message\":\"Project deleted\"");
                    }
                    if (w[1].startsWith("bad")) {
                        return error("AUTH", "Cannot auth with: " + w[1]);
                    }
                    token = w[1];
                    return ok("\"message\":\"Authenticated to project: " + token + "\"");
                case "WHOAMI":
                    return ok("\"group\":\"grp\",\"admin\":true,\"project\":" + (token == null ? "null" : Json.quote(token)));
                case "INFO":
                    return ok("\"info\":{\"server\":{\"version\":\"0.1.0\"},\"stats\":{\"commands\":5}}");
                case "PROJECTS":
                    return ok("\"projects\":[{\"token\":\"tok-1\",\"owner\":\"grp\",\"keys\":3,\"tables\":1,\"current\":true},"
                            + "{\"token\":\"legacy\",\"owner\":null,\"keys\":0,\"tables\":0,\"current\":false}],\"count\":2");
                case "SAVE":
                    return ok("\"message\":\"Snapshot written\",\"bytes\":10,\"records\":2,\"millis\":1");
                case "BACKUP":
                    return ok("\"message\":\"Backup created\",\"name\":\"b1.zip\",\"path\":\"/tmp/b1.zip\",\"bytes\":99,\"createdAt\":\"2026-09-23T10:00:00Z\"");
                case "BACKUPS":
                    return ok("\"backups\":[{\"name\":\"b1.zip\",\"path\":\"/tmp/b1.zip\",\"bytes\":99,\"createdAt\":\"2026-09-23T10:00:00Z\"}],\"directory\":\"/tmp\"");
                default:
                    break;
            }
            if (token == null) {
                return error("NOPROJECT", "Please authenticate first using AUTH command");
            }
            switch (cmd) {
                case "GET": {
                    String v = data.get(w[1]);
                    if (v == null) {
                        return "{\"ok\":false,\"key\":" + Json.quote(w[1]) + ",\"error\":\"not found\",\"code\":\"NOTFOUND\"}";
                    }
                    return ok("\"key\":" + Json.quote(w[1]) + ",\"data\":" + Json.quote(v));
                }
                case "SET":
                case "UPDATE": {
                    // exactly like the real server: flags are removed, everything else is kept verbatim
                    String value = w[2];
                    if (value.contains("-&")) {
                        StringBuilder sb = new StringBuilder();
                        boolean first = true;
                        for (String word : w[2].stripTrailing().split(" ", -1)) {
                            if (!word.startsWith("-&")) {
                                sb.append(first ? "" : " ").append(word);
                                first = false;
                            }
                        }
                        value = sb.toString();
                    }
                    data.put(w[1], value);
                    return ok("\"message\":\"Ok (Cache)\"");
                }
                case "DEL":
                    return ok("\"message\":\"Ok\",\"deleted\":" + (data.remove(w[1]) != null));
                case "EXISTS":
                    return ok("\"key\":" + Json.quote(w[1]) + ",\"exists\":" + data.containsKey(w[1]) + ",\"cache\":true,\"persistent\":false");
                case "MGET": {
                    Map<String, Object> m = new LinkedHashMap<>();
                    for (String k : trimmed.substring(5).split(" ")) {
                        m.put(k, data.get(k));
                    }
                    return ok("\"data\":" + Json.write(m));
                }
                case "INCR":
                case "DECR": {
                    String[] p = trimmed.split(" ");
                    long delta = p.length > 2 && !p[2].startsWith("-&") ? Long.parseLong(p[2]) : 1;
                    long v = Long.parseLong(data.getOrDefault(p[1], "0")) + (cmd.equals("DECR") ? -delta : delta);
                    data.put(p[1], Long.toString(v));
                    return ok("\"key\":" + Json.quote(p[1]) + ",\"data\":\"" + v + "\",\"value\":" + v);
                }
                case "EXPIRE":
                    ttl.put(w[1], (long) (Double.parseDouble(w[2]) * 1000));
                    return ok("\"key\":" + Json.quote(w[1]) + ",\"data\":\"1\",\"updated\":" + data.containsKey(w[1]));
                case "PERSIST":
                    ttl.remove(w[1]);
                    return ok("\"key\":" + Json.quote(w[1]) + ",\"data\":\"1\",\"updated\":" + data.containsKey(w[1]));
                case "TTL": {
                    long ms = !data.containsKey(w[1]) ? -2 : ttl.getOrDefault(w[1], -1L);
                    long s = ms < 0 ? ms : (ms + 999) / 1000;
                    return ok("\"key\":" + Json.quote(w[1]) + ",\"data\":\"" + s + "\",\"ttl\":" + s + ",\"ttlMillis\":" + ms);
                }
                case "DBSIZE":
                    return ok("\"keys\":" + data.size() + ",\"cache\":" + data.size() + ",\"persistent\":0,\"tables\":0,\"data\":\"" + data.size() + "\"");
                case "HEAVEN":
                    data.clear();
                    return ok("\"message\":\"Ok.\"");
                case "KEYS":
                    return ok("\"keys\":" + Json.write(new ArrayList<>(new java.util.TreeSet<>(data.keySet()))) + ",\"count\":" + data.size() + ",\"truncated\":false");
                case "QUERY": {
                    Map<String, Object> q = Json.parseObject(trimmed.substring(6));
                    String sql = (String) q.get("sql");
                    if (sql.startsWith("SELECT")) {
                        return ok("\"columns\":[\"sql\",\"params\"],\"rows\":[[" + Json.quote(sql) + "," + Json.quote(Json.write(q.get("params")))
                                + "]],\"count\":1,\"data\":\"[]\"");
                    }
                    if (sql.startsWith("BAD")) {
                        return "{\"ok\":false,\"error\":\"Table not found: t\",\"code\":\"SQL\",\"data\":\"ERROR: Table not found: t\"}";
                    }
                    return ok("\"message\":\"1 row inserted\",\"affected\":1,\"lastRowId\":7,\"data\":\"OK: 1 row inserted\"");
                }
                case "DUMP":
                    return ok("\"format\":1,\"cache\":" + Json.write(new java.util.TreeMap<>(data)) + ",\"persistent\":{},\"ttl\":{},\"tables\":{}");
                case "IMPORT": {
                    Map<String, Object> d = Json.parseObject(trimmed.substring(7));
                    long cache = d.get("cache") instanceof Map ? ((Map<?, ?>) d.get("cache")).size() : 0;
                    long persistent = d.get("persistent") instanceof Map ? ((Map<?, ?>) d.get("persistent")).size() : 0;
                    long tables = d.get("tables") instanceof Map ? ((Map<?, ?>) d.get("tables")).size() : 0;
                    long rows = 0;
                    if (d.get("tables") instanceof Map) {
                        for (Object def : ((Map<?, ?>) d.get("tables")).values()) {
                            Object r = def instanceof Map ? ((Map<?, ?>) def).get("rows") : null;
                            rows += r instanceof List ? ((List<?>) r).size() : 0;
                        }
                    }
                    return ok("\"message\":\"Imported\",\"imported\":{\"persistent\":" + persistent + ",\"cache\":" + cache
                            + ",\"tables\":" + tables + ",\"rows\":" + rows + "}");
                }
                default:
                    return error("UNKNOWN", "Unknown command: " + cmd);
            }
        }
    }
}
