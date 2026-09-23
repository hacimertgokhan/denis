package github.hacimertgokhan.denis.storage.snapshot;

import github.hacimertgokhan.denis.storage.codec.ByteSink;
import github.hacimertgokhan.denis.storage.codec.ByteSource;
import github.hacimertgokhan.denis.storage.codec.CorruptRecordException;
import github.hacimertgokhan.denis.storage.codec.Mutation;
import github.hacimertgokhan.denis.storage.codec.MutationCodec;
import github.hacimertgokhan.denis.storage.wal.WriteAheadLog;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.function.Consumer;
import java.util.zip.Deflater;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.InflaterInputStream;

/**
 * Point-in-time image of the database as a stream of {@link Mutation}s.
 *
 * <pre>
 *   header := "DENISSNP" version:u8 flags:u8 walStart:i64 createdAtMillis:i64
 *   body   := record* End(count)          (deflated when flags &amp; 1)
 * </pre>
 *
 * {@code walStart} is the first log segment that is <em>not</em> covered by the
 * snapshot; recovery loads the snapshot and replays segments from there.
 * Snapshots are written to a temporary file, fsynced and atomically renamed,
 * so a crash during a checkpoint leaves the previous snapshot in place. Records
 * are streamed in both directions, so a snapshot never has to fit in memory
 * as one blob.
 */
public final class SnapshotFile {
    private static final byte[] MAGIC = "DENISSNP".getBytes(StandardCharsets.US_ASCII);
    private static final int VERSION = 1;
    private static final int FLAG_DEFLATE = 1;
    private static final int HEADER_BYTES = MAGIC.length + 2 + 16;

    /** Header of a snapshot plus what reading it produced. */
    public record Info(long walStart, long createdAtMillis, boolean compressed, long records, long fileBytes) {}

    /** Something that can emit the full state as mutations. */
    @FunctionalInterface
    public interface Source {
        void emit(Consumer<Mutation> sink) throws IOException;
    }

    private SnapshotFile() {
    }

    /**
     * Write {@code source} to {@code target} atomically.
     *
     * @return information about the written snapshot
     */
    public static Info write(Path target, long walStart, boolean compress, Source source) throws IOException {
        Path dir = target.toAbsolutePath().getParent();
        Files.createDirectories(dir);
        Path tmp = dir.resolve(target.getFileName() + ".tmp");
        long createdAt = System.currentTimeMillis();
        long[] count = {0};
        try (FileChannel channel = FileChannel.open(tmp, StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING)) {
            OutputStream raw = Channels.newOutputStream(channel);
            ByteSink header = new ByteSink(HEADER_BYTES);
            header.writeBytes(MAGIC).writeByte(VERSION).writeByte(compress ? FLAG_DEFLATE : 0)
                    .writeLong(walStart).writeLong(createdAt);
            raw.write(header.array(), 0, header.size());

            Deflater deflater = compress ? new Deflater(Deflater.BEST_SPEED) : null;
            try {
                OutputStream body = compress
                        ? new DeflaterOutputStream(raw, deflater, 64 * 1024)
                        : raw;
                BufferedOutputStream out = new BufferedOutputStream(body, 128 * 1024);
                ByteSink scratch = new ByteSink(256);
                ByteSink record = new ByteSink(256);
                IOException[] error = {null};
                source.emit(mutation -> {
                    if (error[0] != null) {
                        return;
                    }
                    try {
                        record.reset();
                        MutationCodec.encodeRecord(mutation, scratch, record);
                        out.write(record.array(), 0, record.size());
                        count[0]++;
                    } catch (IOException e) {
                        error[0] = e;
                    }
                });
                if (error[0] != null) {
                    throw error[0];
                }
                record.reset();
                MutationCodec.encodeRecord(new Mutation.End(count[0]), scratch, record);
                out.write(record.array(), 0, record.size());
                out.flush();
                if (body instanceof DeflaterOutputStream deflated) {
                    deflated.finish();
                }
                raw.flush();
            } finally {
                if (deflater != null) {
                    deflater.end();
                }
            }
            channel.force(true);
        } catch (IOException | RuntimeException e) {
            Files.deleteIfExists(tmp);
            throw e;
        }
        try {
            Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
        WriteAheadLog.syncDirectory(dir);
        return new Info(walStart, createdAt, compress, count[0], Files.size(target));
    }

    /** Reads only the header. */
    public static Info readHeader(Path file) throws IOException {
        try (InputStream in = Files.newInputStream(file)) {
            return header(in, Files.size(file));
        }
    }

    private static Info header(InputStream in, long size) throws IOException {
        byte[] head = in.readNBytes(HEADER_BYTES);
        if (head.length < HEADER_BYTES || !Arrays.equals(Arrays.copyOf(head, MAGIC.length), MAGIC)) {
            throw new IOException("not a Denis snapshot");
        }
        ByteSource source = new ByteSource(head, MAGIC.length, HEADER_BYTES - MAGIC.length);
        int version = source.readByte();
        if (version != VERSION) {
            throw new IOException("unsupported snapshot version " + version);
        }
        int flags = source.readByte();
        long walStart = source.readLong();
        long createdAt = source.readLong();
        return new Info(walStart, createdAt, (flags & FLAG_DEFLATE) != 0, 0, size);
    }

    /**
     * Stream every mutation of the snapshot into {@code apply}.
     *
     * @throws IOException when the file is damaged or incomplete
     */
    public static Info read(Path file, Consumer<Mutation> apply) throws IOException {
        long size = Files.size(file);
        try (InputStream raw = new BufferedInputStream(Files.newInputStream(file), 64 * 1024)) {
            Info header = header(raw, size);
            InputStream body = header.compressed() ? new InflaterInputStream(raw, new java.util.zip.Inflater(), 64 * 1024) : raw;
            MutationCodec.RecordReader reader = new MutationCodec.RecordReader(new BufferedInputStream(body, 64 * 1024));
            long records = 0;
            try {
                Mutation mutation;
                while ((mutation = reader.next()) != null) {
                    if (mutation instanceof Mutation.End end) {
                        if (end.count() != records) {
                            throw new IOException("snapshot record count mismatch: " + records + " != " + end.count());
                        }
                        return new Info(header.walStart(), header.createdAtMillis(), header.compressed(), records, size);
                    }
                    apply.accept(mutation);
                    records++;
                }
            } catch (EOFException | CorruptRecordException e) {
                throw new IOException("snapshot " + file.getFileName() + " is damaged: " + e.getMessage(), e);
            }
            throw new IOException("snapshot " + file.getFileName() + " is incomplete (no end record)");
        }
    }
}
