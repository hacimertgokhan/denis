package github.hacimertgokhan.denis.sql;

import github.hacimertgokhan.denis.sql.ast.Expr;
import github.hacimertgokhan.denis.sql.ast.Statement;
import github.hacimertgokhan.denis.sql.exec.Aggregates;
import github.hacimertgokhan.denis.sql.exec.Binder;
import github.hacimertgokhan.denis.sql.exec.Ctx;
import github.hacimertgokhan.denis.sql.exec.Eval;
import github.hacimertgokhan.denis.sql.exec.Operators;
import github.hacimertgokhan.denis.storage.Keyspace;
import github.hacimertgokhan.denis.storage.StorageEngine;
import github.hacimertgokhan.denis.storage.codec.Mutation;
import github.hacimertgokhan.denis.storage.table.Column;
import github.hacimertgokhan.denis.storage.table.ColumnType;
import github.hacimertgokhan.denis.storage.table.Index;
import github.hacimertgokhan.denis.storage.table.Table;
import github.hacimertgokhan.denis.storage.table.TableSchema;
import github.hacimertgokhan.denis.storage.table.Values;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NavigableMap;
import java.util.PriorityQueue;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.locks.Lock;

/**
 * Executes Denis SQL against the tables of a keyspace.
 *
 * <h2>Planning</h2>
 * For the first table of a statement the planner picks the cheapest access
 * path from the WHERE clause: row-id lookup, unique/non-unique index equality,
 * index IN-list, index range, index-ordered scan (for {@code ORDER BY col
 * LIMIT n}), or a full scan in row-id order. Joined tables are probed through
 * an index on the join column when there is one, otherwise through a hash
 * table built once per statement. Conditions that only use the first table
 * are applied before joining. Queries with {@code ORDER BY ... LIMIT n} keep a
 * bounded top-N heap instead of sorting everything, and queries whose order
 * comes from the access path stop reading as soon as the limit is reached.
 *
 * <h2>Isolation</h2>
 * A statement holds the read locks (queries) or the write lock (changes) of
 * its tables for its whole run, so every statement sees and produces a
 * consistent table state.
 */
public final class SqlEngine {
    private static final CompletableFuture<Void> DONE = CompletableFuture.completedFuture(null);

    private final StorageEngine storage;
    private final int maxResultRows;

    public SqlEngine(StorageEngine storage, int maxResultRows) {
        this.storage = storage;
        this.maxResultRows = maxResultRows <= 0 ? Integer.MAX_VALUE : maxResultRows;
    }

    /**
     * Parse and run one statement.
     *
     * @param params values for {@code ?} placeholders (Long, Double, String, Boolean or null)
     * @throws SqlException for syntax and semantic errors
     */
    public SqlResult execute(Keyspace ks, String sql, Object[] params) {
        Statement statement = SqlParser.parse(sql);
        Object[] p = params == null ? new Object[0] : params;
        if (p.length < statement.parameterCount()) {
            throw new SqlException("Statement has " + statement.parameterCount() + " parameter(s), got " + p.length);
        }
        return execute(ks, statement, p);
    }

    private SqlResult execute(Keyspace ks, Statement st, Object[] params) {
        if (st instanceof Statement.Select s) {
            return select(ks, s, params, false);
        }
        if (st instanceof Statement.Insert s) {
            return insert(ks, s, params);
        }
        if (st instanceof Statement.Update s) {
            return update(ks, s, params, false);
        }
        if (st instanceof Statement.Delete s) {
            return delete(ks, s, params, false);
        }
        if (st instanceof Statement.CreateTable s) {
            return createTable(ks, s);
        }
        if (st instanceof Statement.DropTable s) {
            return dropTable(ks, s);
        }
        if (st instanceof Statement.AlterAddColumn s) {
            return alterTable(ks, s);
        }
        if (st instanceof Statement.CreateIndex s) {
            return createIndex(ks, s);
        }
        if (st instanceof Statement.DropIndex s) {
            return dropIndex(ks, s);
        }
        if (st instanceof Statement.Truncate s) {
            return truncate(ks, s);
        }
        if (st instanceof Statement.ShowTables) {
            return showTables(ks);
        }
        if (st instanceof Statement.ShowIndexes s) {
            return showIndexes(ks, s);
        }
        if (st instanceof Statement.Describe s) {
            return describe(ks, s);
        }
        if (st instanceof Statement.Explain s) {
            Statement inner = s.statement();
            if (inner instanceof Statement.Select sel) {
                return select(ks, sel, params, true);
            }
            if (inner instanceof Statement.Update upd) {
                return update(ks, upd, params, true);
            }
            return delete(ks, (Statement.Delete) inner, params, true);
        }
        throw new SqlException("Unsupported statement");
    }

    // =================================================================== DDL

    private SqlResult createTable(Keyspace ks, Statement.CreateTable st) {
        if (st.columns().isEmpty()) {
            throw new SqlException("A table needs at least one column");
        }
        List<Column> columns = new ArrayList<>();
        for (Statement.ColumnSpec spec : st.columns()) {
            columns.add(column(spec));
        }
        TableSchema schema;
        try {
            schema = new TableSchema(columns);
        } catch (IllegalArgumentException e) {
            throw new SqlException(e.getMessage());
        }
        boolean[] existed = {false};
        @SuppressWarnings("unchecked")
        CompletableFuture<Void>[] durable = new CompletableFuture[]{DONE};
        storage.reserveMemory(1024);
        ks.tables().compute(st.table(), (name, existing) -> {
            if (existing != null) {
                existed[0] = true;
                return existing;
            }
            durable[0] = storage.logTableMutation(ks, new Mutation.CreateTable(ks.id(), name, schema.toJson()));
            return storage.newTable(name, schema);
        });
        if (existed[0]) {
            if (st.ifNotExists()) {
                return SqlResult.change(0, "table already exists", null, DONE);
            }
            throw new SqlException("Table already exists: " + st.table());
        }
        return SqlResult.change(0, "table created", null, durable[0]);
    }

    private static Column column(Statement.ColumnSpec spec) {
        ColumnType type = ColumnType.fromDeclared(spec.declaredType());
        Object def = null;
        if (spec.defaultValue() != null) {
            try {
                def = type.coerce(spec.defaultValue(), spec.name());
            } catch (IllegalArgumentException e) {
                throw new SqlException("Bad DEFAULT for " + spec.name() + ": " + e.getMessage());
            }
        }
        return new Column(spec.name(), spec.declaredType(), type, spec.notNull(), spec.primaryKey(), spec.unique(), def);
    }

    private Table requireTable(Keyspace ks, String name) {
        Table table = ks.table(name);
        if (table == null) {
            throw new SqlException("Table not found: " + name);
        }
        return table;
    }

    /** Take the write lock of a table and re-check that it was not dropped meanwhile. */
    private Table lockForWrite(Keyspace ks, String name) {
        Table table = requireTable(ks, name);
        table.lock().writeLock().lock();
        if (ks.table(name) != table) {
            table.lock().writeLock().unlock();
            throw new SqlException("Table not found: " + name);
        }
        return table;
    }

    private SqlResult dropTable(Keyspace ks, Statement.DropTable st) {
        Table table = ks.table(st.table());
        if (table == null) {
            if (st.ifExists()) {
                return SqlResult.change(0, "table does not exist", null, DONE);
            }
            throw new SqlException("Table not found: " + st.table());
        }
        table.lock().writeLock().lock();
        try {
            if (!ks.tables().remove(st.table(), table)) {
                throw new SqlException("Table not found: " + st.table());
            }
            CompletableFuture<Void> durable = storage.logTableMutation(ks, new Mutation.DropTable(ks.id(), st.table()));
            table.release();
            return SqlResult.change(0, "table dropped", null, durable);
        } finally {
            table.lock().writeLock().unlock();
        }
    }

