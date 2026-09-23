package github.hacimertgokhan.denis.sql.exec;

/**
 * Evaluation context: the current row of every source of a query (one per
 * table in FROM/JOIN, null for an unmatched LEFT JOIN side), their row ids,
 * the statement parameters and, in the output phase of an aggregate query,
 * the aggregate results of the current group. Mutable and reused while
 * iterating, so evaluators must not keep references to it.
 */
public final class Ctx {
    public final Object[][] rows;
    public final long[] ids;
    public final Object[] params;
    public Object[] aggregates;

    public Ctx(int sources, Object[] params) {
        this.rows = new Object[sources][];
        this.ids = new long[sources];
        this.params = params;
    }

    /** A copy that keeps the current rows (group representatives). */
    public Ctx snapshot() {
        Ctx copy = new Ctx(rows.length, params);
        System.arraycopy(rows, 0, copy.rows, 0, rows.length);
        System.arraycopy(ids, 0, copy.ids, 0, ids.length);
        return copy;
    }
}
