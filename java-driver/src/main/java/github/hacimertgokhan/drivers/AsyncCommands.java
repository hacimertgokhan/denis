package github.hacimertgokhan.drivers;

import java.time.Duration;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * The Denis commands in future-returning form. Implemented by
 * {@link DenisAsync} (each call is sent immediately) and {@link Pipeline}
 * (calls are queued and sent together by {@link Pipeline#execute()}).
 *
 * <p>Arguments are validated before anything is sent: invalid ones (a key
 * with whitespace, a value with a line break...) throw
 * {@link github.hacimertgokhan.drivers.exceptions.DenisException} with code
 * {@code INVALID} directly from the call. Everything else is reported through
 * the returned future.
 *
 * <p>Futures are completed on the connection's reader thread. Keep callbacks
 * short and non-blocking, or use the {@code *Async} variants of
 * {@link CompletableFuture} with your own executor; synchronous
 * {@link DenisClient} calls from such a callback are rejected.
 */
public abstract class AsyncCommands {
    AsyncCommands() {
    }

    abstract <T> CompletableFuture<T> run(Command<T> command);

    // =================================================================== connection

    /** {@code PING}; completes with {@code true}. */
    public CompletableFuture<Boolean> ping() {
        return run(Commands.ping());
    }

    /** {@code HELLO}: server name, version, protocol and features. */
    public CompletableFuture<ServerHello> hello() {
        return run(Commands.hello());
    }

    /** {@code HELP}: the command synopsis list. */
    public CompletableFuture<List<String>> help() {
        return run(Commands.help());
    }

    /** {@code WHOAMI}: {@code group}, {@code admin} and {@code project} (token or {@code null}). */
    public CompletableFuture<Map<String, Object>> whoami() {
        return run(Commands.whoami());
    }

    /** {@code INFO}: server, clients, stats, memory, persistence, keyspace and project sections. */
    public CompletableFuture<Map<String, Object>> info() {
        return run(Commands.info());
    }

    /** {@code PROJECTS}: the projects this group may open. */
    public CompletableFuture<List<Project>> projects() {
        return run(Commands.projects());
    }

    // =================================================================== keys

    /** {@code GET}: the value (cache value preferred), or {@code null} when the key does not exist. */
    public CompletableFuture<String> get(String key) {
        return run(Commands.get(key));
    }

    /** {@code GET}: the value wrapped in an {@link Optional}, empty when the key does not exist. */
    public CompletableFuture<Optional<String>> find(String key) {
        return get(key).thenApply(Optional::ofNullable);
    }

    /** {@code GET key -&from-protobuff}: the durable value preferred over the cache value; {@code null} when missing. */
    public CompletableFuture<String> getPersistent(String key) {
        return run(Commands.getPersistent(key));
    }

    /** {@code SET}: cache value only. */
    public CompletableFuture<Void> set(String key, String value) {
        return run(Commands.set(key, value, null));
    }

    /** {@code SET} with options (durable, TTL). */
    public CompletableFuture<Void> set(String key, String value, SetOptions options) {
        return run(Commands.set(key, value, options));
    }

    /** {@code SET} with a TTL on the cache value. */
    public CompletableFuture<Void> set(String key, String value, Duration ttl) {
        return run(Commands.set(key, value, SetOptions.cache().ttl(ttl)));
    }

    /** {@code UPDATE}: overwrite the cache value. */
    public CompletableFuture<Void> update(String key, String value) {
        return run(Commands.update(key, value));
    }

    /** {@code DEL} both layers; completes with whether the key existed. */
    public CompletableFuture<Boolean> del(String key) {
        return run(Commands.del(key, null));
    }

    /** {@code DEL} with a layer choice; completes with whether the key existed. */
    public CompletableFuture<Boolean> del(String key, DelOptions options) {
        return run(Commands.del(key, options));
    }

    /** {@code EXISTS} in either layer. */
    public CompletableFuture<Boolean> exists(String key) {
        return run(Commands.exists(key));
    }

    /** {@code KEYS}: every key of the project (up to the server's keys-limit). */
    public CompletableFuture<List<String>> keys() {
        return run(Commands.keys(null, null));
    }

    /** {@code KEYS pattern}; glob syntax {@code *}, {@code ?}, {@code [a-z]}. */
    public CompletableFuture<List<String>> keys(String pattern) {
        return run(Commands.keys(pattern, null));
    }

    /** {@code KEYS pattern} with a layer and/or limit. */
    public CompletableFuture<List<String>> keys(String pattern, KeysOptions options) {
        return run(Commands.keys(pattern, options));
    }

    /** {@code MGET}: values in request order; missing keys map to {@code null}. */
    public CompletableFuture<Map<String, String>> mget(String... keys) {
        return run(Commands.mget(keys == null ? null : Arrays.asList(keys)));
    }

    /** {@code MGET}: values in request order; missing keys map to {@code null}. */
    public CompletableFuture<Map<String, String>> mget(Collection<String> keys) {
        return run(Commands.mget(keys));
    }

    /** {@code INCR}: atomically add 1 (a missing key counts as 0); completes with the new value. */
    public CompletableFuture<Long> incr(String key) {
        return run(Commands.incr(key, 1, false, false));
    }

    /** {@code INCR key delta}. */
    public CompletableFuture<Long> incrBy(String key, long delta) {
        return run(Commands.incr(key, delta, false, false));
    }

    /** {@code INCR key delta [-&save]}; {@code persist} also writes the durable value. */
    public CompletableFuture<Long> incrBy(String key, long delta, boolean persist) {
        return run(Commands.incr(key, delta, false, persist));
    }

    /** {@code DECR}: atomically subtract 1. */
    public CompletableFuture<Long> decr(String key) {
        return run(Commands.incr(key, 1, true, false));
    }

    /** {@code DECR key delta}. */
    public CompletableFuture<Long> decrBy(String key, long delta) {
        return run(Commands.incr(key, delta, true, false));
    }

    /** {@code EXPIRE}: set a TTL on the cache value; completes with whether the key had a cache value. */
    public CompletableFuture<Boolean> expire(String key, Duration ttl) {
        return run(Commands.expire(key, ttl));
    }

    /** {@code TTL} in seconds (rounded up); {@code -1} no TTL, {@code -2} no cache value. */
    public CompletableFuture<Long> ttl(String key) {
        return run(Commands.ttl(key));
    }

    /** {@code TTL} in milliseconds; {@code -1} no TTL, {@code -2} no cache value. */
    public CompletableFuture<Long> pttl(String key) {
        return run(Commands.pttl(key));
    }

    /** {@code PERSIST}: remove the TTL; completes with whether the key had a cache value. */
    public CompletableFuture<Boolean> persist(String key) {
        return run(Commands.persist(key));
    }

    /** {@code DBSIZE} of the current project. */
    public CompletableFuture<DbSize> dbsize() {
        return run(Commands.dbsize());
    }

    /** {@code HEAVEN}: drop every cache value of the current project (durable values stay). */
    public CompletableFuture<Void> clear() {
        return run(Commands.clear());
    }

    // =================================================================== SQL

    /**
     * {@code QUERY}: run a statement with {@code ?} parameters bound by the
     * server (immune to SQL injection). Parameters may be {@code null},
     * {@code String}, numbers, {@code Boolean}, {@code UUID}, enums or
     * {@code java.time} values (sent as ISO text).
     */
    public CompletableFuture<QueryResult> query(String sql, Object... params) {
        return run(Commands.query(sql, params == null ? List.of() : Arrays.asList(params)));
    }

    /** {@code QUERY} with a parameter list. */
    public CompletableFuture<QueryResult> query(String sql, List<?> params) {
        return run(Commands.query(sql, params));
    }

    /**
     * Run a statement and return the Denis 0.0.x text result (the reply's
     * {@code data}, e.g. {@code "OK: 1 row inserted"}). Multi-line statements
     * are fine. Prefer {@link #query(String, Object...)} in applications.
     */
    public CompletableFuture<String> sql(String statement) {
        return run(Commands.sql(statement));
    }

    // =================================================================== dump / import

    /** {@code DUMP}: the whole current project (keys, TTLs, tables) as one JSON document. */
    public CompletableFuture<String> dump() {
        return run(Commands.dump());
    }

    // =================================================================== admin (admin groups)

    /** {@code SAVE}: write a snapshot now (admin group). */
    public CompletableFuture<SaveInfo> save() {
        return run(Commands.save());
    }

    /** {@code BACKUP}: create a backup archive on the server (admin group). */
    public CompletableFuture<BackupInfo> backup() {
        return run(Commands.backup());
    }

    /** {@code BACKUPS}: list backup archives (admin group). */
    public CompletableFuture<List<BackupInfo>> backups() {
        return run(Commands.backups());
    }

    // =================================================================== raw

    /**
     * Send any single command line and return the reply object without
     * {@code ok}. An {@code "ok":false} reply fails the future with a
     * {@link github.hacimertgokhan.drivers.exceptions.DenisException} carrying
     * the reply. {@code MODE}, {@code EXIT}/{@code QUIT}, {@code LIN} and
     * {@code AUTH <token>} are rejected: they would desynchronise the pooled
     * connections - use the dedicated methods instead.
     */
    public CompletableFuture<Map<String, Object>> command(String line) {
        return run(Commands.raw(line));
    }
}