    private SqlResult alterTable(Keyspace ks, Statement.AlterAddColumn st) {
        Table table = lockForWrite(ks, st.table());
        try {
            Column column = column(st.column());
            if (column.primaryKey()) {
                throw new SqlException("Cannot add a PRIMARY KEY column to an existing table");
            }
            if (column.notNull() && column.defaultValue() == null && table.rowCount() > 0) {
                throw new SqlException("Cannot add NOT NULL column " + column.name() + " without DEFAULT to a table with rows");
            }
            if (column.unique() && column.defaultValue() != null && table.rowCount() > 1) {
                throw new SqlException("Cannot add UNIQUE column " + column.name() + " with a DEFAULT to a table with several rows");
            }
            TableSchema next;
            try {
                next = table.schema().withColumn(column);
            } catch (IllegalArgumentException e) {
                throw new SqlException(e.getMessage());
            }
            CompletableFuture<Void> durable = storage.logTableMutation(ks, new Mutation.AlterTable(ks.id(), table.name(), next.toJson()));
            table.alter(next);
            return SqlResult.change(0, "column added", null, durable);
        } finally {
            table.lock().writeLock().unlock();
        }
    }

    private SqlResult createIndex(Keyspace ks, Statement.CreateIndex st) {
        for (Table t : ks.tables().values()) {
            if (t.index(st.name()) != null) {
                if (st.ifNotExists()) {
                    return SqlResult.change(0, "index already exists", null, DONE);
                }
                throw new SqlException("Index already exists: " + st.name());
            }
        }
        Table table = lockForWrite(ks, st.table());
        try {
            if (table.schema().position(st.column()) < 0) {
                throw new SqlException("Column not found: " + st.column());
            }
            storage.reserveMemory(64L * table.rowCount());
            try {
                // validate (and build) first, log second: a failing unique index leaves no trace
                table.createIndex(st.name(), st.column(), st.unique());
            } catch (IllegalArgumentException e) {
                throw new SqlException(e.getMessage());
            }
            CompletableFuture<Void> durable;
            try {
                durable = storage.logTableMutation(ks, new Mutation.CreateIndex(ks.id(), table.name(), st.name(), st.column(), st.unique()));
            } catch (RuntimeException e) {
                table.dropIndex(st.name());
                throw e;
            }
            return SqlResult.change(0, "index created", null, durable);
        } finally {
            table.lock().writeLock().unlock();
        }
    }

    private SqlResult dropIndex(Keyspace ks, Statement.DropIndex st) {
        Table owner = null;
        if (st.table() != null) {
            owner = requireTable(ks, st.table());
        } else {
            for (Table t : ks.tables().values()) {
                if (t.index(st.name()) != null) {
                    owner = t;
                    break;
                }
            }
        }
        if (owner == null || owner.index(st.name()) == null) {
            if (st.ifExists()) {
                return SqlResult.change(0, "index does not exist", null, DONE);
            }
            throw new SqlException("Index not found: " + st.name());
        }
        Table table = lockForWrite(ks, owner.name());
        try {
            if (!table.explicitIndexes().contains(table.index(st.name()))) {
                throw new SqlException("Index " + st.name() + " belongs to a PRIMARY KEY or UNIQUE column and cannot be dropped");
            }
            CompletableFuture<Void> durable = storage.logTableMutation(ks, new Mutation.DropIndex(ks.id(), table.name(), st.name()));
            table.dropIndex(st.name());
            return SqlResult.change(0, "index dropped", null, durable);
        } finally {
            table.lock().writeLock().unlock();
        }
    }

    private SqlResult truncate(Keyspace ks, Statement.Truncate st) {
        Table table = lockForWrite(ks, st.table());
        try {
            int rows = table.rowCount();
            // logged as drop + create so replay does not need one record per row
            storage.logTableMutation(ks, new Mutation.DropTable(ks.id(), table.name()));
            CompletableFuture<Void> durable = storage.logTableMutation(ks, new Mutation.CreateTable(ks.id(), table.name(), table.schema().toJson()));
            for (Index index : table.explicitIndexes()) {
                durable = storage.logTableMutation(ks, new Mutation.CreateIndex(ks.id(), table.name(), index.name(), index.column(), index.unique()));
            }
            table.truncate();
            return SqlResult.change(rows, rows + " row(s) deleted", null, durable);
        } finally {
            table.lock().writeLock().unlock();
        }
    }

    private SqlResult showTables(Keyspace ks) {
        List<Object[]> rows = new ArrayList<>();
        List<String> names = new ArrayList<>(ks.tables().keySet());
        names.sort(null);
        for (String name : names) {
            Table t = ks.table(name);
            if (t == null) {
                continue;
            }
            t.lock().readLock().lock();
            try {
                rows.add(new Object[]{name, (long) t.rowCount(), (long) t.schema().size(), (long) t.indexes().size(), t.estimatedBytes()});
            } finally {
                t.lock().readLock().unlock();
            }
        }
        return SqlResult.query(List.of("table", "rows", "columns", "indexes", "bytes"), rows);
    }

    private SqlResult showIndexes(Keyspace ks, Statement.ShowIndexes st) {
        Table t = requireTable(ks, st.table());
        t.lock().readLock().lock();
        try {
            List<Object[]> rows = new ArrayList<>();
            for (Index index : t.indexes()) {
                rows.add(new Object[]{index.name(), index.column(), index.unique(), (long) index.distinctValues()});
            }
            return SqlResult.query(List.of("name", "column", "unique", "distinct_values"), rows);
        } finally {
            t.lock().readLock().unlock();
        }
    }

    private SqlResult describe(Keyspace ks, Statement.Describe st) {
        Table t = requireTable(ks, st.table());
        List<Object[]> rows = new ArrayList<>();
        for (Column c : t.schema().columns()) {
            rows.add(new Object[]{c.name(), c.declaredType(), c.type().name(), c.notNull(), c.primaryKey(), c.unique(), c.defaultValue()});
        }
        return SqlResult.query(List.of("column", "type", "storage", "not_null", "primary_key", "unique", "default"), rows);
    }

    // =================================================================== access paths

    private enum Kind { SCAN, ROWID, INDEX_EQ, INDEX_IN, INDEX_RANGE, INDEX_ORDER }

    /** How the first table of a statement is read. */
    private record Path(Kind kind, Index index, ColumnType columnType, Eval[] keys, Eval low, boolean lowInclusive,
                        Eval high, boolean highInclusive, boolean descending, String column) {

        static Path scan(boolean descending) {
            return new Path(Kind.SCAN, null, null, null, null, false, null, false, descending, Binder.ROWID);
        }

        Path descending(boolean desc) {
            return new Path(kind, index, columnType, keys, low, lowInclusive, high, highInclusive, desc, column);
        }

        /** Column whose order the path delivers rows in, or null. */
        String orderedBy() {
            return switch (kind) {
                case SCAN -> Binder.ROWID;
                case INDEX_RANGE, INDEX_ORDER -> column;
                default -> null;
            };
        }

        String describe(String table) {
            return switch (kind) {
                case SCAN -> "SCAN " + table + (descending ? " (row id descending)" : "");
                case ROWID -> "LOOKUP " + table + " BY _rowid";
                case INDEX_EQ -> "SEARCH " + table + " USING " + (index.unique() ? "UNIQUE " : "") + "INDEX " + index.name() + " (" + column + " = ?)";
                case INDEX_IN -> "SEARCH " + table + " USING INDEX " + index.name() + " (" + column + " IN (...))";
                case INDEX_RANGE -> "SEARCH " + table + " USING INDEX " + index.name() + " (" + column + " range"
                        + (descending ? ", descending" : "") + ")";
                case INDEX_ORDER -> "SCAN " + table + " USING INDEX " + index.name() + " (ordered by " + column
                        + (descending ? " descending" : "") + ")";
            };
        }
    }

