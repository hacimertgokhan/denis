package github.hacimertgokhan.denis.bench;

import github.hacimertgokhan.denis.storage.Keyspace;
import github.hacimertgokhan.denis.storage.StorageConfig;
import github.hacimertgokhan.denis.storage.StorageEngine;
import github.hacimertgokhan.denis.storage.wal.FsyncPolicy;
import org.openjdk.jmh.annotations.Benchmark;
import org.openjdk.jmh.annotations.BenchmarkMode;
import org.openjdk.jmh.annotations.Fork;
import org.openjdk.jmh.annotations.Level;
import org.openjdk.jmh.annotations.Measurement;
import org.openjdk.jmh.annotations.Mode;
import org.openjdk.jmh.annotations.OutputTimeUnit;
import org.openjdk.jmh.annotations.Param;
import org.openjdk.jmh.annotations.Scope;
import org.openjdk.jmh.annotations.Setup;
import org.openjdk.jmh.annotations.State;
import org.openjdk.jmh.annotations.TearDown;
import org.openjdk.jmh.annotations.Threads;
import org.openjdk.jmh.annotations.Warmup;
import org.openjdk.jmh.infra.Blackhole;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

/**
 * Storage engine throughput without the network: cache writes, durable writes
 * through the write-ahead log, and reads, single- and multi-threaded.
 */
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.SECONDS)
@Warmup(iterations = 2, time = 2)
@Measurement(iterations = 3, time = 3)
@Fork(1)
@State(Scope.Benchmark)
public class StorageBenchmark {
    private static final int KEYS = 100_000;

    @Param({"everysec"})
    public String fsync;

    private Path dir;
    private StorageEngine engine;
    private Keyspace ks;
    private String[] keys;
    private final String value = "v".repeat(64);

    @Setup(Level.Trial)
    public void setUp() throws IOException {
        dir = Files.createTempDirectory("denis-bench");
        StorageConfig config = StorageConfig.defaults(dir).withFsync(FsyncPolicy.parse(fsync));
        engine = new StorageEngine(config).open();
        ks = engine.keyspace("bench");
        keys = new String[KEYS];
        for (int i = 0; i < KEYS; i++) {
            keys[i] = "key:" + i;
            engine.put(ks, keys[i], value, true, true, 0);
        }
    }

    @TearDown(Level.Trial)
    public void tearDown() throws IOException {
        engine.close();
        try (var walk = Files.walk(dir)) {
            walk.sorted((a, b) -> b.getNameCount() - a.getNameCount()).forEach(p -> p.toFile().delete());
        }
    }

    private String randomKey() {
        return keys[ThreadLocalRandom.current().nextInt(KEYS)];
    }

    @Benchmark
    public void putCache() {
        engine.put(ks, randomKey(), value, true, false, 0);
    }

    @Benchmark
    public void putDurable() {
        engine.put(ks, randomKey(), value, true, true, 0);
    }

    @Benchmark
    public void get(Blackhole bh) {
        bh.consume(engine.read(ks, randomKey()));
    }

    @Benchmark
    @Threads(4)
    public void getConcurrent(Blackhole bh) {
        bh.consume(engine.read(ks, randomKey()));
    }

    @Benchmark
    @Threads(4)
    public void putDurableConcurrent() {
        engine.put(ks, randomKey(), value, true, true, 0);
    }

    @Benchmark
    public void incr(Blackhole bh) {
        bh.consume(engine.incr(ks, "counter", 1, false));
    }
}
