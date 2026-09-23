package github.hacimertgokhan.denis.bench;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * End-to-end load generator for a running Denis server. It only uses the wire
 * protocol, so the same tool measures every server version and the numbers of
 * a change can be compared with the numbers before it.
 *
 * <pre>
 *   java -jar denis-benchmarks.jar --group bench --password bench \
 *        --workload mixed --connections 8 --pipeline 16 --duration 10
 * </pre>
 *
 * Every connection is one thread that writes {@code pipeline} commands, flushes
 * and reads the same number of replies. The latency of a command is the time
 * from the flush of its batch to the arrival of its reply line, so it includes
 * the queueing inside the batch (like redis-benchmark -P).
 *
 * Workloads: {@code set} (cache writes), {@code get} (reads of prefilled keys),
 * {@code mixed} (80% get / 20% set), {@code persist} (durable writes,
 * {@code -&save}), {@code sql} (SELECT by id on a prefilled table, full scan) and
 * {@code sql-indexed} (the same with id as PRIMARY KEY).
 * Add {@code --out results.jsonl} to append a machine readable line per run.
 */
public final class LoadGenerator {

    record Options(String host, int port, String group, String password, String workload,
                   int connections, int pipeline, int durationSeconds, int warmupSeconds,
                   int keys, int valueSize, int sqlRows, String label, Path out) {

        static Options parse(String[] args) {
            Map<String, String> map = new LinkedHashMap<>();
            for (int i = 0; i < args.length; i++) {
                String arg = args[i];
                if (!arg.startsWith("--")) {
                    throw new IllegalArgumentException("Unexpected argument: " + arg);
                }
                if (arg.equals("--help")) {
                    map.put("help", "true");
                    continue;
                }
                if (i + 1 >= args.length) {
                    throw new IllegalArgumentException("Missing value for " + arg);
                }
                map.put(arg.substring(2), args[++i]);
            }
            if (map.containsKey("help")) {
                usage();
                System.exit(0);
            }
            String out = map.get("out");
            return new Options(
                    map.getOrDefault("host", "127.0.0.1"),
                    Integer.parseInt(map.getOrDefault("port", "5142")),
                    map.getOrDefault("group", env("DENIS_GROUP", "bench")),
                    map.getOrDefault("password", env("DENIS_PASSWORD", "bench")),
                    map.getOrDefault("workload", "mixed").toLowerCase(Locale.ROOT),
                    Integer.parseInt(map.getOrDefault("connections", "8")),
                    Integer.parseInt(map.getOrDefault("pipeline", "16")),
                    Integer.parseInt(map.getOrDefault("duration", "10")),
                    Integer.parseInt(map.getOrDefault("warmup", "3")),
                    Integer.parseInt(map.getOrDefault("keys", "10000")),
                    Integer.parseInt(map.getOrDefault("value-size", "64")),
                    Integer.parseInt(map.getOrDefault("sql-rows", "1000")),
                    map.getOrDefault("label", ""),
                    out == null ? null : Paths.get(out));
        }

        private static String env(String name, String fallback) {
            String value = System.getenv(name);
            return value == null || value.isBlank() ? fallback : value;
        }
    }

    private static void usage() {
        System.out.println("""
                Denis load generator
                  --host <h>            default 127.0.0.1
                  --port <p>            default 5142
                  --group <g>           login group (env DENIS_GROUP, default bench)
                  --password <p>        its password (env DENIS_PASSWORD, default bench)
                  --workload <w>        set | get | mixed | persist | sql | sql-indexed  (default mixed)
                  --connections <n>     parallel connections (default 8)
                  --pipeline <n>        commands in flight per connection (default 16)
                  --duration <s>        measured seconds (default 10)
                  --warmup <s>          unmeasured seconds before (default 3)
                  --keys <n>            key space (default 10000)
                  --value-size <n>      bytes per value (default 64)
                  --sql-rows <n>        rows in the sql workload table (default 1000)
                  --label <text>        free text stored with the result
                  --out <file.jsonl>    append the result as one JSON line
                """);
    }

    /** Latency histogram with 1 µs buckets up to 1 s; merged across threads at the end. */
    static final class Histogram {
        private static final int MAX_MICROS = 1_000_000;
        private final long[] counts = new long[MAX_MICROS + 1];
        private long total;
        private long max;

        void record(long micros) {
            int bucket = (int) Math.min(Math.max(micros, 0), MAX_MICROS);
            counts[bucket]++;
            total++;
            if (micros > max) {
                max = micros;
            }
        }