    @FunctionalInterface
    private interface RowVisitor {
        /** @return false to stop */
        boolean visit(long id, Object[] row);
    }

    private static List<Expr> conjuncts(Expr where) {
        List<Expr> list = new ArrayList<>();
        collectConjuncts(where, list);
        return list;
    }

    private static void collectConjuncts(Expr e, List<Expr> into) {
        if (e == null) {
            return;
        }
        if (e instanceof Expr.Binary b && b.op().equals("AND")) {
            collectConjuncts(b.left(), into);
            collectConjuncts(b.right(), into);
        } else {
            into.add(e);
        }
    }

    private static String flip(String op) {
        return switch (op) {
            case "<" -> ">";
            case "<=" -> ">=";
            case ">" -> "<";
            case ">=" -> "<=";
            default -> op;
        };
    }

    /** Choose the access path for source 0 from the conjuncts that only touch it. */
    private Path plan(Binder binder, Table table, List<Expr> conjuncts, String orderColumn, Boolean orderDescending) {
        Path best = null;
        int bestScore = 0;
        Map<String, Eval[]> lows = new HashMap<>();
        Map<String, Eval[]> highs = new HashMap<>();
        Map<String, boolean[]> inclusive = new HashMap<>();
        for (Expr c : conjuncts) {
            if (c instanceof Expr.Binary b && Set.of("=", "<", "<=", ">", ">=").contains(b.op())) {
                Expr.Column col = null;
                Expr other = null;
                String op = b.op();
                if (b.left() instanceof Expr.Column l && Binder.isConstant(b.right())) {
                    col = l;
                    other = b.right();
                } else if (b.right() instanceof Expr.Column r && Binder.isConstant(b.left())) {
                    col = r;
                    other = b.left();
                    op = flip(op);
                }
                if (col == null || binder.resolve(col.table(), col.column()).source() != 0) {
                    continue;
                }
                String name = col.column();
                Eval key = binder.bind(other);
                if (name.equals(Binder.ROWID)) {
                    if (op.equals("=") && bestScore < 100) {
                        best = new Path(Kind.ROWID, null, null, new Eval[]{key}, null, false, null, false, false, name);
                        bestScore = 100;
                    }
                    continue;
                }
                Index index = table.indexOn(name);
                ColumnType type = table.schema().column(table.schema().position(name)).type();
                if (index == null || type == ColumnType.ANY) {
                    continue;
                }
                if (op.equals("=")) {
                    int score = index.unique() ? 90 : 80;
                    if (score > bestScore) {
                        best = new Path(Kind.INDEX_EQ, index, type, new Eval[]{key}, null, false, null, false, false, name);
                        bestScore = score;
                    }
                } else {
                    boolean lower = op.startsWith(">");
                    boolean incl = op.endsWith("=");
                    Map<String, Eval[]> bounds = lower ? lows : highs;
                    if (!bounds.containsKey(name)) {
                        bounds.put(name, new Eval[]{key});
                        inclusive.computeIfAbsent(name, k -> new boolean[2])[lower ? 0 : 1] = incl;
                    }
                }
            } else if (c instanceof Expr.In in && !in.not() && in.operand() instanceof Expr.Column col
                    && in.values().stream().allMatch(Binder::isConstant)
                    && binder.resolve(col.table(), col.column()).source() == 0 && !col.column().equals(Binder.ROWID)) {
                Index index = table.indexOn(col.column());
                ColumnType type = table.schema().column(table.schema().position(col.column())).type();
                if (index != null && type != ColumnType.ANY && bestScore < 70) {
                    Eval[] keys = in.values().stream().map(binder::bind).toArray(Eval[]::new);
                    best = new Path(Kind.INDEX_IN, index, type, keys, null, false, null, false, false, col.column());
                    bestScore = 70;
                }
            } else if (c instanceof Expr.Between bt && !bt.not() && bt.operand() instanceof Expr.Column col
                    && Binder.isConstant(bt.low()) && Binder.isConstant(bt.high())
                    && binder.resolve(col.table(), col.column()).source() == 0 && !col.column().equals(Binder.ROWID)) {
                String name = col.column();
                lows.putIfAbsent(name, new Eval[]{binder.bind(bt.low())});
                highs.putIfAbsent(name, new Eval[]{binder.bind(bt.high())});
                boolean[] inc = inclusive.computeIfAbsent(name, k -> new boolean[2]);
                inc[0] = true;
                inc[1] = true;
            }
        }
        if (bestScore < 60) {
            Set<String> rangeColumns = new LinkedHashSet<>(lows.keySet());
            rangeColumns.addAll(highs.keySet());
            for (String name : rangeColumns) {
                Index index = table.indexOn(name);
                ColumnType type = table.schema().column(table.schema().position(name)).type();
                if (index == null || type == ColumnType.ANY) {
                    continue;
                }
                boolean[] inc = inclusive.getOrDefault(name, new boolean[2]);
                Eval[] lo = lows.get(name);
                Eval[] hi = highs.get(name);
                int score = lo != null && hi != null ? 60 : 50;
                // a range on the ORDER BY column also delivers the order: prefer it
                if (name.equals(orderColumn)) {
                    score += 5;
                }
                if (score > bestScore) {
                    best = new Path(Kind.INDEX_RANGE, index, type, null, lo == null ? null : lo[0], inc[0],
                            hi == null ? null : hi[0], inc[1], false, name);
                    bestScore = score;
                }
            }
        }
        if (best == null && orderColumn != null) {
            if (orderColumn.equals(Binder.ROWID)) {
                return Path.scan(Boolean.TRUE.equals(orderDescending));
            }
            int position = table.schema().position(orderColumn);
            Index index = table.indexOn(orderColumn);
            // NULLs are not indexed, so only a NOT NULL column can be scanned through its index
            if (index != null && position >= 0 && table.schema().column(position).notNull()) {
                return new Path(Kind.INDEX_ORDER, index, table.schema().column(position).type(), null, null, false, null,
                        false, Boolean.TRUE.equals(orderDescending), orderColumn);
            }
        }
        if (best == null) {
            return Path.scan(false);
        }
        if (best.kind() == Kind.INDEX_RANGE && best.column().equals(orderColumn)) {
            return best.descending(Boolean.TRUE.equals(orderDescending));
        }
        return best;
    }

    /** Whether an index lookup with this value finds exactly what a scan comparison would. */
    private static boolean indexable(ColumnType type, Object value) {
        return switch (type) {
            case INTEGER, REAL -> value instanceof Long || value instanceof Double;
            case TEXT -> value instanceof String;
            case BOOLEAN -> value instanceof Boolean;
            default -> false;
        };
    }

