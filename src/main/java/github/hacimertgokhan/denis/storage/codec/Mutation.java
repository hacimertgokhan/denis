package github.hacimertgokhan.denis.storage.codec;

/**
 * One durable change. The write-ahead log is a sequence of mutations and a
 * snapshot is the shortest sequence that rebuilds the whole state, so recovery
 * is a single code path: replay mutations in order.
 *
 * <p>Every mutation is idempotent (it states the new value rather than a
 * delta), which is what makes non-blocking ("fuzzy") checkpoints safe: a
 * mutation that is both inside a snapshot and in a later log segment is
 * simply applied twice with the same result.
 *
 * <p>Keyspaces (projects) are referred to by a small numeric id instead of the
 * 128 character token, so a record for a short key stays a few dozen bytes.
 */
public sealed interface Mutation {

    /** Binds a keyspace id to its project token. Written once per keyspace and in every snapshot. */
    record DefineKeyspace(int keyspace, String name) implements Mutation {}

    /** Durable key-value write. */
    record Put(int keyspace, String key, String value) implements Mutation {}

    /** Durable key-value delete. */
    record Delete(int keyspace, String key) implements Mutation {}

    /** Removes a keyspace with all of its keys and tables. */
    record DropKeyspace(int keyspace) implements Mutation {}

    record CreateTable(int keyspace, String table, String schemaJson) implements Mutation {}

    /** Replaces the column list of a table (ALTER TABLE); existing rows are padded on replay. */
    record AlterTable(int keyspace, String table, String schemaJson) implements Mutation {}

    record DropTable(int keyspace, String table) implements Mutation {}

    /** Inserts or replaces one row. Values are Long, Double, String, Boolean or null. */
    record PutRow(int keyspace, String table, long rowId, Object[] values) implements Mutation {}

    record DeleteRow(int keyspace, String table, long rowId) implements Mutation {}

    record CreateIndex(int keyspace, String table, String name, String column, boolean unique) implements Mutation {}

    record DropIndex(int keyspace, String table, String name) implements Mutation {}

    /** Last record of a snapshot: the number of records before it, so a cut-off snapshot is detected. */
    record End(long count) implements Mutation {}
}
