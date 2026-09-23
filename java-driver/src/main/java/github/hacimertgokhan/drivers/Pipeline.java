package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisException;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * A batch of commands written to one connection in a single write and
 * answered in order. Commands are queued by the methods inherited from
 * {@link AsyncCommands} (each returns a future of its own result) and sent by
 * {@link #execute()} or {@link #executeAsync()}.
 *
 * <pre>{@code
 * Pipeline p = client.pipeline();
 * for (int i = 0; i < 10_000; i++) {
 *     p.set("item:" + i, "value " + i);
 * }
 * CompletableFuture<String> first = p.get("item:0");
 * List<Object> results = p.execute();   // 10 001 results, in order
 * first.join();                          // "value 0"
 * }</pre>
 *
 * <p>The result list holds each command's value ({@code null} for commands
 * without one, such as {@code set}) or, for a command that failed, its
 * {@link DenisException} - one failure does not stop the others. A pipeline
 * is not atomic (other clients' commands may interleave on the server) and
 * not thread-safe; after {@code execute} it is empty and can be reused.
 *
 * <p>{@link #execute()} without arguments sends the batch;
 * {@link #execute(String, Object...)} queues a SQL statement like the other
 * command methods.
 */
public final class Pipeline extends AsyncCommands {
    private final DenisClient client;
    private List<Command.Pending<?>> queued = new ArrayList<>();

    Pipeline(DenisClient client) {
        this.client = client;
    }

    @Override
    <T> CompletableFuture<T> run(Command<T> command) {
        Command.Pending<T> p = new Command.Pending<>(command);
        queued.add(p);
        return p.future;
    }

    /** Number of queued commands. */
    public int size() {
        return queued.size();
    }

    /** Drop every queued command without sending it; their futures fail with {@code INVALID}. */
    public void discard() {
        List<Command.Pending<?>> batch = drain();
        DenisException e = new DenisException(DenisException.INVALID, "pipeline discarded");
        for (Command.Pending<?> p : batch) {
            p.fail(e);
        }
    }

    private List<Command.Pending<?>> drain() {
        List<Command.Pending<?>> batch = queued;
        queued = new ArrayList<>();
        return batch;
    }

    /**
     * Send every queued command and wait for all replies.
     *
     * @return one entry per command, in order: its value, or the {@link DenisException} it failed with
     */
    public List<Object> execute() {
        ConnectionPool.checkNotIoThread();
        List<Command.Pending<?>> batch = drain();
        if (batch.isEmpty()) {
            return new ArrayList<>();
        }
        client.pool().dispatch(new ArrayList<>(batch), false);
        List<Object> results = new ArrayList<>(batch.size());
        for (Command.Pending<?> p : batch) {
            try {
                results.add(ConnectionPool.await(p.future, 0));
            } catch (DenisException e) {
                results.add(e);
            }
        }
        return results;
    }

    /** Send every queued command; the future completes with the same list {@link #execute()} returns. */
    public CompletableFuture<List<Object>> executeAsync() {
        List<Command.Pending<?>> batch = drain();
        if (batch.isEmpty()) {
            return CompletableFuture.completedFuture(new ArrayList<>());
        }
        client.pool().dispatch(new ArrayList<>(batch), false);
        CompletableFuture<?>[] futures = new CompletableFuture<?>[batch.size()];
        for (int i = 0; i < futures.length; i++) {
            futures[i] = batch.get(i).future;
        }
        return CompletableFuture.allOf(futures).handle((ignored, error) -> {
            List<Object> results = new ArrayList<>(futures.length);
            for (CompletableFuture<?> f : futures) {
                try {
                    results.add(f.join());
                } catch (RuntimeException e) {
                    results.add(ConnectionPool.unwrap(e));
                }
            }
            return results;
        });
    }
}