    private boolean run(Path path, Table table, Ctx ctx, RowVisitor visitor) {
        NavigableMap<Long, Object[]> rows = table.rows();
        switch (path.kind()) {
            case ROWID -> {
                Object key = path.keys()[0].eval(ctx);
                Long id = key instanceof Number n && n.doubleValue() == Math.rint(n.doubleValue()) ? n.longValue() : null;
                if (id == null && key instanceof String s) {
                    try {
                        id = Long.parseLong(s.trim());
                    } catch (NumberFormatException ignored) {
                        // not a row id: no match
                    }
                }
                Object[] row = id == null ? null : rows.get(id);
                return row == null || visitor.visit(id, row);
            }
            case INDEX_EQ -> {
                Object key = path.keys()[0].eval(ctx);
                if (key == null) {
                    return true;
                }
                if (!indexable(path.columnType(), key)) {
                    return run(Path.scan(false), table, ctx, visitor);
                }
                return path.index().lookup(key, id -> visitor.visit(id, rows.get(id)));
            }
            case INDEX_IN -> {
                TreeMap<Object, Object> keys = new TreeMap<>(Values.ORDER);
                for (Eval e : path.keys()) {
                    Object key = e.eval(ctx);
                    if (key == null) {
                        continue;
                    }
                    if (!indexable(path.columnType(), key)) {
                        return run(Path.scan(false), table, ctx, visitor);
                    }
                    keys.put(Values.indexKey(key), key);
                }
                for (Object key : keys.values()) {
                    if (!path.index().lookup(key, id -> visitor.visit(id, rows.get(id)))) {
                        return false;
                    }
                }
                return true;
            }
            case INDEX_RANGE -> {
                Object low = path.low() == null ? null : path.low().eval(ctx);
                Object high = path.high() == null ? null : path.high().eval(ctx);
                if ((path.low() != null && low == null) || (path.high() != null && high == null)) {
                    return true;
                }
                if ((low != null && !indexable(path.columnType(), low)) || (high != null && !indexable(path.columnType(), high))) {
                    return run(Path.scan(false), table, ctx, visitor);
                }
                return path.index().range(low, path.lowInclusive(), high, path.highInclusive(), path.descending(),
                        id -> visitor.visit(id, rows.get(id)));
            }
            case INDEX_ORDER -> {
                return path.index().range(null, false, null, false, path.descending(), id -> visitor.visit(id, rows.get(id)));
            }
            default -> {
                NavigableMap<Long, Object[]> view = path.descending() ? rows.descendingMap() : rows;
                for (Map.Entry<Long, Object[]> e : view.entrySet()) {
                    if (!visitor.visit(e.getKey(), e.getValue())) {
                        return false;
                    }
                }
                return true;
            }
        }
    }

    private static long constantLong(Binder binder, Expr e, Object[] params, String what) {
        if (e == null) {
            return -1;
        }
        if (!Binder.isConstant(e)) {
            throw new SqlException(what + " must be a constant");
        }
        Object v = binder.bind(e).eval(new Ctx(0, params));
        if (!(v instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue()) || n.longValue() < 0) {
            throw new SqlException(what + " must be a non-negative integer");
        }
        return n.longValue();
    }

    // =================================================================== SELECT

    private record Output(Object[] values, Object[] sortKeys) {}

    private final class Group {
        final Ctx representative;
        final Aggregates.Accumulator[] accumulators;

        Group(Ctx representative, List<Aggregates.Spec> specs) {
            this.representative = representative;
            this.accumulators = new Aggregates.Accumulator[specs.size()];
            for (int i = 0; i < specs.size(); i++) {
                accumulators[i] = specs.get(i).newAccumulator();
            }
        }
    }

    /** How a joined table is probed for each row of the tables before it. */
    private static final class JoinProbe {
        final Statement.JoinType type;
        final Eval on;
        final Table table;
        final int source;
        Index index;
        ColumnType columnType;
        int position = -1;
        Eval outerKey;
        Map<Object, List<Long>> hash;

        JoinProbe(Statement.JoinType type, Eval on, Table table, int source) {
            this.type = type;
            this.on = on;
            this.table = table;
            this.source = source;
        }

        String describe(String name) {
            String kind = type == Statement.JoinType.LEFT ? "LEFT JOIN " : type == Statement.JoinType.CROSS ? "CROSS JOIN " : "JOIN ";
            if (index != null) {
                return kind + name + " USING INDEX " + index.name();
            }
            if (outerKey != null) {
                return kind + name + " USING HASH TABLE on " + table.schema().column(position).name();
            }
            return kind + name + " (nested loop)";
        }

        boolean probe(Ctx ctx, RowVisitor visitor) {
            NavigableMap<Long, Object[]> rows = table.rows();
            if (outerKey != null) {
                Object key = outerKey.eval(ctx);
                if (key == null) {
                    return true;
                }
                if (indexable(columnType, key)) {
                    if (index != null) {
                        return index.lookup(key, id -> visitor.visit(id, rows.get(id)));
                    }
                    if (hash == null) {
                        hash = new HashMap<>();
                        for (Map.Entry<Long, Object[]> e : rows.entrySet()) {
                            Object v = e.getValue()[position];
                            if (v != null) {
                                hash.computeIfAbsent(Values.indexKey(v), k -> new ArrayList<>(1)).add(e.getKey());
                            }
                        }
                    }
                    List<Long> ids = hash.get(Values.indexKey(key));
                    if (ids != null) {
                        for (long id : ids) {
                            if (!visitor.visit(id, rows.get(id))) {
                                return false;
                            }
                        }
                    }
                    return true;
                }
            }
            for (Map.Entry<Long, Object[]> e : rows.entrySet()) {
                if (!visitor.visit(e.getKey(), e.getValue())) {
                    return false;
                }
            }
            return true;
        }
    }

    private SqlResult select(Keyspace ks, Statement.Select st, Object[] params, boolean explain) {
        if (st.from() == null) {
            return selectWithoutFrom(st, params, explain);
        }
        // resolve tables and take their read locks in name order (deadlock free)
        List<Statement.TableRef> refs = new ArrayList<>();
        refs.add(st.from());
        for (Statement.Join j : st.joins()) {
            refs.add(j.table());
        }
        List<Binder.Source> sources = new ArrayList<>();
        List<Table> tables = new ArrayList<>();
        Set<String> names = new HashSet<>();
        for (Statement.TableRef ref : refs) {
            Table table = requireTable(ks, ref.table());
            if (!names.add(ref.name())) {
                throw new SqlException("Table name or alias used twice: " + ref.name() + " (add an alias)");
            }
            tables.add(table);
            sources.add(new Binder.Source(ref.name(), ref.table(), table.schema()));
        }
        List<Table> lockOrder = new ArrayList<>(new LinkedHashSet<>(tables));
        lockOrder.sort(Comparator.comparing(Table::name));
        List<Lock> held = new ArrayList<>();
        try {
            for (Table t : lockOrder) {
                Lock lock = t.lock().readLock();
                lock.lock();
                held.add(lock);
                if (ks.table(t.name()) != t) {
                    throw new SqlException("Table not found: " + t.name());
                }
            }
            return runSelect(st, params, explain, sources, tables);
        } finally {
            for (int i = held.size() - 1; i >= 0; i--) {
                held.get(i).unlock();
            }
        }
    }

    private SqlResult selectWithoutFrom(Statement.Select st, Object[] params, boolean explain) {
        if (explain) {
            return SqlResult.query(List.of("plan"), List.<Object[]>of(new Object[]{"CONSTANT ROW"}));
        }
        boolean aggregate = st.items().stream().anyMatch(i -> i.expr() != null && Binder.containsAggregate(i.expr()));
        if (aggregate) {
            throw new SqlException("Aggregates need a FROM clause");
        }
        Binder binder = new Binder(List.of(), false);
        List<String> labels = new ArrayList<>();
        Object[] row = new Object[st.items().size()];
        Ctx ctx = new Ctx(0, params);
        for (int i = 0; i < st.items().size(); i++) {
            Statement.SelectItem item = st.items().get(i);
            if (item.kind() != Statement.ItemKind.EXPR) {
                throw new SqlException("SELECT * needs a FROM clause");
            }
            labels.add(item.label());
            row[i] = binder.bind(item.expr()).eval(ctx);
        }
        List<Object[]> rows = new ArrayList<>();
        rows.add(row);
        long limit = constantLong(binder, st.limit(), params, "LIMIT");
        if (limit == 0) {
            rows.clear();
        }
        return SqlResult.query(labels, rows);
    }

