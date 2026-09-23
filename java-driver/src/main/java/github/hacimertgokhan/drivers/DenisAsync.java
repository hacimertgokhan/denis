package github.hacimertgokhan.drivers;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Supplier;

/**
 * Asynchronous view of a {@link DenisClient}: every command returns a
 * {@link CompletableFuture} immediately and is written to the least busy
 * pooled connection right away. Obtain it with {@link DenisClient#async()}.
 *
 * <pre>{@code
 * DenisAsync async = client.async();
 * CompletableFuture<String> name = async.get("user:1:name");
 * async.incr("visits").thenAccept(n -> log.info("visit #" + n));
 * }</pre>
 *
 * Thread-safe. Futures fail with
 * {@link github.hacimertgokhan.drivers.exceptions.DenisException} (codes as
 * in the synchronous API); a command that is not answered within the command
 * timeout fails with {@code TIMEOUT}.
 */
public final class DenisAsync extends AsyncCommands {
    private final DenisClient client;
    private final boolean affinity;

    /**
     * @param affinity route each thread's commands to its own connection so they batch (the async API);
     *                 {@code false} picks the least busy connection (blocking callers, lowest latency)
     */
    DenisAsync(DenisClient client, boolean affinity) {
        this.client = client;
        this.affinity = affinity;
    }

    @Override
    <T> CompletableFuture<T> run(Command<T> command) {
        return client.pool().submit(command, affinity);
    }

    /**
     * {@code IMPORT} a document produced by {@link #dump()} into the current
     * project. Dumps larger than {@link DenisClient.Builder#importChunkBytes(int)}
     * are split into several {@code IMPORT} lines (keys in batches, each table
     * in its own line; a table larger than one line is created by the first
     * line and filled by {@code "append":true} lines). The lines are sent one
     * after another and the import stops at the first failure.
     *
     * @param replace replace existing tables with the same name (otherwise such a table fails with {@code SQL})
     * @return the summed counts of all lines
     */
    public CompletableFuture<ImportResult> importDump(String dumpJson, boolean replace) {
        List<Map<String, Object>> chunks = Commands.importChunks(dumpJson, replace, client.config().importChunkBytes);
        CompletableFuture<ImportResult> total = CompletableFuture.completedFuture(ImportResult.EMPTY);
        for (Map<String, Object> chunk : chunks) {
            Command<ImportResult> command = Commands.importChunk(chunk);
            total = total.thenCompose(sum -> run(command).thenApply(sum::plus));
        }
        return total;
    }

    // session changes block while every pooled connection switches; run them off the caller's thread

    private <T> CompletableFuture<T> blocking(Supplier<T> action) {
        try {
            return CompletableFuture.supplyAsync(action, client.pool().workers());
        } catch (RejectedExecutionException e) {
            return CompletableFuture.failedFuture(client.pool().clientClosed());
        }
    }

    /** Asynchronous {@link DenisClient#use(String)}. */
    public CompletableFuture<Void> use(String token) {
        Commands.auth(token); // validate now
        return blocking(() -> {
            client.use(token);
            return null;
        });
    }

    /** Asynchronous {@link DenisClient#login(String, String)}. */
    public CompletableFuture<Void> login(String group, String password) {
        Commands.login(group, password); // validate now
        return blocking(() -> {
            client.login(group, password);
            return null;
        });
    }

    /** Asynchronous {@link DenisClient#createProject()}: creates a project, selects it and completes with its token. */
    public CompletableFuture<String> createProject() {
        return blocking(client::createProject);
    }

    /** Asynchronous {@link DenisClient#deleteProject(String)}. */
    public CompletableFuture<Void> deleteProject(String token) {
        Commands.deleteProject(token); // validate now
        return blocking(() -> {
            client.deleteProject(token);
            return null;
        });
    }
}
