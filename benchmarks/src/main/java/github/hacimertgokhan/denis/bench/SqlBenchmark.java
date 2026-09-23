package github.hacimertgokhan.denis.bench;

import github.hacimertgokhan.denis.sql.SqlEngine;
import github.hacimertgokhan.denis.storage.Keyspace;
import github.hacimertgokhan.denis.storage.StorageConfig;
import github.hacimertgokhan.denis.storage.StorageEngine;
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
import org.openjdk.jmh.annotations.Warmup;

import java.io.IOException;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

/**
 * SQL execution without the network: point lookups through the primary key
 * index vs. a full scan, a range with ORDER BY/LIMIT served by an index, an
 * aggregate, a join and inserts. In-memory storage, so this measures the
 * parser cache, planner and executor.
 */
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.SECONDS)
@Warmup(iterations = 2, time = 2)
@Measurement(iterations = 3, time = 3)
@Fork(1)
@State(Scope.Benchmark)
public class SqlBenchmark {
    @Param({"10000"})
    public int rows;

    private StorageEngine engine;
    private SqlEngine sql;
    private Keyspace ks;

    @Setup(Level.Trial)
    public void setUp() throws IOException {
        engine = new StorageEngine(StorageConfig.inMemory()).open();
        sql = new SqlEngine(engine, 1_000_000);
        ks = engine.keyspace("bench");
        sql.execute(ks, "CREATE TABLE readings (id INTEGER PRIMARY KEY, sensor TEXT, ts INT NOT NULL, value REAL)", null);
        sql.execute(ks, "CREATE INDEX idx_ts ON readings (ts)", null);
        sql.execute(ks, "CREATE TABLE sensors (name TEXT PRIMARY KEY, room TEXT)", null);
        for (int i = 0; i < 50; i++) {
            sql.execute(ks, "INSERT INTO sensors VALUES (?, ?)", new Object[]{"s" + i, "room" + (i % 5)});
        }
        for (int i = 0; i < rows; i++) {
            sql.execute(ks, "INSERT INTO readings (sensor, ts, value) VALUES (?, ?, ?)",
                    new Object[]{"s" + (i % 50), (long) i, i * 0.5});
        }
    }

    @TearDown(Level.Trial)
    public void tearDown() {
        engine.close();
    }

    @Benchmark
    public Object pointLookupByPrimaryKey() {
        return sql.execute(ks, "SELECT * FROM readings WHERE id = ?", new Object[]{(long) ThreadLocalRandom.current().nextInt(1, rows)});
    }

    @Benchmark
    public Object pointLookupFullScan() {
        return sql.execute(ks, "SELECT * FROM readings WHERE value = ?", new Object[]{(double) ThreadLocalRandom.current().nextInt(rows) * 0.5});
    }

    @Benchmark
    public Object latestTenByIndex() {
        return sql.execute(ks, "SELECT ts, value FROM readings WHERE ts > ? ORDER BY ts DESC LIMIT 10", new Object[]{(long) rows / 2});
    }

    @Benchmark
    public Object groupByAggregate() {
        return sql.execute(ks, "SELECT sensor, COUNT(*), AVG(value) FROM readings GROUP BY sensor", null);
    }

    @Benchmark
    public Object joinWithIndex() {
        return sql.execute(ks, "SELECT r.id, s.room FROM readings r JOIN sensors s ON s.name = r.sensor WHERE r.id = ?",
                new Object[]{(long) ThreadLocalRandom.current().nextInt(1, rows)});
    }

    @Benchmark
    public Object insert() {
        return sql.execute(ks, "INSERT INTO sensors (name, room) VALUES (?, 'x')",
                new Object[]{"n" + ThreadLocalRandom.current().nextLong()});
    }
}
