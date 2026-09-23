package github.hacimertgokhan.denis.bench;

import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Markdown comparison of two LoadGenerator result files (JSON lines).
 *
 * <pre>
 *   java -cp denis-benchmarks.jar github.hacimertgokhan.denis.bench.Compare before.jsonl after.jsonl
 * </pre>
 *
 * Runs are matched by workload, connections, pipeline and value size; when a
 * file has several runs of the same shape the last one wins. Shapes present
 * in only one file are listed with a dash on the other side.
 */
public final class Compare {
    private Compare() {
    }

    record Run(String workload, int connections, int pipeline, int valueSize, double opsPerSec, long p50, long p99, long errors) {
        String shape() {
            return String.format(Locale.ROOT, "%s c=%d p=%d %dB", workload, connections, pipeline, valueSize);
        }
    }

    static Map<String, Run> load(Path file) throws IOException {
        Map<String, Run> runs = new LinkedHashMap<>();
        for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
            if (line.isBlank()) {
                continue;
            }
            JSONObject o = new JSONObject(line);
            Run run = new Run(o.getString("workload"), o.getInt("connections"), o.getInt("pipeline"),
                    o.optInt("valueSize", 64), o.getDouble("opsPerSec"), o.getLong("p50us"), o.getLong("p99us"),
                    o.optLong("errors", 0));
            runs.put(run.shape(), run);
        }
        return runs;
    }

    public static void main(String[] args) throws IOException {
        if (args.length != 2) {
            System.err.println("Usage: Compare <before.jsonl> <after.jsonl>");
            System.exit(2);
        }
        Map<String, Run> before = load(Paths.get(args[0]));
        Map<String, Run> after = load(Paths.get(args[1]));
        List<String> shapes = new ArrayList<>(before.keySet());
        after.keySet().stream().filter(s -> !before.containsKey(s)).forEach(shapes::add);

        System.out.println("| workload | before ops/s | after ops/s | speed-up | p99 before | p99 after | errors before/after |");
        System.out.println("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
        for (String shape : shapes) {
            Run b = before.get(shape);
            Run a = after.get(shape);
            String speedUp = b != null && a != null && b.opsPerSec() > 0 && b.errors() == 0
                    ? String.format(Locale.ROOT, "%.1f×", a.opsPerSec() / b.opsPerSec())
                    : "–";
            System.out.printf(Locale.ROOT, "| %s | %s | %s | %s | %s | %s | %s/%s |%n", shape,
                    b == null ? "–" : String.format(Locale.ROOT, "%,.0f", b.opsPerSec()),
                    a == null ? "–" : String.format(Locale.ROOT, "%,.0f", a.opsPerSec()),
                    speedUp,
                    b == null ? "–" : b.p99() + " µs",
                    a == null ? "–" : a.p99() + " µs",
                    b == null ? "–" : String.valueOf(b.errors()),
                    a == null ? "–" : String.valueOf(a.errors()));
        }
    }
}
