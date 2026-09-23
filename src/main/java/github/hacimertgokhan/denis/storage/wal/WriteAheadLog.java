package github.hacimertgokhan.denis.storage.wal;

import github.hacimertgokhan.logger.DenisLogger;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Segmented, append-only write-ahead log with a single writer thread.
 *
 * <p>Producers encode a record on their own thread and hand the bytes to a
 * bounded queue; the writer drains everything that is queued, writes it with
 * one {@code write} call per buffer and — depending on the {@link FsyncPolicy}
 * — one {@code fsync} for the whole batch (group commit). The bounded queue is
 * the back-pressure: when the disk cannot keep up, producers wait instead of
 * the heap filling up.
 *
 * <p>Segments are files {@code wal-<20 digit id>.log}. The log rotates to a new
 * segment when one grows past the size limit and whenever a checkpoint asks
 * for it; a checkpoint may then delete every segment older than the one it
 * started. There are no lock files: the log directory belongs to the process
 * that bound the server port.
 *
 * <p>An I/O error (disk full, device gone) puts the log into a failed state:
 * pending and new appends fail, so durable writes are refused rather than
 * silently lost, until {@link #recover()} succeeds.
 */
public final class WriteAheadLog implements AutoCloseable {
    private static final DenisLogger log = new DenisLogger(WriteAheadLog.class);
    private static final Pattern SEGMENT = Pattern.compile("wal-(\\d{20})\\.log");
    private static final int WRITE_BUFFER = 256 * 1024;

    private final Path dir;
    private final FsyncPolicy policy;
    private final long segmentBytes;
    private final BlockingQueue<Item> queue;
    private final Thread writer;
    private final ByteBuffer buffer = ByteBuffer.allocateDirect(WRITE_BUFFER);

    private volatile boolean running = true;
    private volatile IOException failure;
    private volatile long currentSegment;
    private FileChannel channel;
    private long segmentSize;
    private boolean dirty;
    private long lastSync = System.nanoTime();

    private final AtomicLong appendedRecords = new AtomicLong();
    private final AtomicLong appendedBytes = new AtomicLong();
    private final AtomicLong fsyncs = new AtomicLong();
    private final AtomicLong batches = new AtomicLong();

    /** One unit of work for the writer: a record, a rotation, or a sync barrier. */
    private static final class Item {
        final byte[] record;
        final CompletableFuture<Long> done;
        final boolean rotate;
        final boolean barrier;

        Item(byte[] record, CompletableFuture<Long> done, boolean rotate, boolean barrier) {
            this.record = record;
            this.done = done;
            this.rotate = rotate;
            this.barrier = barrier;
        }
    }

    /**
     * Opens the log for appending. A new, empty segment is started after the
     * highest existing one, so recovery of old segments and appending never
     * touch the same file.
     */
    public WriteAheadLog(Path dir, FsyncPolicy policy, long segmentBytes, int queueCapacity) throws IOException {
        this.dir = dir;
        this.policy = policy;
        this.segmentBytes = Math.max(64 * 1024, segmentBytes);
        this.queue = new LinkedBlockingQueue<>(Math.max(64, queueCapacity));
        Files.createDirectories(dir);
        List<Long> existing = listSegments(dir);
        currentSegment = existing.isEmpty() ? 1 : existing.get(existing.size() - 1) + 1;
        channel = openSegment(currentSegment);
        writer = new Thread(this::run, "denis-wal-writer");
        writer.setDaemon(true);
        writer.start();
    }

    public static Path segmentPath(Path dir, long id) {
        return dir.resolve(String.format(Locale.ROOT, "wal-%020d.log", id));
    }

    /** Ids of the segment files in {@code dir}, ascending. */
    public static List<Long> listSegments(Path dir) throws IOException {
        List<Long> ids = new ArrayList<>();
        if (!Files.isDirectory(dir)) {
            return ids;
        }
        try (DirectoryStream<Path> files = Files.newDirectoryStream(dir, "wal-*.log")) {
            for (Path file : files) {
                Matcher m = SEGMENT.matcher(file.getFileName().toString());
                if (m.matches()) {
                    ids.add(Long.parseLong(m.group(1)));
                }
            }
        }
        ids.sort(null);
        return ids;
    }

    private FileChannel openSegment(long id) throws IOException {
        FileChannel ch = FileChannel.open(segmentPath(dir, id),
                StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.APPEND);
        segmentSize = ch.size();
        syncDirectory(dir);
        return ch;
    }

    /**
     * Queue a framed record. With {@link FsyncPolicy#ALWAYS} the future
     * completes after the record is on stable storage; otherwise after it was
     * handed to the OS. Blocks while the queue is full (back-pressure).
     */
    public CompletableFuture<Long> append(byte[] record) {
        IOException failed = failure;
        if (failed != null || !running) {
            return CompletableFuture.failedFuture(failed != null ? failed : new IOException("write-ahead log is closed"));
        }
        CompletableFuture<Long> done = new CompletableFuture<>();
        enqueue(new Item(record, done, false, false));
        return done;
    }

    /** Like {@link #append(byte[])} but without a completion; the cheap path for asynchronous durability. */
    public void appendNoWait(byte[] record) throws IOException {
        IOException failed = failure;
        if (failed != null) {
            throw failed;
        }
        if (!running) {
            throw new IOException("write-ahead log is closed");
        }
        enqueue(new Item(record, null, false, false));
    }

    private void enqueue(Item item) {
        boolean interrupted = false;
        while (true) {
            try {
                queue.put(item);
                break;
            } catch (InterruptedException e) {
                interrupted = true;
            }
        }
        if (interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Close the current segment and start the next one. Every record queued
     * before this call ends up in an older segment.
     *
     * @return id of the new segment
     */
    public CompletableFuture<Long> rotate() {
        CompletableFuture<Long> done = new CompletableFuture<>();
        if (!running) {
            done.completeExceptionally(new IOException("write-ahead log is closed"));
            return done;
        }
        enqueue(new Item(null, done, true, false));
        return done;
    }

    /** Completes once everything queued before it is written and fsynced. */
    public CompletableFuture<Long> sync() {
        CompletableFuture<Long> done = new CompletableFuture<>();
        if (!running) {
            done.complete(currentSegment);
            return done;
        }
        enqueue(new Item(null, done, false, true));
        return done;
    }

    public boolean isHealthy() {
        return failure == null && running;
    }

    public IOException failure() {
        return failure;
    }

    /** Try to leave the failed state by starting a fresh segment. Callers checkpoint afterwards. */
    public synchronized boolean recover() {
        if (failure == null) {
            return true;
        }
        CompletableFuture<Long> rotated = new CompletableFuture<>();
        // the writer thread owns the channel; it clears the failure when the rotation works
        queue.offer(new Item(null, rotated, true, false));
        try {
            rotated.get(5, TimeUnit.SECONDS);
            return failure == null;
        } catch (Exception e) {
            return false;
        }
    }

    public long currentSegment() {
        return currentSegment;
    }

    public Path directory() {
        return dir;
    }

    public FsyncPolicy policy() {
        return policy;
    }

    /** Delete segments with an id lower than {@code id}; used after a checkpoint made them redundant. */
    public void deleteSegmentsBefore(long id) throws IOException {
        for (long segment : listSegments(dir)) {
            if (segment < id) {
                Files.deleteIfExists(segmentPath(dir, segment));
            }
        }
    }

    /** Bytes in all segment files (what recovery would have to replay without a snapshot). */
    public long totalBytes() {
        long total = 0;
        try {
            for (long segment : listSegments(dir)) {
                total += Files.size(segmentPath(dir, segment));
            }
        } catch (IOException ignored) {
            // a segment deleted concurrently by a checkpoint
        }
        return total;
    }

    public long appendedRecords() {
        return appendedRecords.get();
    }

    public long appendedBytes() {
        return appendedBytes.get();
    }

    public long fsyncCount() {
        return fsyncs.get();
    }

    public long batchCount() {
        return batches.get();
    }

    public int queued() {
        return queue.size();
    }

    // ------------------------------------------------------------------ writer thread

    private void run() {
        List<Item> batch = new ArrayList<>(1024);
        List<CompletableFuture<Long>> completions = new ArrayList<>(1024);
        while (running || !queue.isEmpty()) {
            try {
                Item first = queue.poll(policy == FsyncPolicy.EVERYSEC ? 200 : 1000, TimeUnit.MILLISECONDS);
                if (first == null) {
                    periodicSync();
                    continue;
                }
                batch.add(first);
                queue.drainTo(batch, 8191);
                processBatch(batch, completions);
            } catch (InterruptedException e) {
                if (!running) {
                    break;
                }
            } catch (Throwable t) {
                log.error("Write-ahead log writer error: " + t.getMessage(), t);
            } finally {
                batch.clear();
                completions.clear();
            }
        }
        try {
            flushBuffer();
            if (channel != null && channel.isOpen()) {
                channel.force(false);
                channel.close();
            }
        } catch (IOException e) {
            log.error("Could not close write-ahead log: " + e.getMessage());
        }
    }

    private void processBatch(List<Item> batch, List<CompletableFuture<Long>> completions) {
        boolean needSync = policy == FsyncPolicy.ALWAYS;
        batches.incrementAndGet();
        for (Item item : batch) {
            try {
                if (item.rotate) {
                    doRotate();
                    item.done.complete(currentSegment);
                    continue;
                }
                if (failure != null) {
                    if (item.done != null) {
                        item.done.completeExceptionally(failure);
                    }
                    continue;
                }
                if (item.barrier) {
                    needSync = true;
                } else {
                    write(item.record);
                }
                if (item.done != null) {
                    completions.add(item.done);
                }
            } catch (IOException e) {
                fail(e);
                if (item.done != null) {
                    item.done.completeExceptionally(e);
                }
            }
        }
        try {
            if (failure == null) {
                flushBuffer();
                if (needSync && dirty) {
                    channel.force(false);
                    fsyncs.incrementAndGet();
                    dirty = false;
                    lastSync = System.nanoTime();
                } else {
                    periodicSync();
                }
                if (segmentSize >= segmentBytes) {
                    doRotate();
                }
            }
        } catch (IOException e) {
            fail(e);
        }
        IOException failed = failure;
        for (CompletableFuture<Long> done : completions) {
            if (failed != null) {
                done.completeExceptionally(failed);
            } else {
                done.complete(currentSegment);
            }
        }
    }

    private void write(byte[] record) throws IOException {
        if (record.length > buffer.remaining()) {
            flushBuffer();
        }
        if (record.length > buffer.capacity()) {
            ByteBuffer big = ByteBuffer.wrap(record);
            while (big.hasRemaining()) {
                channel.write(big);
            }
        } else {
            buffer.put(record);
        }
        segmentSize += record.length;
        dirty = true;
        appendedRecords.incrementAndGet();
        appendedBytes.addAndGet(record.length);
    }

    private void flushBuffer() throws IOException {
        if (buffer.position() == 0 || channel == null) {
            return;
        }
        buffer.flip();
        while (buffer.hasRemaining()) {
            channel.write(buffer);
        }
        buffer.clear();
    }

    private void periodicSync() {
        if (policy != FsyncPolicy.EVERYSEC || !dirty || failure != null) {
            return;
        }
        if (System.nanoTime() - lastSync >= TimeUnit.SECONDS.toNanos(1)) {
            try {
                flushBuffer();
                channel.force(false);
                fsyncs.incrementAndGet();
                dirty = false;
                lastSync = System.nanoTime();
            } catch (IOException e) {
                fail(e);
            }
        }
    }

    private void doRotate() throws IOException {
        if (failure == null && channel != null && channel.isOpen()) {
            flushBuffer();
            channel.force(false);
            fsyncs.incrementAndGet();
            channel.close();
        } else if (channel != null) {
            buffer.clear();
            try {
                channel.close();
            } catch (IOException ignored) {
                // the old channel is broken anyway
            }
        }
        long next = currentSegment + 1;
        channel = openSegment(next);
        currentSegment = next;
        dirty = false;
        if (failure != null) {
            log.info("Write-ahead log recovered, continuing in segment " + next);
            failure = null;
        }
    }

    private void fail(IOException e) {
        if (failure == null) {
            log.error("Write-ahead log failed, durable writes are refused until it recovers: " + e.getMessage());
        }
        failure = e;
        buffer.clear();
    }

    /** fsync the directory so a newly created or renamed file survives a crash (no-op where unsupported). */
    public static void syncDirectory(Path dir) {
        try (FileChannel ch = FileChannel.open(dir, StandardOpenOption.READ)) {
            ch.force(true);
        } catch (IOException | UnsupportedOperationException ignored) {
            // Windows cannot open directories; NTFS journals the metadata itself
        }
    }

    @Override
    public void close() {
        if (!running) {
            return;
        }
        CompletableFuture<Long> last = sync();
        try {
            last.get(10, TimeUnit.SECONDS);
        } catch (Exception e) {
            log.warn("Final write-ahead log sync did not complete: " + e.getMessage());
        }
        running = false;
        writer.interrupt();
        try {
            writer.join(10_000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
