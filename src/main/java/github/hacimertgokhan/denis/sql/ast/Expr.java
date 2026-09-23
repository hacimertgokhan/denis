package github.hacimertgokhan.denis.sql.ast;

import java.util.List;

/** Unbound expression tree produced by the parser; the planner binds names to positions. */
public sealed interface Expr {

    record Literal(Object value) implements Expr {}

    /** {@code ?} placeholder, numbered from 0 in order of appearance. */
    record Param(int index) implements Expr {}

    /** Column reference; {@code table} is the table name or alias, or null. Names are lower case. */
    record Column(String table, String column) implements Expr {}

    /** {@code -x}, {@code +x}, {@code NOT x}. */
    record Unary(String op, Expr operand) implements Expr {}

    /** Arithmetic ({@code + - * / %}), {@code ||}, comparison ({@code = != < <= > >=}), {@code AND}, {@code OR}. */
    record Binary(String op, Expr left, Expr right) implements Expr {}

    record In(Expr operand, List<Expr> values, boolean not) implements Expr {}

    record Between(Expr operand, Expr low, Expr high, boolean not) implements Expr {}

    record Like(Expr operand, Expr pattern, boolean not) implements Expr {}

    record IsNull(Expr operand, boolean not) implements Expr {}

    record Case(List<Expr> when, List<Expr> then, Expr otherwise) implements Expr {}

    /** Function call; {@code star} for {@code COUNT(*)}. Name is lower case. */
    record Function(String name, List<Expr> args, boolean star, boolean distinct) implements Expr {}
}
