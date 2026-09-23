package github.hacimertgokhan.denis.server;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.LongAdder;

/** Connection and command counters for INFO. Striped counters, so counting never contends. */
public final class ServerMetrics {
    public final AtomicInteger connected = new AtomicInteger();
    public final LongAdder accepted = new LongAdder();
    public final LongAdder rejected = new LongAdder();
    public final LongAdder commands = new LongAdder();
    public final LongAdder errors = new LongAdder();
    public final LongAdder bytesIn = new LongAdder();
    public final LongAdder bytesOut = new LongAdder();
    public final LongAdder loginFailures = new LongAdder();
    public final LongAdder busyRejections = new LongAdder();
    public final long startedAt = System.currentTimeMillis();

    private volatile long lastSampleTime = System.nanoTime();
    private volatile long lastSampleCommands;
    private volatile double opsPerSecond;

    /** Recompute the command rate; called once per second by the server. */
    public void sample() {
        long now = System.nanoTime();
        long total = commands.sum();
        double seconds = (now - lastSampleTime) / 1e9;
        if (seconds > 0) {
            opsPerSecond = (total - lastSampleCommands) / seconds;
        }
        lastSampleTime = now;
        lastSampleCommands = total;
    }

    public double opsPerSecond() {
        return opsPerSecond;
    }
}