    private SqlResult runSelect(Statement.Select st, Object[] params, boolean explain, List<Binder.Source> sources,
                                List<Table> tables) {
        int n = sources.size();
        boolean aggregate = !st.groupBy().isEmpty()
                || st.items().stream().anyMatch(i -> i.expr() != null && Binder.containsAggregate(i.expr()))
                || (st.having() != null && Binder.containsAggregate(st.having()))
                || st.orderBy().stream().anyMatch(o -> Binder.containsAggregate(o.expr()));
        if (st.having() != null && !aggregate) {
            throw new SqlException("HAVING needs GROUP BY or an aggregate");
        }
        Binder rowBinder = new Binder(sources, false);
        Binder outBinder = new Binder(sources, aggregate);

        // ---- select list
        List<String> labels = new ArrayList<>();
        List<Eval> outputs = new ArrayList<>();
        Map<String, Integer> aliases = new HashMap<>();
        Map<String, Expr> aliasExprs = new HashMap<>();
        Map<String, Integer> labelCounts = new HashMap<>();
        for (Binder.Source s : sources) {
            for (String c : s.schema().names()) {
                labelCounts.merge(c, 1, Integer::sum);
            }
        }
        for (Statement.SelectItem item : st.items()) {
            if (item.kind() == Statement.ItemKind.EXPR) {
                if (item.aliased()) {
                    aliases.put(item.label().toLowerCase(Locale.ROOT), outputs.size());
                    aliasExprs.put(item.label().toLowerCase(Locale.ROOT), item.expr());
                }
                labels.add(item.label());
                outputs.add(outBinder.bind(item.expr()));
                continue;
            }
            boolean matched = false;
            for (int s = 0; s < n; s++) {
                Binder.Source source = sources.get(s);
                if (item.kind() == Statement.ItemKind.TABLE_ALL && !source.name().equals(item.table()) && !source.table().equals(item.table())) {
                    continue;
                }
                matched = true;
                int src = s;
                List<String> cols = source.schema().names();
                for (int c = 0; c < cols.size(); c++) {
                    int position = c;
                    String col = cols.get(c);
                    labels.add(n > 1 && labelCounts.getOrDefault(col, 0) > 1 ? source.name() + "." + col : col);
                    outputs.add(ctx -> {
                        Object[] row = ctx.rows[src];
                        return row == null || position >= row.length ? null : row[position];
                    });
                }
            }
            if (!matched) {
                throw new SqlException("Unknown table or alias: " + item.table());
            }
        }

        // ---- ORDER BY: output alias, position, or expression
        int orders = st.orderBy().size();
        Eval[] sortEvals = new Eval[orders];
        boolean[] descending = new boolean[orders];
        for (int i = 0; i < orders; i++) {
            Statement.Order order = st.orderBy().get(i);
            descending[i] = order.descending();
            Expr e = order.expr();
            if (e instanceof Expr.Column c && c.table() == null && aliases.containsKey(c.column())) {
                sortEvals[i] = outputs.get(aliases.get(c.column()));
            } else if (e instanceof Expr.Literal lit && lit.value() instanceof Long pos) {
                if (pos < 1 || pos > outputs.size()) {
                    throw new SqlException("ORDER BY position " + pos + " is out of range");
                }
                sortEvals[i] = outputs.get((int) (pos - 1));
            } else {
                sortEvals[i] = outBinder.bind(e);
            }
        }
        Eval having = st.having() == null ? null : outBinder.bind(resolveAliases(st.having(), aliasExprs));

        // ---- GROUP BY keys (may name an output alias or position)
        List<Eval> groupKeys = new ArrayList<>();
        for (Expr g : st.groupBy()) {
            Expr resolved = g;
            if (g instanceof Expr.Column c && c.table() == null && aliasExprs.containsKey(c.column())
                    && !isSourceColumn(sources, c.column())) {
                resolved = aliasExprs.get(c.column());
            } else if (g instanceof Expr.Literal lit && lit.value() instanceof Long pos) {
                if (pos < 1 || pos > st.items().size() || st.items().get((int) (pos - 1)).expr() == null) {
                    throw new SqlException("GROUP BY position " + pos + " is out of range");
                }
                resolved = st.items().get((int) (pos - 1)).expr();
            }
            if (Binder.containsAggregate(resolved)) {
                throw new SqlException("GROUP BY cannot contain aggregates");
            }
            groupKeys.add(rowBinder.bind(resolved));
        }
        List<Aggregates.Spec> specs = outBinder.aggregates();

        // ---- WHERE: split into conditions on the first table (applied before joins) and the rest
        List<Expr> firstOnly = new ArrayList<>();
        List<Expr> rest = new ArrayList<>();
        for (Expr c : conjuncts(st.where())) {
            Set<Integer> used = new HashSet<>();
            rowBinder.sourcesOf(c, used);
            if (used.isEmpty() || (used.size() == 1 && used.contains(0))) {
                firstOnly.add(c);
            } else {
                rest.add(c);
            }
        }
        Eval filter0 = and(rowBinder, firstOnly);
        Eval residual = and(rowBinder, rest);

        // ---- access path; it can deliver ORDER BY when there is a single ordering column on table 0
        String orderColumn = null;
        Boolean orderDesc = null;
        if (!aggregate && !st.distinct() && orders == 1 && st.orderBy().get(0).expr() instanceof Expr.Column oc
                && !(oc.table() == null && aliases.containsKey(oc.column()))) {
            Binder.ColumnRef ref = rowBinder.resolve(oc.table(), oc.column());
            if (ref.source() == 0) {
                orderColumn = ref.position() < 0 ? Binder.ROWID : sources.get(0).schema().column(ref.position()).name();
                orderDesc = descending[0];
            }
        }
        Path path = plan(rowBinder, tables.get(0), firstOnly, orderColumn, orderDesc);
        boolean ordered = orders == 0 || (orderColumn != null && orderColumn.equals(path.orderedBy())
                && path.descending() == orderDesc && (path.kind() != Kind.SCAN || orderColumn.equals(Binder.ROWID)));
        // joins multiply rows of table 0 but keep their order
        long limit = constantLong(rowBinder, st.limit(), params, "LIMIT");
        long offset = Math.max(0, constantLong(rowBinder, st.offset(), params, "OFFSET"));

        // ---- joins
        List<JoinProbe> probes = new ArrayList<>();
        for (int j = 0; j < st.joins().size(); j++) {
            Statement.Join join = st.joins().get(j);
            int source = j + 1;
            Eval on = join.on() == null ? null : rowBinder.bind(join.on());
            JoinProbe probe = new JoinProbe(join.type(), on, tables.get(source), source);
            for (Expr c : conjuncts(join.on())) {
                if (c instanceof Expr.Binary b && b.op().equals("=")) {
                    Expr inner = null;
                    Expr outer = null;
                    for (Expr[] pair : new Expr[][]{{b.left(), b.right()}, {b.right(), b.left()}}) {
                        if (pair[0] instanceof Expr.Column col && rowBinder.resolve(col.table(), col.column()).source() == source
                                && rowBinder.resolve(col.table(), col.column()).position() >= 0) {
                            Set<Integer> used = new HashSet<>();
                            rowBinder.sourcesOf(pair[1], used);
                            if (used.stream().allMatch(u -> u < source)) {
                                inner = pair[0];
                                outer = pair[1];
                                break;
                            }
                        }
                    }
                    if (inner != null) {
                        Expr.Column col = (Expr.Column) inner;
                        int position = rowBinder.resolve(col.table(), col.column()).position();
                        ColumnType type = tables.get(source).schema().column(position).type();
                        if (type != ColumnType.ANY) {
                            probe.position = position;
                            probe.columnType = type;
                            probe.outerKey = rowBinder.bind(outer);
                            probe.index = tables.get(source).indexOn(col.column());
                            break;
                        }
                    }
                }
            }
            probes.add(probe);
        }

        if (explain) {
            List<Object[]> plan = new ArrayList<>();
            plan.add(new Object[]{path.describe(sources.get(0).table())});
            if (filter0 != null) {
                plan.add(new Object[]{"FILTER " + sources.get(0).name()});
            }
            for (int j = 0; j < probes.size(); j++) {
                plan.add(new Object[]{probes.get(j).describe(sources.get(j + 1).table())});
            }
            if (residual != null) {
                plan.add(new Object[]{"FILTER (after joins)"});
            }
            if (aggregate) {
                plan.add(new Object[]{groupKeys.isEmpty() ? "AGGREGATE" : "GROUP BY (hash)"});
            }
            if (st.distinct()) {
                plan.add(new Object[]{"DISTINCT (hash)"});
            }
            if (orders > 0) {
                plan.add(new Object[]{ordered && !aggregate ? "ORDER BY (from access path, no sort)"
                        : limit >= 0 ? "ORDER BY (top-" + (limit + offset) + " heap)" : "ORDER BY (sort)"});
            }
            if (limit >= 0) {
                plan.add(new Object[]{"LIMIT " + limit + (offset > 0 ? " OFFSET " + offset : "")
                        + (ordered && !aggregate && !st.distinct() ? " (stops early)" : "")});
            }
            return SqlResult.query(List.of("plan"), plan);
        }

        // ---- execution
        boolean stopEarly = limit >= 0 && ordered && !aggregate && !st.distinct();
        long wanted = limit < 0 ? Long.MAX_VALUE : limit + offset;
        boolean topN = limit >= 0 && orders > 0 && !ordered && !aggregate && !st.distinct();
        Comparator<Output> comparator = orders == 0 ? null : (a, b) -> {
            for (int i = 0; i < orders; i++) {
                int c = Values.compare(a.sortKeys()[i], b.sortKeys()[i]);
                if (c != 0) {
                    return descending[i] ? -c : c;
                }
            }
            return 0;
        };
        List<Output> results = new ArrayList<>();
        PriorityQueue<Output> heap = topN ? new PriorityQueue<>((int) Math.min(wanted + 1, 1024), comparator.reversed()) : null;
        Map<List<Object>, Group> groups = aggregate ? new LinkedHashMap<>() : null;
        Ctx ctx = new Ctx(n, params);

        RowVisitor emit = (id, row) -> {
            if (residual != null && !Operators.isTrue(residual.eval(ctx))) {
                return true;
            }
            if (aggregate) {
                List<Object> key;
                if (groupKeys.isEmpty()) {
                    key = List.of();
                } else {
                    Object[] k = new Object[groupKeys.size()];
                    for (int i = 0; i < k.length; i++) {
                        k[i] = Values.indexKey(groupKeys.get(i).eval(ctx));
                    }
                    key = Arrays.asList(k);
                }
                Group group = groups.get(key);
                if (group == null) {
                    if (groups.size() >= maxResultRows) {
                        throw tooLarge();
                    }
                    group = new Group(ctx.snapshot(), specs);
                    for (int i = 0; i < specs.size(); i++) {
                        Aggregates.applySeparator(group.accumulators[i], specs.get(i), ctx);
                    }
                    groups.put(key, group);
                }
                for (int i = 0; i < specs.size(); i++) {
                    Aggregates.Spec spec = specs.get(i);
                    group.accumulators[i].add(spec.argument() == null ? null : spec.argument().eval(ctx), ctx);
                }
                return true;
            }
            Output out = project(outputs, sortEvals, ctx);
            if (heap != null) {
                heap.add(out);
                if (heap.size() > wanted) {
                    heap.poll();
                }
                return true;
            }
            results.add(out);
            if (results.size() > maxResultRows && limit < 0) {
                throw tooLarge();
            }
            return !stopEarly || results.size() < wanted;
        };

        RowVisitor[] levels = new RowVisitor[n + 1];
        levels[n] = emit;
        for (int level = n - 1; level >= 1; level--) {
            JoinProbe probe = probes.get(level - 1);
            RowVisitor next = levels[level + 1];
            int src = level;
            levels[level] = (id, row) -> {
                boolean[] matched = {false};
                boolean more = probe.probe(ctx, (innerId, innerRow) -> {
                    ctx.rows[src] = innerRow;
                    ctx.ids[src] = innerId;
                    if (probe.on != null && !Operators.isTrue(probe.on.eval(ctx))) {
                        return true;
                    }
                    matched[0] = true;
                    return next.visit(innerId, innerRow);
                });
                if (more && !matched[0] && probe.type == Statement.JoinType.LEFT) {
                    ctx.rows[src] = null;
                    ctx.ids[src] = -1;
                    more = next.visit(-1, null);
                }
                ctx.rows[src] = null;
                return more;
            };
        }
        RowVisitor afterFirst = levels[1];
        run(path, tables.get(0), ctx, (id, row) -> {
            ctx.rows[0] = row;
            ctx.ids[0] = id;
            if (filter0 != null && !Operators.isTrue(filter0.eval(ctx))) {
                return true;
            }
            return afterFirst.visit(id, row);
        });

        if (aggregate) {
            if (groups.isEmpty() && groupKeys.isEmpty()) {
                Group empty = new Group(new Ctx(n, params), specs);
                groups.put(List.of(), empty);
            }
            for (Group group : groups.values()) {
                Ctx g = group.representative;
                Object[] values = new Object[group.accumulators.length];
                for (int i = 0; i < values.length; i++) {
                    values[i] = group.accumulators[i].result();
                }
                g.aggregates = values;
                if (having != null && !Operators.isTrue(having.eval(g))) {
                    continue;
                }
                results.add(project(outputs, sortEvals, g));
            }
        }
        List<Output> finalRows = heap != null ? new ArrayList<>(heap) : results;
        if (st.distinct()) {
            Map<List<Object>, Output> unique = new LinkedHashMap<>();
            for (Output o : finalRows) {
                Object[] key = new Object[o.values().length];
                for (int i = 0; i < key.length; i++) {
                    key[i] = Values.indexKey(o.values()[i]);
                }
                unique.putIfAbsent(Arrays.asList(key), o);
            }
            finalRows = new ArrayList<>(unique.values());
        }
        if (orders > 0 && (!ordered || aggregate || heap != null || st.distinct())) {
            finalRows.sort(comparator);
        }
        int from = (int) Math.min(offset, finalRows.size());
        int to = limit < 0 ? finalRows.size() : (int) Math.min(finalRows.size(), from + limit);
        List<Object[]> rows = new ArrayList<>(Math.max(0, to - from));
        for (int i = from; i < to; i++) {
            rows.add(finalRows.get(i).values());
        }
        return SqlResult.query(labels, rows);
    }

