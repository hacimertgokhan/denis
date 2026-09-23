package github.hacimertgokhan.denis.sql.exec;

import github.hacimertgokhan.denis.sql.SqlException;
import github.hacimertgokhan.denis.sql.ast.Expr;
import github.hacimertgokhan.denis.storage.table.TableSchema;
import github.hacimertgokhan.denis.storage.table.Values;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Binds parsed expressions to a scope (the tables of a query) and compiles
 * them into {@link Eval} closures, so evaluation does no name lookups.
 *
 * <p>In aggregate mode, aggregate calls are collected into {@link #aggregates()}
 * and replaced by a read of the group's result slot.
 */
public final class Binder {
    /** Pseudo column available on every table. */
    public static final String ROWID = "_rowid";

    /** A table in scope: its name for qualification (alias or table name) and schema. */
    public record Source(String name, String table, TableSchema schema) {}

    /** A resolved column: source index and position; position -1 is the row id. */
    public record ColumnRef(int source, int position) {}

    private final List<Source> sources;
    private final List<Aggregates.Spec> aggregates = new ArrayList<>();
    private final boolean aggregateMode;

    public Binder(List<Source> sources, boolean aggregateMode) {
        this.sources = sources;
        this.aggregateMode = aggregateMode;
    }

    public List<Aggregates.Spec> aggregates() {
        return aggregates;
    }

    public List<Source> sources() {
        return sources;
    }

    public ColumnRef resolve(String table, String column) {
        if (table != null) {
            for (int i = 0; i < sources.size(); i++) {
                Source s = sources.get(i);
                if (s.name().equals(table) || (s.table().equals(table) && !hasAlias(table))) {
                    return column(i, column, table);
                }
            }
            throw new SqlException("Unknown table or alias: " + table);
        }
        ColumnRef found = null;
        for (int i = 0; i < sources.size(); i++) {
            int position = sources.get(i).schema().position(column);
            if (position >= 0) {
                if (found != null) {
                    throw new SqlException("Ambiguous column: " + column + " (qualify it with a table name)");
                }
                found = new ColumnRef(i, position);
            }
        }
        if (found == null && column.equals(ROWID) && sources.size() == 1) {
            return new ColumnRef(0, -1);
        }
        if (found == null) {
            throw new SqlException("Column not found: " + column);
        }
        return found;
    }

    private boolean hasAlias(String table) {
        for (Source s : sources) {
            if (s.name().equals(table)) {
                return true;
            }
        }
        return false;
    }

    private ColumnRef column(int source, String column, String qualifier) {
        if (column.equals(ROWID)) {
            return new ColumnRef(source, -1);
        }
        int position = sources.get(source).schema().position(column);
        if (position < 0) {
            throw new SqlException("Column not found: " + qualifier + "." + column);
        }
        return new ColumnRef(source, position);
    }

    /** Whether the expression references no column (constants and parameters only). */
    public static boolean isConstant(Expr e) {
        if (e instanceof Expr.Literal || e instanceof Expr.Param) {
            return true;
        }
        if (e instanceof Expr.Column) {
            return false;
        }
        if (e instanceof Expr.Unary u) {
            return isConstant(u.operand());
        }
        if (e instanceof Expr.Binary b) {
            return isConstant(b.left()) && isConstant(b.right());
        }
        if (e instanceof Expr.Function f) {
            if (Aggregates.NAMES.contains(f.name()) || f.name().equals("random")) {
                return false;
            }
            for (Expr a : f.args()) {
                if (!isConstant(a)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    /** Indexes of the sources an expression reads. */
    public void sourcesOf(Expr e, java.util.Set<Integer> into) {
        if (e instanceof Expr.Column c) {
            into.add(resolve(c.table(), c.column()).source());
        } else if (e instanceof Expr.Unary u) {
            sourcesOf(u.operand(), into);
        } else if (e instanceof Expr.Binary b) {
            sourcesOf(b.left(), into);
            sourcesOf(b.right(), into);
        } else if (e instanceof Expr.In in) {
            sourcesOf(in.operand(), into);
            in.values().forEach(v -> sourcesOf(v, into));
        } else if (e instanceof Expr.Between b) {
            sourcesOf(b.operand(), into);
            sourcesOf(b.low(), into);
            sourcesOf(b.high(), into);
        } else if (e instanceof Expr.Like l) {
            sourcesOf(l.operand(), into);
            sourcesOf(l.pattern(), into);
        } else if (e instanceof Expr.IsNull n) {
            sourcesOf(n.operand(), into);
        } else if (e instanceof Expr.Case c) {
            c.when().forEach(v -> sourcesOf(v, into));
            c.then().forEach(v -> sourcesOf(v, into));
            if (c.otherwise() != null) {
                sourcesOf(c.otherwise(), into);
            }
        } else if (e instanceof Expr.Function f) {
            f.args().forEach(v -> sourcesOf(v, into));
        }
    }

    public static boolean containsAggregate(Expr e) {
        if (e instanceof Expr.Function f) {
            if (Aggregates.NAMES.contains(f.name())) {
                return true;
            }
            return f.args().stream().anyMatch(Binder::containsAggregate);
        }
        if (e instanceof Expr.Unary u) {
            return containsAggregate(u.operand());
        }
        if (e instanceof Expr.Binary b) {
            return containsAggregate(b.left()) || containsAggregate(b.right());
        }
        if (e instanceof Expr.In in) {
            return containsAggregate(in.operand()) || in.values().stream().anyMatch(Binder::containsAggregate);
        }
        if (e instanceof Expr.Between b) {
            return containsAggregate(b.operand()) || containsAggregate(b.low()) || containsAggregate(b.high());
        }
        if (e instanceof Expr.Like l) {
            return containsAggregate(l.operand()) || containsAggregate(l.pattern());
        }
        if (e instanceof Expr.IsNull n) {
            return containsAggregate(n.operand());
        }
        if (e instanceof Expr.Case c) {
            return c.when().stream().anyMatch(Binder::containsAggregate)
                    || c.then().stream().anyMatch(Binder::containsAggregate)
                    || (c.otherwise() != null && containsAggregate(c.otherwise()));
        }
        return false;
    }

    public Eval bind(Expr e) {
        if (e instanceof Expr.Literal lit) {
            Object v = lit.value();
            return ctx -> v;
        }
        if (e instanceof Expr.Param p) {
            int index = p.index();
            return ctx -> {
                if (ctx.params == null || index >= ctx.params.length) {
                    throw new SqlException("Missing value for parameter " + (index + 1));
                }
                return ctx.params[index];
            };
        }
        if (e instanceof Expr.Column c) {
            ColumnRef ref = resolve(c.table(), c.column());
            int source = ref.source();
            int position = ref.position();
            if (position < 0) {
                return ctx -> ctx.rows[source] == null ? null : ctx.ids[source];
            }
            return ctx -> {
                Object[] row = ctx.rows[source];
                return row == null || position >= row.length ? null : row[position];
            };
        }
        if (e instanceof Expr.Unary u) {
            Eval operand = bind(u.operand());
            if (u.op().equals("NOT")) {
                return ctx -> Operators.not(operand.eval(ctx));
            }
            return ctx -> Operators.negate(operand.eval(ctx));
        }
        if (e instanceof Expr.Binary b) {
            return binary(b);
        }
        if (e instanceof Expr.In in) {
            Eval operand = bind(in.operand());
            List<Eval> values = new ArrayList<>();
            for (Expr v : in.values()) {
                values.add(bind(v));
            }
            boolean not = in.not();
            return ctx -> {
                Object v = operand.eval(ctx);
                if (v == null) {
                    return null;
                }
                boolean sawNull = false;
                for (Eval candidate : values) {
                    Object c = candidate.eval(ctx);
                    if (c == null) {
                        sawNull = true;
                    } else if (Values.sqlEquals(v, c)) {
                        return !not;
                    }
                }
                return sawNull ? null : not;
            };
        }
        if (e instanceof Expr.Between b) {
            Eval operand = bind(b.operand());
            Eval low = bind(b.low());
            Eval high = bind(b.high());
            boolean not = b.not();
            return ctx -> {
                Object v = operand.eval(ctx);
                Object inside = Operators.and(Operators.comparison(">=", v, low.eval(ctx)), Operators.comparison("<=", v, high.eval(ctx)));
                return not ? Operators.not(inside) : inside;
            };
        }
        if (e instanceof Expr.Like l) {
            Eval operand = bind(l.operand());
            boolean not = l.not();
            if (l.pattern() instanceof Expr.Literal lit && lit.value() != null) {
                Pattern pattern = Operators.likePattern(lit.value().toString());
                return ctx -> {
                    Object v = operand.eval(ctx);
                    return v == null ? null : pattern.matcher(Operators.text(v)).matches() != not;
                };
            }
            Eval patternEval = bind(l.pattern());
            return ctx -> {
                Object v = operand.eval(ctx);
                Object p = patternEval.eval(ctx);
                if (v == null || p == null) {
                    return null;
                }
                return Operators.likePattern(p.toString()).matcher(Operators.text(v)).matches() != not;
            };
        }
        if (e instanceof Expr.IsNull n) {
            Eval operand = bind(n.operand());
            boolean not = n.not();
            return ctx -> (operand.eval(ctx) == null) != not;
        }
        if (e instanceof Expr.Case c) {
            Eval[] when = c.when().stream().map(this::bind).toArray(Eval[]::new);
            Eval[] then = c.then().stream().map(this::bind).toArray(Eval[]::new);
            Eval otherwise = c.otherwise() == null ? null : bind(c.otherwise());
            return ctx -> {
                for (int i = 0; i < when.length; i++) {
                    if (Operators.isTrue(when[i].eval(ctx))) {
                        return then[i].eval(ctx);
                    }
                }
                return otherwise == null ? null : otherwise.eval(ctx);
            };
        }
        if (e instanceof Expr.Function f) {
            return function(f);
        }
        throw new SqlException("Unsupported expression");
    }

    private Eval binary(Expr.Binary b) {
        Eval left = bind(b.left());
        Eval right = bind(b.right());
        String op = b.op();
        return switch (op) {
            case "AND" -> ctx -> {
                Object l = left.eval(ctx);
                if (l != null && !Operators.isTrue(l)) {
                    return false;
                }
                return Operators.and(l, right.eval(ctx));
            };
            case "OR" -> ctx -> {
                Object l = left.eval(ctx);
                if (l != null && Operators.isTrue(l)) {
                    return true;
                }
                return Operators.or(l, right.eval(ctx));
            };
            case "=", "!=", "<", "<=", ">", ">=" -> ctx -> Operators.comparison(op, left.eval(ctx), right.eval(ctx));
            case "||" -> ctx -> {
                Object l = left.eval(ctx);
                Object r = right.eval(ctx);
                return l == null || r == null ? null : Operators.text(l) + Operators.text(r);
            };
            default -> ctx -> Operators.arithmetic(op, left.eval(ctx), right.eval(ctx));
        };
    }

    private Eval function(Expr.Function f) {
        if (Aggregates.NAMES.contains(f.name())) {
            if (!aggregateMode) {
                throw new SqlException("Aggregate " + f.name().toUpperCase(java.util.Locale.ROOT) + "() is not allowed here");
            }
            if (f.args().stream().anyMatch(Binder::containsAggregate)) {
                throw new SqlException("Aggregates cannot be nested");
            }
            Binder inner = new Binder(sources, false);
            Eval argument;
            Eval separator = null;
            if (f.star()) {
                if (!f.name().equals("count")) {
                    throw new SqlException(f.name() + "(*) is not valid");
                }
                argument = null;
            } else {
                int max = f.name().equals("group_concat") ? 2 : 1;
                if (f.args().isEmpty() || f.args().size() > max) {
                    throw new SqlException(f.name() + "() takes " + (max == 1 ? "one argument" : "one or two arguments"));
                }
                argument = inner.bind(f.args().get(0));
                if (f.args().size() == 2) {
                    separator = inner.bind(f.args().get(1));
                }
            }
            int slot = aggregates.size();
            aggregates.add(new Aggregates.Spec(f.name(), argument, f.distinct(), separator));
            return ctx -> ctx.aggregates[slot];
        }
        if (f.star()) {
            throw new SqlException(f.name() + "(*) is not valid");
        }
        List<Eval> args = new ArrayList<>();
        for (Expr a : f.args()) {
            args.add(bind(a));
        }
        return Functions.bind(f.name(), args);
    }
}
