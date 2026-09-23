package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisConnectionException;
import github.hacimertgokhan.drivers.exceptions.DenisException;

import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Thread-safe client for Denis Database (wire protocol 2).
 *
 * <pre>{@code
 * try (DenisClient client = DenisClient.builder()
 *         .host("127.0.0.1").port(5142)
 *         .credentials("crm", "s3cret")
 *         .token(token)                      // or .createProject(true)
 *         .build()) {                        // connects eagerly
 *     client.set("greeting", "hello world");
 *     String v = client.get("greeting");     // null when missing
 *     QueryResult r = client.query("SELECT * FROM users WHERE age > ?", 30);
 * }
 * }</pre>
 *
 * <h2>Connections</h2>
 * A client owns a small pool of TCP connections ({@link Builder#poolSize(int)}).
 * Every connection is pipelined: requests from any number of threads are
 * written back to back and the replies are matched in order by one reader
 * thread per connection, so a single connection already serves many
 * concurrent callers. Each request goes to the connection with the fewest
 * requests in flight.
 *
 * <p>All connections share one session: the group login and the selected
 * project. {@link #login}, {@link #use} and {@link #createProject()} apply to
 * every connection and are replayed ({@code MODE json}, {@code LIN},
 * {@code AUTH}) when a dropped connection is re-established
 * ({@link Builder#reconnect(boolean)}).
 *
 * <h2>Errors and timeouts</h2>
 * Every failure is an unchecked {@link DenisException} with a
 * {@link DenisException#code() code}. A command without a reply within the
 * command timeout fails with {@code TIMEOUT}; if the connection stays silent
 * it is closed and its other in-flight commands fail with {@code CLOSED}.
 * Commands that were already sent are never re-sent automatically, because
 * the driver cannot know whether the server executed them.
 *
 * <h2>Three ways to call</h2>
 * The methods of this class block until the reply arrives. {@link #async()}
 * returns the same commands as {@link CompletableFuture}s, and
 * {@link #pipeline()} batches commands into a single write.
 *
 * <p>The legacy 1.x style still works:
 * {@code new DenisClient(host, port)}, {@link #connect()}, {@link #login},
 * {@link #authenticate}/{@link #createProject()}, then commands.
 */
public class DenisClient implements AutoCloseable {
    /** Default Denis port. */
    public static final int DEFAULT_PORT = 5142;

    private final ClientConfig config;
    private final DenisAsync async;
    /** The same commands, routed for blocking callers (least busy connection). */
    private final DenisAsync blockingCommands;
    private volatile ConnectionPool pool;
    private volatile boolean closed;

    /** A client for {@code host:5142} with one connection; connects on {@link #connect()} or first use. */
    public DenisClient(String host) {
        this(host, DEFAULT_PORT);
    }

    /** A client for {@code host:port} with one connection; connects on {@link #connect()} or first use. */
    public DenisClient(String host, int port) {
        this(builder().host(host).port(port).poolSize(1).config());
    }

    DenisClient(ClientConfig config) {
        this.config = config;
        this.async = new DenisAsync(this, true);
        this.blockingCommands = new DenisAsync(this, false);
    }

    /** A builder with defaults: {@code 127.0.0.1:5142}, 2 connections, 5 s connect timeout, 10 s command timeout, reconnect on. */
    public static Builder builder() {
        return new Builder();
    }

    ClientConfig config() {
        return config;
    }

    // =================================================================== lifecycle

    /**
     * Open the connections (and run the handshake: {@code MODE json}, login,
     * project selection) if that has not happened yet. Called by
     * {@link Builder#build()}; for clients made with a constructor it is
     * called on first use.
     *
     * @throws DenisException code {@code CONNECTION} when the server cannot be reached,
     *                        {@code AUTH} when the configured credentials are rejected
     */
    public void connect() {
        pool();
    }

    ConnectionPool pool() {
        ConnectionPool p = pool;
        if (p != null) {
            return p;
        }
        synchronized (this) {
            if (closed) {
                throw new DenisConnectionException(DenisException.CLOSED, "the Denis client is closed");
            }
            if (pool == null) {
                ConnectionPool created = new ConnectionPool(config);
                created.start();
                pool = created;
            }
            return pool;
        }
    }

    /** {@code true} when connected and at least one connection is open. */
    public boolean isConnected() {
        ConnectionPool p = pool;
        return p != null && !p.isClosed() && p.openConnections() > 0;
    }

    /**
     * Close every connection. In-flight commands get up to the shutdown
     * timeout ({@link Builder#shutdownTimeout(Duration)}) to finish; later
     * ones fail with {@code CLOSED}. Idempotent.
     */
    @Override
    public void close() {
        ConnectionPool p;
        synchronized (this) {
            closed = true;
            p = pool;
        }
        if (p != null) {
            p.close();
        }
    }

    /** Asynchronous view of this client (shares its connections). */
    public DenisAsync async() {
        return async;
    }

    /** A new, empty pipeline on this client's connections. */
    public Pipeline pipeline() {
        return new Pipeline(this);
    }

    private <T> T await(CompletableFuture<T> future) {
        return ConnectionPool.await(future, config.commandTimeoutNanos());
    }

    /** The async commands, after checking that blocking is allowed on this thread (before anything is sent). */
    private DenisAsync sync() {
        ConnectionPool.checkNotIoThread();
        return blockingCommands;
    }

    // =================================================================== session

    /**
     * Log in with a group and password ({@code LIN}) on every connection. The
     * password may contain spaces. Logging in as a different group drops the
     * selected project.
     *
     * @throws github.hacimertgokhan.drivers.exceptions.DenisAuthException code {@code AUTH} or {@code LOCKED}
     */
    public void login(String group, String password) {
        Command<Map<String, Object>> command = Commands.login(group, password);
        pool().applySession(command, s -> s.withLogin(group, password));
    }

    /**
     * Select a project by token ({@code AUTH <token>}) on every connection.
     *
     * @throws github.hacimertgokhan.drivers.exceptions.DenisAuthException code {@code AUTH} when the
     *                                                                     project does not exist or belongs to another group
     */
    public void use(String token) {
        Command<Void> command = Commands.auth(token);
        pool().applySession(command, s -> s.withToken(token));
    }

    /** Same as {@link #use(String)} (1.x name). */
    public void authenticate(String token) {
        use(token);
    }

    /** Create a project owned by the logged-in group ({@code AUTH CREATE}), select it and return its token. */
    public String createProject() {
        return createProject(true);
    }

    /**
     * Create a project owned by the logged-in group ({@code AUTH CREATE}).
     *
     * @param select also select it on every connection (like {@link #use(String)})
     * @return the new project's token (128 characters)
     */
    public String createProject(boolean select) {
        ConnectionPool.checkNotIoThread();
        String token = await(pool().submit(Commands.createProject()));
        if (select) {
            use(token);
        }
        return token;
    }

    /**
     * Delete a project and all its keys and tables ({@code AUTH DELETE}).
     * Deleting the selected project leaves this client without one (its
     * connections are re-opened without a project).
     */
    public void deleteProject(String token) {
        ConnectionPool.checkNotIoThread();
        ConnectionPool p = pool();
        await(p.submit(Commands.deleteProject(token)));
        if (token.equals(p.token())) {
            p.resetProject();
        }
    }

    /** Token of the selected project, or {@code null}. */
    public String token() {
        ConnectionPool p = pool;
        return p == null ? config.token : p.token();
    }

    /** Same as {@link #token()} (1.x name). */
    public String getToken() {
        return token();
    }

    // =================================================================== connection commands

    /** {@code PING}; returns {@code true} (failures throw). */
    public boolean ping() {
        return await(sync().ping());
    }

    /** {@code HELLO}: server name, version, protocol and features. Works without login. */
    public ServerHello hello() {
        return await(sync().hello());
    }

    /** {@code HELP}: the server's command list. */
    public List<String> help() {
        return await(sync().help());
    }

    /** {@code WHOAMI}: {@code group}, {@code admin}, {@code project}. */
    public Map<String, Object> whoami() {
        return await(sync().whoami());
    }

    /** {@code INFO}: nested maps {@code server}, {@code clients}, {@code stats}, {@code memory}, {@code persistence}, {@code keyspace}, {@code project}. */
    public Map<String, Object> info() {
        return await(sync().info());
    }

    /** {@code PROJECTS}: the projects this group may open. */
    public List<Project> projects() {
        return await(sync().projects());
    }

    // =================================================================== keys

    /** {@code GET}: the value (cache value preferred over the durable one), or {@code null} when the key does not exist. */
    public String get(String key) {
        return await(sync().get(key));
    }

    /** {@code GET} as an {@link Optional}. */
    public Optional<String> find(String key) {
        return Optional.ofNullable(get(key));
    }

    /** {@code GET key -&from-protobuff}: prefer the durable value; {@code null} when missing. */
    public String getPersistent(String key) {
        return await(sync().getPersistent(key));
    }

    /**
     * {@code SET}: store the cache value. Keys are one word (no whitespace);
     * values may be empty and contain spaces, quotes and any unicode, but no
     * line breaks and no space-separated word starting with {@code -&} -
     * encode such data (JSON, base64) first.
     *
     * @throws DenisException code {@code INVALID} for keys/values the protocol cannot carry, {@code OOM} when the server is full
     */
    public void set(String key, String value) {
        await(sync().set(key, value));
    }

    /** {@code SET} with options: durable ({@link SetOptions#persist()}) and/or a TTL. */
    public void set(String key, String value, SetOptions options) {
        await(sync().set(key, value, options));
    }

    /** {@code SET} with a TTL on the cache value. */
    public void set(String key, String value, Duration ttl) {
        await(sync().set(key, value, ttl));
    }

    /** {@code SET}; {@code persist} also writes the durable value (1.x signature). */
    public void set(String key, String value, boolean persist) {
        await(sync().set(key, value, persist ? SetOptions.persist() : SetOptions.cache()));
    }

    /** {@code UPDATE}: overwrite the cache value. */
    public void update(String key, String value) {
        await(sync().update(key, value));
    }

    /** {@code DEL} from both layers; returns whether the key existed. */
    public boolean del(String key) {
        return await(sync().del(key));
    }

    /** {@code DEL} from the chosen layer(s); returns whether the key existed. */
    public boolean del(String key, DelOptions options) {
        return await(sync().del(key, options));
    }

    /** Same as {@link #del(String)} (1.x name). */
    public boolean delete(String key) {
        return del(key);
    }

    /** {@code EXISTS} in either layer. */
    public boolean exists(String key) {
        return await(sync().exists(key));
    }

    /** {@code KEYS}: all keys of the project (capped by the server's keys-limit). */
    public List<String> keys() {
        return await(sync().keys());
    }

    /** {@code KEYS pattern} with glob syntax: {@code *}, {@code ?}, {@code [a-z]}. */
    public List<String> keys(String pattern) {
        return await(sync().keys(pattern));
    }

    /** {@code KEYS pattern} with a layer and/or a limit. */
    public List<String> keys(String pattern, KeysOptions options) {
        return await(sync().keys(pattern, options));
    }

    /** {@code MGET}: values in request order, {@code null} for missing keys. */
    public Map<String, String> mget(String... keys) {
        return await(sync().mget(keys));
    }

    /** {@code MGET}: values in request order, {@code null} for missing keys. */
    public Map<String, String> mget(Collection<String> keys) {
        return await(sync().mget(keys));
    }

    /** {@code INCR}: atomically add 1 (a missing key counts as 0) and return the new value. */
    public long incr(String key) {
        return await(sync().incr(key));
    }

    /** {@code INCR key delta}. */
    public long incrBy(String key, long delta) {
        return await(sync().incrBy(key, delta));
    }

    /** {@code INCR key delta [-&save]}; {@code persist} also writes the durable value. */
    public long incrBy(String key, long delta, boolean persist) {
        return await(sync().incrBy(key, delta, persist));
    }

    /** {@code DECR}: atomically subtract 1 and return the new value. */
    public long decr(String key) {
        return await(sync().decr(key));
    }

    /** {@code DECR key delta}. */
    public long decrBy(String key, long delta) {
        return await(sync().decrBy(key, delta));
    }

    /** {@code EXPIRE}: expire the cache value after {@code ttl} (ms precision); returns whether the key had a cache value. */
    public boolean expire(String key, Duration ttl) {
        return await(sync().expire(key, ttl));
    }

    /** {@code TTL} in seconds (rounded up); {@code -1} no TTL, {@code -2} no cache value. */
    public long ttl(String key) {
        return await(sync().ttl(key));
    }

    /** {@code TTL} in milliseconds; {@code -1} no TTL, {@code -2} no cache value. */
    public long pttl(String key) {
        return await(sync().pttl(key));
    }

    /** {@code PERSIST}: remove the TTL; returns whether the key had a cache value. */
    public boolean persist(String key) {
        return await(sync().persist(key));
    }

    /** {@code DBSIZE} of the current project. */
    public DbSize dbsize() {
        return await(sync().dbsize());
    }

    /** {@code HEAVEN}: drop every cache value of the current project; durable values stay. */
    public void clear() {
        await(sync().clear());
    }

    // =================================================================== SQL

    /**
     * {@code QUERY}: run one SQL statement with {@code ?} parameters bound
     * by the server (immune to SQL injection; the parsed statement is cached).
     *
     * @throws github.hacimertgokhan.drivers.exceptions.DenisSqlException code {@code SQL} when the statement fails
     */
    public QueryResult query(String sql, Object... params) {
        return await(sync().query(sql, params));
    }

    /** {@code QUERY} with a parameter list. */
    public QueryResult query(String sql, List<?> params) {
        return await(sync().query(sql, params));
    }

    /**
     * Run one statement and return the Denis 0.0.x text result, e.g.
     * {@code "OK: 1 row inserted"} or a JSON array of rows.
     *
     * @throws github.hacimertgokhan.drivers.exceptions.DenisSqlException code {@code SQL} when the statement fails
     */
    public String sql(String statement) {
        return await(sync().sql(statement));
    }

    // =================================================================== dump / import

    /** {@code DUMP}: the current project (cache and durable keys, TTLs, tables) as one JSON document. */
    public String dump() {
        return await(sync().dump());
    }

    /**
     * {@code IMPORT} a {@link #dump()} into the current project, merging keys.
     * Big dumps are split into several lines automatically.
     *
     * @param replace replace existing tables of the same name (otherwise importing such a table fails)
     */
    public ImportResult importDump(String dumpJson, boolean replace) {
        return ConnectionPool.await(sync().importDump(dumpJson, replace), 0);
    }

    // =================================================================== admin

    /** {@code SAVE}: write a snapshot now. Admin groups only ({@code FORBIDDEN} otherwise). */
    public SaveInfo save() {
        return await(sync().save());
    }

    /** {@code BACKUP}: create a backup archive on the server. Admin groups only. */
    public BackupInfo backup() {
        return await(sync().backup());
    }

    /** {@code BACKUPS}: list the server's backup archives. Admin groups only. */
    public List<BackupInfo> backups() {
        return await(sync().backups());
    }

    // =================================================================== raw

    /**
     * Send any single command line and return the reply object (without
     * {@code ok}); {@code "ok":false} replies throw a {@link DenisException}
     * whose {@link DenisException#reply()} holds the reply. Session commands
     * ({@code MODE}, {@code EXIT}, {@code LIN}, {@code AUTH <token>}) are
     * rejected with {@code INVALID}; use {@link #login} and {@link #use}.
     */
    public Map<String, Object> command(String line) {
        return await(sync().command(line));
    }

    @Override
    public String toString() {
        ConnectionPool p = pool;
        return "DenisClient{" + config.host + ":" + config.port + ", connections=" + (p == null ? 0 : p.openConnections())
                + "/" + config.poolSize + (closed ? ", closed" : "") + "}";
    }

    // =================================================================== builder

    /**
     * Configures and connects a {@link DenisClient}.
     *
     * <pre>{@code
     * DenisClient client = DenisClient.builder()
     *     .host("db.internal").port(5142)
     *     .credentials("crm", "s3cret")
     *     .token(System.getenv("DENIS_TOKEN"))
     *     .poolSize(4)
     *     .commandTimeout(Duration.ofSeconds(5))
     *     .build();
     * }</pre>
     */
    public static final class Builder {
        String host = "127.0.0.1";
        int port = DEFAULT_PORT;
        String group;
        String password;
        String token;
        boolean createProject;
        int poolSize = 2;
        Duration connectTimeout = Duration.ofSeconds(5);
        Duration commandTimeout = Duration.ofSeconds(10);
        boolean reconnect = true;
        Duration reconnectMinDelay = Duration.ofMillis(100);
        Duration reconnectMaxDelay = Duration.ofSeconds(5);
        long maxReplyBytes = 256L * 1024 * 1024;
        int importChunkBytes = 4 * 1024 * 1024;
        Duration shutdownTimeout = Duration.ofSeconds(2);

        Builder() {
        }

        /** Server host name or address (default {@code 127.0.0.1}). */
        public Builder host(String host) {
            this.host = host;
            return this;
        }

        /** Server port (default 5142). */
        public Builder port(int port) {
            this.port = port;
            return this;
        }

        /** Group and password for {@code LIN}; the password may contain spaces. */
        public Builder credentials(String group, String password) {
            this.group = group;
            this.password = password;
            return this;
        }

        /** Project to select after login ({@code AUTH <token>}). */
        public Builder token(String token) {
            this.token = token;
            return this;
        }

        /** Create a new project on connect when no {@link #token(String)} is set; read it with {@link DenisClient#token()}. */
        public Builder createProject(boolean createProject) {
            this.createProject = createProject;
            return this;
        }

        /** Number of pipelined connections (1..64, default 2). */
        public Builder poolSize(int poolSize) {
            this.poolSize = poolSize;
            return this;
        }

        /** TCP connect timeout (default 5 s); zero waits indefinitely. */
        public Builder connectTimeout(Duration connectTimeout) {
            this.connectTimeout = connectTimeout;
            return this;
        }

        /**
         * How long a command may wait for its reply (default 10 s): after
         * being sent and after the previous reply on its connection arrived.
         * Synchronous calls give up after this long. Zero disables timeouts.
         */
        public Builder commandTimeout(Duration commandTimeout) {
            this.commandTimeout = commandTimeout;
            return this;
        }

        /** Re-open dropped connections in the background and replay the login/project (default on). */
        public Builder reconnect(boolean reconnect) {
            this.reconnect = reconnect;
            return this;
        }

        /** Reconnect backoff: first retry after {@code min}, doubling up to {@code max} (defaults 100 ms, 5 s). */
        public Builder reconnectBackoff(Duration min, Duration max) {
            this.reconnectMinDelay = min;
            this.reconnectMaxDelay = max;
            return this;
        }

        /** Largest reply line accepted (default 256 MiB); bigger replies close the connection with {@code PROTOCOL}. */
        public Builder maxReplyBytes(long maxReplyBytes) {
            this.maxReplyBytes = maxReplyBytes;
            return this;
        }

        /**
         * Target size of one {@code IMPORT} line when {@link DenisClient#importDump}
         * splits a dump (default 4 MiB; keep it below the server's max-line-size, 8 MiB by default).
         */
        public Builder importChunkBytes(int importChunkBytes) {
            this.importChunkBytes = importChunkBytes;
            return this;
        }

        /** How long {@link DenisClient#close()} lets in-flight commands finish (default 2 s). */
        public Builder shutdownTimeout(Duration shutdownTimeout) {
            this.shutdownTimeout = shutdownTimeout;
            return this;
        }

        ClientConfig config() {
            if (host == null || host.isBlank()) {
                throw Protocol.invalid("host must be set");
            }
            if (port < 1 || port > 65535) {
                throw Protocol.invalid("port must be 1..65535: " + port);
            }
            if (poolSize < 1 || poolSize > 64) {
                throw Protocol.invalid("poolSize must be 1..64: " + poolSize);
            }
            if ((group == null) != (password == null)) {
                throw Protocol.invalid("credentials need both group and password");
            }
            if (group != null) {
                Commands.login(group, password); // validates both
            }
            if (token != null) {
                Commands.auth(token);
            }
            if (token != null && group == null || createProject && group == null) {
                throw Protocol.invalid("selecting or creating a project needs credentials(group, password)");
            }
            requireNonNegative(connectTimeout, "connectTimeout");
            requireNonNegative(commandTimeout, "commandTimeout");
            requireNonNegative(reconnectMinDelay, "reconnect min delay");
            requireNonNegative(reconnectMaxDelay, "reconnect max delay");
            requireNonNegative(shutdownTimeout, "shutdownTimeout");
            if (maxReplyBytes < 1024) {
                throw Protocol.invalid("maxReplyBytes must be at least 1024");
            }
            if (importChunkBytes < 1024) {
                throw Protocol.invalid("importChunkBytes must be at least 1024");
            }
            return new ClientConfig(this);
        }

        private static void requireNonNegative(Duration d, String what) {
            if (d == null || d.isNegative()) {
                throw Protocol.invalid(what + " must be zero or positive");
            }
        }

        /**
         * Create the client and connect every connection (handshake: {@code MODE json},
         * {@code LIN}, {@code AUTH}/{@code AUTH CREATE}).
         *
         * @throws DenisException {@code INVALID} for bad settings, {@code CONNECTION} when the
         *                        server is unreachable, {@code AUTH}/{@code LOCKED} when login fails
         */
        public DenisClient build() {
            DenisClient client = new DenisClient(config());
            client.connect();
            return client;
        }

        /** Create the client without connecting; it connects on {@link DenisClient#connect()} or first use. */
        public DenisClient buildLazy() {
            return new DenisClient(config());
        }
    }
}