    private static boolean isSourceColumn(List<Binder.Source> sources, String column) {
        for (Binder.Source s : sources) {
            if (s.schema().position(column) >= 0) {
                return true;
            }
        }
        return false;
    }

    /** HAVING may name select aliases: replace them by the aliased expression. */
    private static Expr resolveAliases(Expr e, Map<String, Expr> aliases) {
        if (aliases.isEmpty()) {
            return e;
        }
        if (e instanceof Expr.Column c && c.table() == null && aliases.containsKey(c.column())) {
            return aliases.get(c.column());
        }
        if (e instanceof Expr.Binary b) {
            return new Expr.Binary(b.op(), resolveAliases(b.left(), aliases), resolveAliases(b.right(), aliases));
        }
        if (e instanceof Expr.Unary u) {
            return new Expr.Unary(u.op(), resolveAliases(u.operand(), aliases));
        }
        if (e instanceof Expr.In in) {
            return new Expr.In(resolveAliases(in.operand(), aliases), in.values(), in.not());
        }
        if (e instanceof Expr.Between b) {
            return new Expr.Between(resolveAliases(b.operand(), aliases), b.low(), b.high(), b.not());
        }
        if (e instanceof Expr.IsNull n) {
            return new Expr.IsNull(resolveAliases(n.operand(), aliases), n.not());
        }
        return e;
    }

    private SqlException tooLarge() {
        return new SqlException("Result has more than " + maxResultRows + " rows; add a LIMIT or narrow the WHERE clause (max-result-rows)");
    }

