package github.hacimertgokhan.drivers;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;

/**
 * Throughput against a live server (not a unit test). Build the test classes, then:
 * <pre>
 *   mvn -q test-compile
 *   java -cp target/classes:target/test-classes github.hacimertgokhan.drivers.PipelineBenchmark [ops]
 * </pre>
 * (use {@code ;} as the class path separator on Windows). Reads DENIS_HOST,
 * DENIS_PORT, DENIS_GROUP and DENIS_PASSWORD like the integration test, works
 * in a fresh project and deletes it afterwards.
 */
public final class PipelineBenchmark {
    private PipelineBenchmark() {
    }

    public static void main(String[] args) throws Exception {
        int ops = args.length > 0 ? Integer.parseInt(args[0]) : 200_000;
        String host = DenisClientIntegrationTest.env("DENIS_HOST", "127.0.0.1");
        int port = Integer.parseInt(DenisClientIntegrationTest.env("DENIS_PORT", "5142"));
        String group = DenisClientIntegrationTest.env("DENIS_GROUP", "ci");
        String password = DenisClientIntegrationTest.env("DENIS_PASSWORD", "ci-password");
        String value = "v".repeat(32);

        try (DenisClient client = DenisClient.builder().host(host).port(port).credentials(group, password)
                .createProject(true).poolSize(4).build()) {
            System.out.printf("Denis %s at %s:%d, %d ops per scenario, 32-byte values, pool of 4 connections%n",
                    client.hello().version(), host, port, ops);
            try {
                // warm-up (JIT)
                runPipeline(client, 50_000, 1000, value);
                runAsync(client, 50_000, 4096, value);

                int syncOps = Math.min(ops, 20_000);
                long t0 = System.nanoTime();
                for (int i = 0; i < syncOps; i++) {
                    client.set("sync:" + i, value);
                }
                report("sync SET, 1 thread (one round trip each)", syncOps, t0);

                t0 = System.nanoTime();
                runThreads(client, 16, syncOps * 4, value);
                report("sync SET, 16 threads sharing one client", syncOps * 4, t0);

                t0 = System.nanoTime();
                runPipeline(client, ops, 1000, value);
                report("Pipeline SET, batches of 1000", ops, t0);

                t0 = System.nanoTime();
                runPipelineGet(client, ops, 1000);
                report("Pipeline GET, batches of 1000", ops, t0);

                t0 = System.nanoTime();
                runAsync(client, ops, 4096, value);
                report("async SET, max 4096 in flight, 1 thread", ops, t0);

                t0 = System.nanoTime();
                runAsync(client, ops, Integer.MAX_VALUE, value);
                report("async SET, unbounded, 1 thread", ops, t0);

                t0 = System.nanoTime();
                List<CompletableFuture<Long>> incrs = new ArrayList<>(ops);
                Semaphore window = new Semaphore(4096);
                for (int i = 0; i < ops; i++) {
                    window.acquireUninterruptibly();
                    CompletableFuture<Long> f = client.async().incr("bench:counter");
                    f.whenComplete((v, e) -> window.release());
                    incrs.add(f);
                }
                CompletableFuture.allOf(incrs.toArray(new CompletableFuture<?>[0])).join();
                report("async INCR (one hot key), 4096 in flight", ops, t0);
                if (!client.get("bench:counter").equals(Long.toString(ops + 0L))) {
                    throw new IllegalStateException("counter mismatch: " + client.get("bench:counter"));
                }
            } finally {
                client.deleteProject(client.token());
            }
        }
    }

    private static void runPipeline(DenisClient client, int ops, int batch, String value) {
        Pipeline p = client.pipeline();
        for (int i = 0; i < ops; i++) {
            p.set("pipe:" + i, value);
            if (p.size() == batch) {
                p.execute();
            }
        }
        p.execute();
    }

    private static void runPipelineGet(DenisClient client, int ops, int batch) {
        Pipeline p = client.pipeline();
        for (int i = 0; i < ops; i++) {
            p.get("pipe:" + i);
            if (p.size() == batch) {
                p.execute();
            }
        }
        p.execute();
    }

    private static void runAsync(DenisClient client, int ops, int inFlight, String value) {
        Semaphore window = new Semaphore(inFlight);
        List<CompletableFuture<Void>> all = new ArrayList<>(ops);
        for (int i = 0; i < ops; i++) {
            window.acquireUninterruptibly();
            CompletableFuture<Void> f = client.async().set("async:" + i, value);
            f.whenComplete((v, e) -> window.release());
            all.add(f);
        }
        CompletableFuture.allOf(all.toArray(new CompletableFuture<?>[0])).join();
    }

    private static void runThreads(DenisClient client, int threads, int ops, String value) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Future<?>> tasks = new ArrayList<>();
        int per = ops / threads;
        for (int t = 0; t < threads; t++) {
            int id = t;
            tasks.add(pool.submit(() -> {
                for (int i = 0; i < per; i++) {
                    client.set("mt:" + id + ":" + i, value);
                }
                return null;
            }));
        }
        for (Future<?> f : tasks) {
            f.get();
        }
        pool.shutdown();
    }

    private static void report(String label, int ops, long startNanos) {
        double seconds = (System.nanoTime() - startNanos) / 1e9;
        System.out.printf("  %-45s %,10.0f ops/s  (%,d ops in %.2f s)%n", label, ops / seconds, ops, seconds);
    }
}
