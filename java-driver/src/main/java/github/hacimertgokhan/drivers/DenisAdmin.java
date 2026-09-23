package github.hacimertgokhan.drivers;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Project administration with the server's main token
 * ({@code ADMIN <main-token> ...}). Obtain it with
 * {@link DenisClient#admin(String)}; it uses that client's connections and
 * needs no group login.
 *
 * <pre>{@code
 * try (DenisClient client = DenisClient.builder().host("db").build()) {   // no credentials needed
 *     DenisAdmin admin = client.admin(mainToken);
 *     String token = admin.create(10_000, 64L * 1024 * 1024);
 *     for (ProjectUsage p : admin.list()) {
 *         System.out.println(p.token() + " " + p.cachedKeys() + "/" + p.maxKeys());
 *     }
 *     admin.quota(token, 0, 0);   // remove the limits
 *     admin.drop(token);
 * }
 * }</pre>
 *
 * Limits apply to the cache and the persisted store separately; {@code 0}
 * means unlimited. A project over its limit rejects writes with
 * {@link github.hacimertgokhan.drivers.exceptions.DenisQuotaException}.
 * Errors: a wrong main token fails with code {@code AUTH}
 * ({@code "ADMIN refused: wrong main token"}), an unknown project with the
 * server's error ({@code "Unknown project: <token>"}).
 *
 * <p>Thread-safe. The main token is sent with every command but never
 * included in {@link #toString()} or in driver error messages.
 */
public final class DenisAdmin {
    private final DenisClient client;
    private final String mainToken;
    private final Async async;

    DenisAdmin(DenisClient client, String mainToken) {
        this.client = client;
        this.mainToken = mainToken;
        this.async = new Async(client, mainToken);
    }

    /** The same commands returning {@link CompletableFuture}s. */
    public Async async() {
        return async;
    }

    /** {@code ADMIN LIST}: every project with its usage and quota. */
    public List<ProjectUsage> list() {
        return client.call(Commands.adminList(mainToken));
    }

    /** {@code ADMIN CREATE}: create a project without limits and return its token. */
    public String create() {
        return client.call(Commands.adminCreate(mainToken, null, null));
    }

    /** {@code ADMIN CREATE maxKeys maxBytes}: create a project with limits ({@code 0} = unlimited) and return its token. */
    public String create(long maxKeys, long maxBytes) {
        return client.call(Commands.adminCreate(mainToken, maxKeys, maxBytes));
    }

    /**
     * {@code ADMIN IMPORT token}: register a token issued elsewhere, e.g. to
     * restore access after the project registry was lost. Idempotent.
     *
     * @return {@code true} if the project was added, {@code false} if it already existed
     */
    public boolean importProject(String token) {
        return client.call(Commands.adminImport(mainToken, token, null, null));
    }

    /** {@code ADMIN IMPORT token maxKeys maxBytes}: {@link #importProject(String)} and set its limits. */
    public boolean importProject(String token, long maxKeys, long maxBytes) {
        return client.call(Commands.adminImport(mainToken, token, maxKeys, maxBytes));
    }

    /** {@code ADMIN USAGE token}: the project's usage and quota. */
    public ProjectUsage usage(String token) {
        return client.call(Commands.adminUsage(mainToken, token));
    }

    /** {@code ADMIN QUOTA token maxKeys maxBytes}: set the limits ({@code 0} = unlimited); returns the updated usage. */
    public ProjectUsage quota(String token, long maxKeys, long maxBytes) {
        return client.call(Commands.adminQuota(mainToken, token, maxKeys, maxBytes));
    }

    /** {@code ADMIN FLUSH token}: delete every key and table of the project, keep the project. */
    public void flush(String token) {
        client.call(Commands.adminFlush(mainToken, token));
    }

    /** {@code ADMIN DROP token}: delete the project and its data. */
    public void drop(String token) {
        client.call(Commands.adminDrop(mainToken, token));
    }

    @Override
    public String toString() {
        return "DenisAdmin{" + client + "}";
    }

    /** {@link DenisAdmin} with {@link CompletableFuture} results; obtain it with {@link DenisAdmin#async()}. */
    public static final class Async {
        private final DenisClient client;
        private final String mainToken;

        Async(DenisClient client, String mainToken) {
            this.client = client;
            this.mainToken = mainToken;
        }

        private <T> CompletableFuture<T> run(Command<T> command) {
            return client.async().run(command);
        }

        /** {@code ADMIN LIST}. */
        public CompletableFuture<List<ProjectUsage>> list() {
            return run(Commands.adminList(mainToken));
        }

        /** {@code ADMIN CREATE}. */
        public CompletableFuture<String> create() {
            return run(Commands.adminCreate(mainToken, null, null));
        }

        /** {@code ADMIN CREATE maxKeys maxBytes}. */
        public CompletableFuture<String> create(long maxKeys, long maxBytes) {
            return run(Commands.adminCreate(mainToken, maxKeys, maxBytes));
        }

        /** {@code ADMIN IMPORT token}. */
        public CompletableFuture<Boolean> importProject(String token) {
            return run(Commands.adminImport(mainToken, token, null, null));
        }

        /** {@code ADMIN IMPORT token maxKeys maxBytes}. */
        public CompletableFuture<Boolean> importProject(String token, long maxKeys, long maxBytes) {
            return run(Commands.adminImport(mainToken, token, maxKeys, maxBytes));
        }

        /** {@code ADMIN USAGE token}. */
        public CompletableFuture<ProjectUsage> usage(String token) {
            return run(Commands.adminUsage(mainToken, token));
        }

        /** {@code ADMIN QUOTA token maxKeys maxBytes}. */
        public CompletableFuture<ProjectUsage> quota(String token, long maxKeys, long maxBytes) {
            return run(Commands.adminQuota(mainToken, token, maxKeys, maxBytes));
        }

        /** {@code ADMIN FLUSH token}. */
        public CompletableFuture<Void> flush(String token) {
            return run(Commands.adminFlush(mainToken, token));
        }

        /** {@code ADMIN DROP token}. */
        public CompletableFuture<Void> drop(String token) {
            return run(Commands.adminDrop(mainToken, token));
        }

        @Override
        public String toString() {
            return "DenisAdmin.Async{" + client + "}";
        }
    }
}
