package github.hacimertgokhan.denis.storage.wal;

import github.hacimertgokhan.denis.storage.codec.CorruptRecordException;
import github.hacimertgokhan.denis.storage.codec.Mutation;
import github.hacimertgokhan.denis.storage.codec.MutationCodec;
import github.hacimertgokhan.logger.DenisLogger;

import java.io.BufferedInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.function.Consumer;

/**
 * Replays log segments in order. Only the newest segment can legitimately end
 * in a partial record (the process died mid-write); it is cut back to its last
 * intact record. Damage anywhere else means lost history and stops recovery
 * unless {@code lenient} is set, because silently skipping it would bring the
 * database up with data missing.
 */
public final class WalReplayer {
    private static final DenisLogger log = new DenisLogger(WalReplayer.class);

    /** What recovery found. */
    public record Result(int segments, long records, long bytes, long truncatedBytes, int damagedSegments) {}

    private WalReplayer() {
    }

    public static Result replay(Path dir, long fromSegment, boolean lenient, Consumer<Mutation> apply) throws IOException {
        List<Long> segments = WriteAheadLog.listSegments(dir);
        int replayed = 0;
        long records = 0;
        long bytes = 0;
        long truncated = 0;
        int damaged = 0;
        for (int i = 0; i < segments.size(); i++) {
            long id = segments.get(i);
            if (id < fromSegment) {
                continue;
            }
            boolean last = i == segments.size() - 1;
            Path file = WriteAheadLog.segmentPath(dir, id);
            long size = Files.size(file);
            long good;
            String problem = null;
            try (InputStream in = new BufferedInputStream(Files.newInputStream(file), 64 * 1024)) {
                MutationCodec.RecordReader reader = new MutationCodec.RecordReader(in);
                try {
                    Mutation mutation;
                    while ((mutation = reader.next()) != null) {
                        apply.accept(mutation);
                        records++;
                    }
                } catch (EOFException | CorruptRecordException e) {
                    problem = e.getMessage();
                }
                good = reader.offset();
            }
            replayed++;
            bytes += good;
            if (problem != null) {
                long lost = size - good;
                if (last || lenient) {
                    log.warn(String.format("WAL segment %d: %s at byte %d; cutting %d trailing bytes (%s)",
                            id, problem, good, lost, last ? "interrupted write" : "lenient recovery"));
                    truncate(file, good);
                    truncated += lost;
                    if (!last) {
                        damaged++;
                    }
                } else {
                    throw new IOException(String.format(
                            "WAL segment %s is damaged at byte %d (%s) and is not the newest segment. "
                                    + "Restore a backup, or start with recovery=lenient to keep what can be read.",
                            file.getFileName(), good, problem));
                }
            }
        }
        return new Result(replayed, records, bytes, truncated, damaged);
    }

    private static void truncate(Path file, long size) throws IOException {
        try (FileChannel ch = FileChannel.open(file, StandardOpenOption.WRITE)) {
            ch.truncate(size);
            ch.force(true);
        }
    }
}