    private static Output project(List<Eval> outputs, Eval[] sortEvals, Ctx ctx) {
        Object[] values = new Object[outputs.size()];
        for (int i = 0; i < values.length; i++) {
            values[i] = outputs.get(i).eval(ctx);
        }
        Object[] keys = new Object[sortEvals.length];
        for (int i = 0; i < keys.length; i++) {
            keys[i] = sortEvals[i].eval(ctx);
        }
        return new Output(values, keys);
    }

    private static Eval and(Binder binder, List<Expr> conditions) {
        if (conditions.isEmpty()) {
            return null;
        }
        Eval[] evals = conditions.stream().map(binder::bind).toArray(Eval[]::new);
        if (evals.length == 1) {
            return evals[0];
        }
        return ctx -> {
            for (Eval e : evals) {
                if (!Operators.isTrue(e.eval(ctx))) {
                    return false;
                }
            }
            return true;
        };
    }

    // =================================================================== INSERT

    private SqlResult insert(Keyspace ks, Statement.Insert st, Object[] params) {
        Table table = lockForWrite(ks, st.table());
        try {
            TableSchema schema = table.schema();
            int[] positions;
            if (st.columns() == null) {
                positions = new int[schema.size()];
                for (int i = 0; i < positions.length; i++) {
                    positions[i] = i;
                }
            } else {
                positions = new int[st.columns().size()];
                Set<String> seen = new HashSet<>();
                for (int i = 0; i < positions.length; i++) {
                    String name = st.columns().get(i);
                    if (!seen.add(name)) {
                        throw new SqlException("Column listed twice: " + name);
                    }
                    positions[i] = schema.position(name);
                    if (positions[i] < 0) {
                        throw new SqlException("Column not found: " + name);
                    }
                }
            }
            Binder binder = new Binder(List.of(), false);
            Ctx ctx = new Ctx(0, params);
            int pk = -1;
            for (int i = 0; i < schema.size(); i++) {
                if (schema.column(i).primaryKey() && schema.column(i).type() == ColumnType.INTEGER) {
                    pk = i;
                }
            }
            long nextAuto = -1;

            // phase 1: build, coerce and check every row without touching the table
            List<Object[]> newRows = new ArrayList<>(st.rows().size());
            long bytes = 0;
            for (List<Expr> exprs : st.rows()) {
                if (exprs.size() != positions.length) {
                    throw new SqlException("Column count does not match value count");
                }
                Object[] values = new Object[schema.size()];
                boolean[] given = new boolean[schema.size()];
                for (int i = 0; i < schema.size(); i++) {
                    values[i] = schema.column(i).defaultValue();
                }
                for (int i = 0; i < positions.length; i++) {
                    values[positions[i]] = binder.bind(exprs.get(i)).eval(ctx);
                    given[positions[i]] = true;
                }
                if (pk >= 0 && values[pk] == null) {
                    if (nextAuto < 0) {
                        Index pkIndex = table.indexOn(schema.column(pk).name());
                        Object last = pkIndex == null ? null : pkIndex.lastValue();
                        long max = last instanceof Number num ? num.longValue() : 0;
                        nextAuto = Math.max(max, table.lastRowId()) + 1;
                    }
                    values[pk] = nextAuto++;
                } else if (pk >= 0 && values[pk] instanceof Number num && nextAuto >= 0) {
                    nextAuto = Math.max(nextAuto, num.longValue() + 1);
                }
                coerceRow(schema, values, given);
                newRows.add(values);
                bytes += 64 + 24L * values.length;
            }
            storage.reserveMemory(bytes);

            // phase 2: uniqueness (against the table and within the statement)
            if (!st.replace()) {
                for (Index index : table.indexes()) {
                    if (!index.unique()) {
                        continue;
                    }
                    Set<Object> batch = new HashSet<>();
                    for (Object[] values : newRows) {
                        Object v = values[index.position()];
                        if (v == null) {
                            continue;
                        }
                        if (index.conflict(v, -1) >= 0 || !batch.add(Values.indexKey(v))) {
                            throw new SqlException("UNIQUE constraint failed: " + table.name() + "." + index.column() + " = " + render(v));
                        }
                    }
                }
            }

            // phase 3: log and apply
            CompletableFuture<Void> durable = DONE;
            long lastRowId = -1;
            for (Object[] values : newRows) {
                if (st.replace()) {
                    for (Index index : table.indexes()) {
                        if (!index.unique()) {
                            continue;
                        }
                        long conflict;
                        while ((conflict = index.conflict(values[index.position()], -1)) >= 0) {
                            storage.logTableMutation(ks, new Mutation.DeleteRow(ks.id(), table.name(), conflict));
                            table.remove(conflict);
                        }
                    }
                }
                long rowId = table.nextRowId();
                durable = storage.logTableMutation(ks, new Mutation.PutRow(ks.id(), table.name(), rowId, values));
                table.put(rowId, values);
                lastRowId = rowId;
            }
            int count = newRows.size();
            String message = count == 1 ? "1 row inserted" : count + " rows inserted";
            return SqlResult.change(count, message, lastRowId, durable);
        } finally {
            table.lock().writeLock().unlock();
        }
    }

    private static void coerceRow(TableSchema schema, Object[] values, boolean[] given) {
        for (int i = 0; i < schema.size(); i++) {
            Column c = schema.column(i);
            try {
                values[i] = c.type().coerce(values[i], c.name());
            } catch (IllegalArgumentException e) {
                throw new SqlException(e.getMessage());
            }
            if (values[i] == null && c.notNull()) {
                throw new SqlException("NOT NULL constraint failed: " + c.name() + (given != null && !given[i] ? " (no value given)" : ""));
            }
        }
    }

    private static String render(Object v) {
        return v instanceof String ? "'" + v + "'" : String.valueOf(v);
    }

    // =================================================================== UPDATE / DELETE

    /** Row ids matching WHERE (and LIMIT) of an UPDATE/DELETE, via the best access path. */
    private List<Long> matchingRows(Table table, String tableName, Expr where, Expr limitExpr, Object[] params,
                                    Binder binder, List<Object[]> planOut) {
        List<Expr> conditions = conjuncts(where);
        Path path = plan(binder, table, conditions, null, null);
        Eval filter = and(binder, conditions);
        long limit = constantLong(binder, limitExpr, params, "LIMIT");
        if (planOut != null) {
            planOut.add(new Object[]{path.describe(tableName)});
            if (filter != null) {
                planOut.add(new Object[]{"FILTER " + tableName});
            }
            if (limit >= 0) {
                planOut.add(new Object[]{"LIMIT " + limit});
            }
            return List.of();
        }
        List<Long> ids = new ArrayList<>();
        Ctx ctx = new Ctx(1, params);
        if (limit == 0) {
            return ids;
        }
        run(path, table, ctx, (id, row) -> {
            ctx.rows[0] = row;
            ctx.ids[0] = id;
            if (filter == null || Operators.isTrue(filter.eval(ctx))) {
                ids.add(id);
                return limit < 0 || ids.size() < limit;
            }
            return true;
        });
        return ids;
    }

