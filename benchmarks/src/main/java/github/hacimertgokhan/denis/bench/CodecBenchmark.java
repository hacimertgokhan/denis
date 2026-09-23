package github.hacimertgokhan.denis.bench;

import github.hacimertgokhan.denis.storage.codec.ByteSink;
import github.hacimertgokhan.denis.storage.codec.Mutation;
import github.hacimertgokhan.denis.storage.codec.MutationCodec;
import org.openjdk.jmh.annotations.Benchmark;
import org.openjdk.jmh.annotations.BenchmarkMode;
import org.openjdk.jmh.annotations.Fork;
import org.openjdk.jmh.annotations.Measurement;
import org.openjdk.jmh.annotations.Mode;
import org.openjdk.jmh.annotations.OutputTimeUnit;
import org.openjdk.jmh.annotations.Scope;
import org.openjdk.jmh.annotations.State;
import org.openjdk.jmh.annotations.Warmup;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

/** Cost of framing, checksumming and decoding one log record. */
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.SECONDS)
@Warmup(iterations = 2, time = 2)
@Measurement(iterations = 3, time = 2)
@Fork(1)
@State(Scope.Thread)
public class CodecBenchmark {
    private final Mutation.Put put = new Mutation.Put(1, "user:12345", "v".repeat(64));
    private final Mutation.PutRow row = new Mutation.PutRow(1, "readings", 123456, new Object[]{123456L, "s12", 1790000000L, 21.5});
    private final ByteSink scratch = new ByteSink(256);
    private final ByteSink out = new ByteSink(256);
    private final byte[] encodedPut = MutationCodec.encodeRecord(put);

    @Benchmark
    public int encodePut() {
        out.reset();
        MutationCodec.encodeRecord(put, scratch, out);
        return out.size();
    }

    @Benchmark
    public int encodeRow() {
        out.reset();
        MutationCodec.encodeRecord(row, scratch, out);
        return out.size();
    }

    @Benchmark
    public Mutation decodePut() throws IOException {
        return new MutationCodec.RecordReader(new ByteArrayInputStream(encodedPut)).next();
    }
}