        void merge(Histogram other) {
            for (int i = 0; i < counts.length; i++) {
                counts[i] += other.counts[i];
            }
            total += other.total;
            max = Math.max(max, other.max);
        }

        long percentile(double p) {
            if (total == 0) {
                return 0;
            }
            long rank = (long) Math.ceil(p / 100.0 * total);
            long seen = 0;
            for (int i = 0; i < counts.length; i++) {
                seen += counts[i];
                if (seen >= rank) {
                    return i;
                }
            }
            return max;
        }

        long total() {
            return total;
        }

        long max() {
            return max;
        }
    }

    /** One logged-in, authenticated connection in {@code MODE json}. */
    static final class Session implements AutoCloseable {
        private final Socket socket;
        private final BufferedReader in;
        private final Writer out;

        Session(Options options, String token) throws IOException {
            socket = new Socket();
            socket.setTcpNoDelay(true);
            socket.connect(new InetSocketAddress(options.host(), options.port()), 5000);
            socket.setSoTimeout(60_000);
            in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8), 1 << 16);
            out = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), 1 << 16);
            expectOk(call("MODE json"), "MODE json");
            expectOk(call("LIN " + options.group() + " " + options.password()), "LIN");
            if (token != null) {
                expectOk(call("AUTH " + token), "AUTH");
            }
        }

        String call(String line) throws IOException {
            out.write(line);
            out.write('\n');
            out.flush();
            String reply = in.readLine();
            if (reply == null) {
                throw new IOException("connection closed by server after: " + line.split(" ")[0]);
            }
            return reply;
        }

        void send(String line) throws IOException {
            out.write(line);
            out.write('\n');
        }

        void flush() throws IOException {
            out.flush();
        }

        String receive() throws IOException {
            String reply = in.readLine();
            if (reply == null) {
                throw new IOException("connection closed by server");
            }
            return reply;
        }

        static void expectOk(String reply, String what) throws IOException {
            if (!reply.contains("\"ok\":true")) {
                throw new IOException(what + " failed: " + reply);
            }
        }

        @Override
        public void close() {
            try {
                out.write("EXIT\n");
                out.flush();
            } catch (IOException ignored) {
                // the server may already be gone
            }
            try {
                socket.close();
            } catch (IOException ignored) {
                // nothing left to do
            }
        }
    }

    private static String value(int size) {
        StringBuilder sb = new StringBuilder(size);
        for (int i = 0; i < size; i++) {
            sb.append((char) ('a' + (i % 26)));
        }
        return sb.toString();
    }

    private static String command(Options options, String value, ThreadLocalRandom random) {
        int key = random.nextInt(options.keys());
        return switch (options.workload()) {
            case "set" -> "SET bench:" + key + " " + value;
            case "get" -> "GET bench:" + key;
            case "persist" -> "SET bench:" + key + " " + value + " -&cache -&save";
            case "mixed" -> random.nextInt(100) < 80 ? "GET bench:" + key : "SET bench:" + key + " " + value;
            case "sql", "sql-indexed" -> "SQL SELECT * FROM bench WHERE id = " + random.nextInt(options.sqlRows());
            default -> throw new IllegalArgumentException("Unknown workload: " + options.workload());
        };
    }

    private static void prefill(Options options, String token) throws IOException {
        try (Session session = new Session(options, token)) {
            String value = value(options.valueSize());
            int batch = 256;
            if (options.workload().startsWith("sql")) {
                session.call("SQL DROP TABLE bench");
                // "sql" works on every server version (full scan); "sql-indexed" needs PRIMARY KEY support (0.1+)
                String ddl = options.workload().equals("sql-indexed")
                        ? "SQL CREATE TABLE bench (id INT PRIMARY KEY, name TEXT)"
                        : "SQL CREATE TABLE bench (id INT, name TEXT)";
                Session.expectOk(session.call(ddl), "CREATE TABLE");
                for (int i = 0; i < options.sqlRows(); i += batch) {
                    int n = Math.min(batch, options.sqlRows() - i);
                    for (int j = 0; j < n; j++) {
                        session.send("SQL INSERT INTO bench (id, name) VALUES (" + (i + j) + ", 'row" + (i + j) + "')");
                    }
                    session.flush();
                    for (int j = 0; j < n; j++) {
                        session.receive();
                    }
                }
                return;
            }
            if (options.workload().equals("get") || options.workload().equals("mixed")) {
                for (int i = 0; i < options.keys(); i += batch) {
                    int n = Math.min(batch, options.keys() - i);
                    for (int j = 0; j < n; j++) {
                        session.send("SET bench:" + (i + j) + " " + value);
                    }
                    session.flush();
                    for (int j = 0; j < n; j++) {
                        session.receive();
                    }
                }
            }
        }
    }

    public static void main(String[] args) throws Exception {
        Options options = Options.parse(args);
        String token;
        try (Session admin = new Session(options, null)) {
            String created = admin.call("AUTH CREATE");
            Session.expectOk(created, "AUTH CREATE");
            int start = created.indexOf("\"token\":\"") + 9;
            token = created.substring(start, created.indexOf('"', start));
        }
        prefill(options, token);

        List<Session> sessions = new ArrayList<>();
        for (int i = 0; i < options.connections(); i++) {
            sessions.add(new Session(options, token));
        }

        AtomicBoolean measuring = new AtomicBoolean(false);
        AtomicBoolean running = new AtomicBoolean(true);
        Histogram[] histograms = new Histogram[options.connections()];
        long[] errors = new long[options.connections()];
        CountDownLatch done = new CountDownLatch(options.connections());
        List<Throwable> failures = new ArrayList<>();
        String value = value(options.valueSize());

        for (int c = 0; c < options.connections(); c++) {
            final int index = c;
            histograms[index] = new Histogram();
            Thread worker = new Thread(() -> {
                Session session = sessions.get(index);
                Histogram histogram = histograms[index];
                ThreadLocalRandom random = ThreadLocalRandom.current();
                try {
                    while (running.get()) {
                        for (int i = 0; i < options.pipeline(); i++) {
                            session.send(command(options, value, random));
                        }
                        long sent = System.nanoTime();
                        session.flush();
                        boolean record = measuring.get();
                        for (int i = 0; i < options.pipeline(); i++) {
                            String reply = session.receive();
                            if (record) {
                                histogram.record((System.nanoTime() - sent) / 1_000);
                                if (reply.startsWith("{\"ok\":false") && !reply.contains("not found")) {
                                    errors[index]++;
                                }
                            }
                        }
                    }
                } catch (Throwable t) {
                    synchronized (failures) {
                        failures.add(t);
                    }
                } finally {
                    done.countDown();
                }
            }, "bench-" + index);
            worker.setDaemon(true);
            worker.start();
        }

        Thread.sleep(options.warmupSeconds() * 1000L);
        measuring.set(true);
        long measureStart = System.nanoTime();
        Thread.sleep(options.durationSeconds() * 1000L);
        measuring.set(false);
        long elapsedNanos = System.nanoTime() - measureStart;
        running.set(false);
        done.await();
        sessions.forEach(Session::close);

        if (!failures.isEmpty()) {
            System.err.println("Worker failures: " + failures.size() + ", first: " + failures.get(0));
        }

        Histogram all = new Histogram();
        long errorCount = 0;
        for (int i = 0; i < histograms.length; i++) {
            all.merge(histograms[i]);
            errorCount += errors[i];
        }
        double seconds = elapsedNanos / 1e9;
        double throughput = all.total() / seconds;

        System.out.printf(Locale.ROOT, "%-8s conns=%d pipeline=%d value=%dB  %,12.0f ops/s  p50=%dus p99=%dus p99.9=%dus max=%dus  ops=%d errors=%d%n",
                options.workload(), options.connections(), options.pipeline(), options.valueSize(), throughput,
                all.percentile(50), all.percentile(99), all.percentile(99.9), all.max(), all.total(), errorCount);

        if (options.out() != null) {
            String line = String.format(Locale.ROOT,
                    "{\"time\":\"%s\",\"label\":\"%s\",\"workload\":\"%s\",\"connections\":%d,\"pipeline\":%d,"
                            + "\"valueSize\":%d,\"keys\":%d,\"opsPerSec\":%.1f,\"p50us\":%d,\"p99us\":%d,\"p999us\":%d,"
                            + "\"maxUs\":%d,\"ops\":%d,\"errors\":%d}%n",
                    Instant.now(), options.label().replace("\"", "'"), options.workload(), options.connections(),
                    options.pipeline(), options.valueSize(), options.keys(), throughput, all.percentile(50),
                    all.percentile(99), all.percentile(99.9), all.max(), all.total(), errorCount);
            Path parent = options.out().toAbsolutePath().getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(options.out(), line, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        }
        if (!failures.isEmpty()) {
            System.exit(1);
        }
    }
}