    private SqlResult update(Keyspace ks, Statement.Update st, Object[] params, boolean explain) {
        Table table = lockForWrite(ks, st.table());
        try {
            TableSchema schema = table.schema();
            Binder binder = new Binder(List.of(new Binder.Source(st.table(), st.table(), schema)), false);
            int[] positions = new int[st.assignments().size()];
            Eval[] values = new Eval[positions.length];
            for (int i = 0; i < positions.length; i++) {
                Statement.Assignment a = st.assignments().get(i);
                positions[i] = schema.position(a.column());
                if (positions[i] < 0) {
                    throw new SqlException("Column not found: " + a.column());
                }
                values[i] = binder.bind(a.value());
            }
            List<Object[]> plan = explain ? new ArrayList<>() : null;
            List<Long> ids = matchingRows(table, st.table(), st.where(), st.limit(), params, binder, plan);
            if (explain) {
                plan.add(new Object[]{"UPDATE " + st.table()});
                return SqlResult.query(List.of("plan"), plan);
            }

            // compute and validate every new row first
            Ctx ctx = new Ctx(1, params);
            Map<Long, Object[]> changed = new LinkedHashMap<>();
            for (long id : ids) {
                Object[] old = table.row(id);
                ctx.rows[0] = old;
                ctx.ids[0] = id;
                Object[] next = Arrays.copyOf(old, schema.size());
                for (int i = 0; i < positions.length; i++) {
                    next[positions[i]] = values[i].eval(ctx);
                }
                coerceRow(schema, next, null);
                changed.put(id, next);
            }
            for (Index index : table.indexes()) {
                if (!index.unique()) {
                    continue;
                }
                Map<Object, Long> batch = new HashMap<>();
                for (Map.Entry<Long, Object[]> e : changed.entrySet()) {
                    Object v = e.getValue()[index.position()];
                    if (v == null) {
                        continue;
                    }
                    Long other = batch.put(Values.indexKey(v), e.getKey());
                    long conflict = index.conflict(v, e.getKey());
                    boolean conflictMoves = conflict >= 0 && changed.containsKey(conflict)
                            && !Values.sqlEquals(changed.get(conflict)[index.position()], v);
                    if ((other != null && other != e.getKey().longValue()) || (conflict >= 0 && !conflictMoves)) {
                        throw new SqlException("UNIQUE constraint failed: " + table.name() + "." + index.column() + " = " + render(v));
                    }
                }
            }
            CompletableFuture<Void> durable = DONE;
            // an index tolerates a value held by two rows for a moment, so swapped unique values apply row by row
            for (Map.Entry<Long, Object[]> e : changed.entrySet()) {
                durable = storage.logTableMutation(ks, new Mutation.PutRow(ks.id(), table.name(), e.getKey(), e.getValue()));
                table.put(e.getKey(), e.getValue());
            }
            return SqlResult.change(changed.size(), changed.size() + " row(s) updated", null, durable);
        } finally {
            table.lock().writeLock().unlock();
        }
    }

    private SqlResult delete(Keyspace ks, Statement.Delete st, Object[] params, boolean explain) {
        Table table = lockForWrite(ks, st.table());
        try {
            Binder binder = new Binder(List.of(new Binder.Source(st.table(), st.table(), table.schema())), false);
            List<Object[]> plan = explain ? new ArrayList<>() : null;
            List<Long> ids = matchingRows(table, st.table(), st.where(), st.limit(), params, binder, plan);
            if (explain) {
                plan.add(new Object[]{"DELETE FROM " + st.table()});
                return SqlResult.query(List.of("plan"), plan);
            }
            CompletableFuture<Void> durable = DONE;
            for (long id : ids) {
                durable = storage.logTableMutation(ks, new Mutation.DeleteRow(ks.id(), table.name(), id));
                table.remove(id);
            }
            return SqlResult.change(ids.size(), ids.size() + " row(s) deleted", null, durable);
        } finally {
            table.lock().writeLock().unlock();
        }
    }

    // =================================================================== DUMP / IMPORT

    /** Every table of the keyspace as JSON: {@code {name: {columns, indexes, rows}}}. */
    public org.json.JSONObject dumpTables(Keyspace ks) {
        org.json.JSONObject result = new org.json.JSONObject();
        for (Map.Entry<String, Table> entry : ks.tables().entrySet()) {
            Table table = entry.getValue();
            table.lock().readLock().lock();
            try {
                org.json.JSONObject def = new org.json.JSONObject(table.schema().toJson());
                org.json.JSONArray indexes = new org.json.JSONArray();
                for (Index index : table.explicitIndexes()) {
                    indexes.put(new org.json.JSONObject().put("name", index.name()).put("column", index.column()).put("unique", index.unique()));
                }
                org.json.JSONArray rows = new org.json.JSONArray();
                for (Object[] row : table.rows().values()) {
                    org.json.JSONArray values = new org.json.JSONArray();
                    for (Object v : row) {
                        values.put(SqlResult.json(v));
                    }
                    rows.put(values);
                }
                def.put("indexes", indexes);
                def.put("rows", rows);
                result.put(entry.getKey(), def);
            } finally {
                table.lock().readLock().unlock();
            }
        }
        return result;
    }

    /**
     * Create a table from a {@link #dumpTables} entry. With {@code replace} an
     * existing table of that name is dropped first; otherwise it is an error.
     *
     * @return rows imported
     */
    public long importTable(Keyspace ks, String name, org.json.JSONObject def, boolean replace) {
        String table = name.toLowerCase(Locale.ROOT);
        TableSchema schema;
        try {
            schema = TableSchema.fromJson(new org.json.JSONObject().put("columns", def.getJSONArray("columns")).toString());
        } catch (RuntimeException e) {
            throw new SqlException("Bad table definition for " + table + ": " + e.getMessage());
        }
        if (ks.table(table) != null) {
            if (!replace) {
                throw new SqlException("Table already exists: " + table + " (import with replace to overwrite)");
            }
            dropTable(ks, new Statement.DropTable(table, true));
        }
        storage.reserveMemory(1024);
        Table created = storage.newTable(table, schema);
        created.lock().writeLock().lock();
        try {
            if (ks.tables().putIfAbsent(table, created) != null) {
                throw new SqlException("Table already exists: " + table);
            }
            storage.logTableMutation(ks, new Mutation.CreateTable(ks.id(), table, schema.toJson()));
            org.json.JSONArray rows = def.optJSONArray("rows");
            long count = 0;
            for (int r = 0; rows != null && r < rows.length(); r++) {
                org.json.JSONArray source = rows.getJSONArray(r);
                Object[] values = new Object[schema.size()];
                for (int i = 0; i < values.length && i < source.length(); i++) {
                    values[i] = fromJson(source.opt(i));
                }
                coerceRow(schema, values, null);
                String violation = created.uniqueViolation(values, -1);
                if (violation != null) {
                    throw new SqlException("UNIQUE constraint failed while importing " + table + "." + violation);
                }
                long rowId = created.nextRowId();
                storage.logTableMutation(ks, new Mutation.PutRow(ks.id(), table, rowId, values));
                created.put(rowId, values);
                count++;
            }
            org.json.JSONArray indexes = def.optJSONArray("indexes");
            for (int i = 0; indexes != null && i < indexes.length(); i++) {
                org.json.JSONObject index = indexes.getJSONObject(i);
                String indexName = index.getString("name");
                try {
                    created.createIndex(indexName, index.getString("column"), index.optBoolean("unique"));
                } catch (IllegalArgumentException e) {
                    throw new SqlException(e.getMessage());
                }
                storage.logTableMutation(ks, new Mutation.CreateIndex(ks.id(), table, indexName, index.getString("column"), index.optBoolean("unique")));
            }
            return count;
        } finally {
            created.lock().writeLock().unlock();
        }
    }

    /** JSON value (org.json) to a SQL value. */
    public static Object fromJson(Object v) {
        if (v == null || v == org.json.JSONObject.NULL) {
            return null;
        }
        if (v instanceof Integer i) {
            return i.longValue();
        }
        if (v instanceof Long || v instanceof Double || v instanceof Boolean || v instanceof String) {
            return v;
        }
        if (v instanceof java.math.BigDecimal bd) {
            return bd.stripTrailingZeros().scale() <= 0 && bd.abs().compareTo(java.math.BigDecimal.valueOf(Long.MAX_VALUE)) <= 0
                    ? (Object) bd.longValueExact() : (Object) bd.doubleValue();
        }
        if (v instanceof java.math.BigInteger bi) {
            return bi.bitLength() < 64 ? (Object) bi.longValue() : (Object) bi.doubleValue();
        }
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        return v.toString();
    }
}
