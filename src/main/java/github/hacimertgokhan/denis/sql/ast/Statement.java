package github.hacimertgokhan.denis.sql.ast;

import java.util.List;

/** Parsed statements. Immutable, so a parsed statement is cached and shared between connections. */
public sealed interface Statement {

    /** Number of {@code ?} placeholders; set by the parser. */
    default int parameterCount() {
        return 0;
    }

    record ColumnSpec(String name, String declaredType, boolean notNull, boolean primaryKey, boolean unique,
                      Object defaultValue) {}

    record CreateTable(String table, boolean ifNotExists, List<ColumnSpec> columns) implements Statement {}

    record DropTable(String table, boolean ifExists) implements Statement {}

    record AlterAddColumn(String table, ColumnSpec column) implements Statement {}

    record CreateIndex(String name, String table, String column, boolean unique, boolean ifNotExists) implements Statement {}

    record DropIndex(String name, String table, boolean ifExists) implements Statement {}

    record Truncate(String table) implements Statement {}

    record ShowTables() implements Statement {}

    record ShowIndexes(String table) implements Statement {}

    record Describe(String table) implements Statement {}

    record Explain(Statement statement, int parameterCount) implements Statement {
        @Override
        public int parameterCount() {
            return parameterCount;
        }
    }

    /** {@code columns} null means all columns in table order. */
    record Insert(String table, List<String> columns, List<List<Expr>> rows, boolean replace, int parameterCount) implements Statement {
        @Override
        public int parameterCount() {
            return parameterCount;
        }
    }

    record Assignment(String column, Expr value) {}

    record Update(String table, List<Assignment> assignments, Expr where, Expr limit, int parameterCount) implements Statement {
        @Override
        public int parameterCount() {
            return parameterCount;
        }
    }

    record Delete(String table, Expr where, Expr limit, int parameterCount) implements Statement {
        @Override
        public int parameterCount() {
            return parameterCount;
        }
    }

    enum ItemKind { ALL, TABLE_ALL, EXPR }

    /** One item of the select list; {@code label} is the alias or the expression text. */
    record SelectItem(ItemKind kind, String table, Expr expr, String label, boolean aliased) {}

    record TableRef(String table, String alias) {
        public String name() {
            return alias != null ? alias : table;
        }
    }

    enum JoinType { INNER, LEFT, CROSS }

    record Join(JoinType type, TableRef table, Expr on) {}

    record Order(Expr expr, boolean descending) {}

    record Select(boolean distinct, List<SelectItem> items, TableRef from, List<Join> joins, Expr where,
                  List<Expr> groupBy, Expr having, List<Order> orderBy, Expr limit, Expr offset,
                  int parameterCount) implements Statement {
        @Override
        public int parameterCount() {
            return parameterCount;
        }
    }
}
