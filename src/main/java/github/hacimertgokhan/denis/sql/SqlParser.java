package github.hacimertgokhan.denis.sql;

import github.hacimertgokhan.denis.sql.ast.Expr;
import github.hacimertgokhan.denis.sql.ast.Statement;
import github.hacimertgokhan.denis.sql.parser.DenisSqlBaseVisitor;
import github.hacimertgokhan.denis.sql.parser.DenisSqlLexer;
import github.hacimertgokhan.denis.sql.parser.DenisSqlParser;
import org.antlr.v4.runtime.BaseErrorListener;
import org.antlr.v4.runtime.CharStreams;
import org.antlr.v4.runtime.CommonTokenStream;
import org.antlr.v4.runtime.ParserRuleContext;
import org.antlr.v4.runtime.RecognitionException;
import org.antlr.v4.runtime.Recognizer;
import org.antlr.v4.runtime.Token;
import org.antlr.v4.runtime.atn.PredictionMode;
import org.antlr.v4.runtime.misc.Interval;
import org.antlr.v4.runtime.misc.ParseCancellationException;
import org.antlr.v4.runtime.tree.TerminalNode;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Turns SQL text into an immutable {@link Statement}.
 *
 * <p>Parsing uses ANTLR's two-stage strategy: the fast SLL prediction mode
 * with a bail-out error strategy first, and the full LL mode only when SLL
 * fails (which for this grammar is practically never on valid input). Parsed
 * statements are kept in a small cache keyed by the exact text, so a
 * client that repeats a query shape with {@code ?} parameters pays for
 * parsing once.
 */
public final class SqlParser {
    private static final int CACHE_SIZE = 1024;
    // lock-free reads: every SQL command of every worker looks here; when full it is simply cleared
    private static final Map<String, Statement> CACHE = new ConcurrentHashMap<>(CACHE_SIZE * 2);

    private SqlParser() {
    }

    public static Statement parse(String sql) {
        String text = normalize(sql);
        Statement cached = CACHE.get(text);
        if (cached != null) {
            return cached;
        }
        Statement statement = parseUncached(text);
        if (text.length() <= 4096) {
            if (CACHE.size() >= CACHE_SIZE) {
                CACHE.clear();
            }
            CACHE.put(text, statement);
        }
        return statement;
    }

    /** Strip an optional leading {@code SQL} keyword and trailing semicolons/whitespace. */
    public static String normalize(String sql) {
        String text = sql == null ? "" : sql.strip();
        if (text.length() > 4 && text.regionMatches(true, 0, "SQL ", 0, 4)) {
            text = text.substring(4).strip();
        }
        while (text.endsWith(";")) {
            text = text.substring(0, text.length() - 1).strip();
        }
        return text;
    }

    private static Statement parseUncached(String text) {
        if (text.isEmpty()) {
            throw new SqlException("Empty statement");
        }
        DenisSqlLexer lexer = new DenisSqlLexer(CharStreams.fromString(text));
        lexer.removeErrorListeners();
        lexer.addErrorListener(THROWING);
        CommonTokenStream tokens = new CommonTokenStream(lexer);
        DenisSqlParser parser = new DenisSqlParser(tokens);
        parser.removeErrorListeners();
        parser.getInterpreter().setPredictionMode(PredictionMode.SLL);
        parser.setErrorHandler(new org.antlr.v4.runtime.BailErrorStrategy());
        DenisSqlParser.ParseContext tree;
        try {
            tree = parser.parse();
        } catch (ParseCancellationException sllFailed) {
            tokens.seek(0);
            parser.reset();
            parser.addErrorListener(THROWING);
            parser.setErrorHandler(new org.antlr.v4.runtime.DefaultErrorStrategy());
            parser.getInterpreter().setPredictionMode(PredictionMode.LL);
            tree = parser.parse();
        }
        Builder builder = new Builder();
        return builder.statement(tree.statement());
    }

    private static final BaseErrorListener THROWING = new BaseErrorListener() {
        @Override
        public void syntaxError(Recognizer<?, ?> recognizer, Object offendingSymbol, int line, int position,
                                String msg, RecognitionException e) {
            String near = offendingSymbol instanceof Token token && token.getType() != Token.EOF
                    ? " near '" + token.getText() + "'" : "";
            throw new SqlException("Syntax error at position " + (position + 1) + near + ": " + msg);
        }
    };

    /** Parse tree → AST. One instance per statement (it numbers the {@code ?} placeholders). */
    private static final class Builder extends DenisSqlBaseVisitor<Object> {
        private int params;

        Statement statement(DenisSqlParser.StatementContext ctx) {
            ParserRuleContext child = (ParserRuleContext) ctx.getChild(0);
            if (child instanceof DenisSqlParser.CreateTableContext c) {
                return createTable(c);
            }
            if (child instanceof DenisSqlParser.DropTableContext c) {
                return new Statement.DropTable(id(c.identifier()), c.EXISTS() != null);
            }
            if (child instanceof DenisSqlParser.AlterTableContext c) {
                return new Statement.AlterAddColumn(id(c.identifier()), columnSpec(c.columnDef()));
            }
            if (child instanceof DenisSqlParser.CreateIndexContext c) {
                return new Statement.CreateIndex(id(c.indexName), id(c.table), id(c.column), c.UNIQUE() != null, c.EXISTS() != null);
            }
            if (child instanceof DenisSqlParser.DropIndexContext c) {
                return new Statement.DropIndex(id(c.indexName), c.table == null ? null : id(c.table), c.EXISTS() != null);
            }
            if (child instanceof DenisSqlParser.TruncateTableContext c) {
                return new Statement.Truncate(id(c.identifier()));
            }
            if (child instanceof DenisSqlParser.ShowTablesContext) {
                return new Statement.ShowTables();
            }
            if (child instanceof DenisSqlParser.ShowIndexesContext c) {
                return new Statement.ShowIndexes(id(c.identifier()));
            }
            if (child instanceof DenisSqlParser.DescribeTableContext c) {
                return new Statement.Describe(id(c.identifier()));
            }
            if (child instanceof DenisSqlParser.ExplainStatementContext c) {
                Statement inner;
                if (c.selectStatement() != null) {
                    inner = select(c.selectStatement());
                } else if (c.updateStatement() != null) {
                    inner = update(c.updateStatement());
                } else {
                    inner = delete(c.deleteStatement());
                }
                return new Statement.Explain(inner, params);
            }
            if (child instanceof DenisSqlParser.InsertStatementContext c) {
                return insert(c);
            }
            if (child instanceof DenisSqlParser.SelectStatementContext c) {
                return select(c);
            }
            if (child instanceof DenisSqlParser.UpdateStatementContext c) {
                return update(c);
            }
            if (child instanceof DenisSqlParser.DeleteStatementContext c) {
                return delete(c);
            }
            throw new SqlException("Unsupported statement");
        }

        private Statement createTable(DenisSqlParser.CreateTableContext c) {
            List<Statement.ColumnSpec> columns = new ArrayList<>();
            String pk = null;
            List<String> uniques = new ArrayList<>();
            for (DenisSqlParser.TableElementContext element : c.tableElement()) {
                if (element.columnDef() != null) {
                    columns.add(columnSpec(element.columnDef()));
                } else if (element.tableConstraint() instanceof DenisSqlParser.TablePkContext tpk) {
                    if (pk != null) {
                        throw new SqlException("Only one PRIMARY KEY is supported");
                    }
                    pk = id(tpk.identifier());
                } else if (element.tableConstraint() instanceof DenisSqlParser.TableUniqueContext tu) {
                    uniques.add(id(tu.identifier()));
                }
            }
            List<Statement.ColumnSpec> resolved = new ArrayList<>();
            int primaryKeys = 0;
            for (Statement.ColumnSpec spec : columns) {
                boolean isPk = spec.primaryKey() || spec.name().equals(pk);
                boolean isUnique = spec.unique() || uniques.contains(spec.name());
                if (isPk) {
                    primaryKeys++;
                }
                resolved.add(new Statement.ColumnSpec(spec.name(), spec.declaredType(), spec.notNull() || isPk, isPk, isUnique,
                        spec.defaultValue()));
            }
            if (primaryKeys > 1) {
                throw new SqlException("Only one PRIMARY KEY is supported");
            }
            String primaryKey = pk;
            if (primaryKey != null && columns.stream().noneMatch(s -> s.name().equals(primaryKey))) {
                throw new SqlException("PRIMARY KEY column not found: " + pk);
            }
            return new Statement.CreateTable(id(c.name), c.EXISTS() != null, resolved);
        }

        private Statement.ColumnSpec columnSpec(DenisSqlParser.ColumnDefContext c) {
            String name = id(c.identifier());
            String type = c.typeName() == null ? "TEXT" : text(c.typeName()).toUpperCase(Locale.ROOT).replace(" ", "");
            boolean notNull = false;
            boolean pk = false;
            boolean unique = false;
            Object def = null;
            for (DenisSqlParser.ColumnConstraintContext constraint : c.columnConstraint()) {
                if (constraint instanceof DenisSqlParser.PkConstraintContext) {
                    pk = true;
                } else if (constraint instanceof DenisSqlParser.NotNullConstraintContext) {
                    notNull = true;
                } else if (constraint instanceof DenisSqlParser.UniqueConstraintContext) {
                    unique = true;
                } else if (constraint instanceof DenisSqlParser.DefaultConstraintContext d) {
                    def = defaultValue(d.defaultValue());
                }
            }
            return new Statement.ColumnSpec(name, type, notNull, pk, unique, def);
        }

        private Object defaultValue(DenisSqlParser.DefaultValueContext d) {
            if (d.number != null) {
                Object v = number(d.number.getText(), d.number.getType() == DenisSqlLexer.INTEGER_LITERAL);
                return v instanceof Long l ? -l : -(Double) v;
            }
            Expr expr = literal(d.literal());
            if (expr instanceof Expr.Literal lit) {
                return lit.value();
            }
            throw new SqlException("DEFAULT must be a constant");
        }

        private Statement insert(DenisSqlParser.InsertStatementContext c) {
            List<DenisSqlParser.IdentifierContext> ids = c.identifier();
            String table = id(ids.get(0));
            List<String> columns = null;
            if (ids.size() > 1) {
                columns = new ArrayList<>();
                for (int i = 1; i < ids.size(); i++) {
                    columns.add(id(ids.get(i)));
                }
            }
            List<List<Expr>> rows = new ArrayList<>();
            for (DenisSqlParser.ValuesRowContext row : c.valuesRow()) {
                List<Expr> values = new ArrayList<>();
                for (DenisSqlParser.ExprContext e : row.expr()) {
                    values.add(expr(e));
                }
                rows.add(values);
            }
            // REPLACE appears twice in the rule, so ANTLR generates a list accessor for it
            boolean replace = !c.REPLACE().isEmpty() || c.UPSERT() != null;
            return new Statement.Insert(table, columns, rows, replace, params);
        }

        private Statement update(DenisSqlParser.UpdateStatementContext c) {
            List<Statement.Assignment> assignments = new ArrayList<>();
            for (DenisSqlParser.AssignmentContext a : c.assignment()) {
                assignments.add(new Statement.Assignment(id(a.identifier()), expr(a.expr())));
            }
            Expr where = c.where == null ? null : expr(c.where);
            Expr limit = c.limit == null ? null : expr(c.limit);
            return new Statement.Update(id(c.identifier()), assignments, where, limit, params);
        }

        private Statement delete(DenisSqlParser.DeleteStatementContext c) {
            Expr where = c.where == null ? null : expr(c.where);
            Expr limit = c.limit == null ? null : expr(c.limit);
            return new Statement.Delete(id(c.identifier()), where, limit, params);
        }

        private Statement.Select select(DenisSqlParser.SelectStatementContext c) {
            List<Statement.SelectItem> items = new ArrayList<>();
            for (DenisSqlParser.SelectItemContext item : c.selectItem()) {
                if (item instanceof DenisSqlParser.AllColumnsContext) {
                    items.add(new Statement.SelectItem(Statement.ItemKind.ALL, null, null, "*", false));
                } else if (item instanceof DenisSqlParser.TableColumnsContext t) {
                    items.add(new Statement.SelectItem(Statement.ItemKind.TABLE_ALL, id(t.identifier()), null, id(t.identifier()) + ".*", false));
                } else {
                    DenisSqlParser.ExprColumnContext e = (DenisSqlParser.ExprColumnContext) item;
                    Expr expr = expr(e.expr());
                    boolean aliased = e.alias != null;
                    String label;
                    if (aliased) {
                        label = rawId(e.alias);
                    } else if (expr instanceof Expr.Column col) {
                        label = col.column();
                    } else {
                        label = text(e.expr());
                    }
                    items.add(new Statement.SelectItem(Statement.ItemKind.EXPR, null, expr, label, aliased));
                }
            }
            Statement.TableRef from = null;
            List<Statement.Join> joins = new ArrayList<>();
            if (c.tableRef() != null) {
                from = tableRef(c.tableRef());
                for (DenisSqlParser.JoinClauseContext j : c.joinClause()) {
                    Statement.JoinType type = j.LEFT() != null ? Statement.JoinType.LEFT
                            : j.CROSS() != null ? Statement.JoinType.CROSS : Statement.JoinType.INNER;
                    Expr on = j.expr() == null ? null : expr(j.expr());
                    if (on == null && type != Statement.JoinType.CROSS) {
                        throw new SqlException("JOIN needs an ON condition (or use CROSS JOIN)");
                    }
                    joins.add(new Statement.Join(type, tableRef(j.tableRef()), on));
                }
            }
            Expr where = c.where == null ? null : expr(c.where);
            List<Expr> groupBy = new ArrayList<>();
            for (DenisSqlParser.ExprContext g : c.groupItems) {
                groupBy.add(expr(g));
            }
            Expr having = c.having == null ? null : expr(c.having);
            List<Statement.Order> orderBy = new ArrayList<>();
            for (DenisSqlParser.OrderItemContext o : c.orderItem()) {
                orderBy.add(new Statement.Order(expr(o.expr()), o.DESC() != null));
            }
            Expr limit = c.limit == null ? null : expr(c.limit);
            Expr offset = c.offset == null ? null : expr(c.offset);
            // MySQL's "LIMIT offset, count"
            if (c.offset != null && isLimitComma(c)) {
                Expr swap = limit;
                limit = offset;
                offset = swap;
            }
            if (from == null && (where != null || !groupBy.isEmpty() || !joins.isEmpty())) {
                throw new SqlException("SELECT without FROM cannot have WHERE, GROUP BY or JOIN");
            }
            return new Statement.Select(c.DISTINCT() != null, items, from, joins, where, groupBy, having, orderBy, limit, offset, params);
        }

        /** True when the token between LIMIT's two expressions is a comma (not OFFSET). */
        private static boolean isLimitComma(DenisSqlParser.SelectStatementContext c) {
            int afterLimit = c.limit.getStop().getTokenIndex() + 1;
            for (TerminalNode comma : c.COMMA()) {
                if (comma.getSymbol().getTokenIndex() == afterLimit) {
                    return true;
                }
            }
            return false;
        }

        private Statement.TableRef tableRef(DenisSqlParser.TableRefContext t) {
            return new Statement.TableRef(id(t.identifier(0)), t.alias == null ? null : id(t.alias));
        }

        // ------------------------------------------------------------ expressions

        Expr expr(DenisSqlParser.ExprContext ctx) {
            if (ctx instanceof DenisSqlParser.LiteralExprContext c) {
                return literal(c.literal());
            }
            if (ctx instanceof DenisSqlParser.ColumnExprContext c) {
                DenisSqlParser.ColumnRefContext ref = c.columnRef();
                return new Expr.Column(ref.table == null ? null : id(ref.table), id(ref.column));
            }
            if (ctx instanceof DenisSqlParser.FunctionExprContext c) {
                DenisSqlParser.FunctionCallContext f = c.functionCall();
                List<Expr> args = new ArrayList<>();
                for (DenisSqlParser.ExprContext a : f.expr()) {
                    args.add(expr(a));
                }
                return new Expr.Function(id(f.name), args, f.STAR() != null, f.DISTINCT() != null);
            }
            if (ctx instanceof DenisSqlParser.ParenExprContext c) {
                return expr(c.expr());
            }
            if (ctx instanceof DenisSqlParser.CaseExprContext c) {
                List<Expr> when = new ArrayList<>();
                List<Expr> then = new ArrayList<>();
                for (DenisSqlParser.ExprContext w : c.when) {
                    when.add(expr(w));
                }
                for (DenisSqlParser.ExprContext t : c.then) {
                    then.add(expr(t));
                }
                return new Expr.Case(when, then, c.otherwise == null ? null : expr(c.otherwise));
            }
            if (ctx instanceof DenisSqlParser.UnaryExprContext c) {
                Expr operand = expr(c.expr());
                if (c.op.getType() == DenisSqlLexer.MINUS && operand instanceof Expr.Literal lit && lit.value() instanceof Number n) {
                    return new Expr.Literal(n instanceof Long l ? (Object) (-l) : (Object) (-n.doubleValue()));
                }
                return c.op.getType() == DenisSqlLexer.MINUS ? new Expr.Unary("-", operand) : operand;
            }
            if (ctx instanceof DenisSqlParser.MulExprContext c) {
                return new Expr.Binary(c.op.getText(), expr(c.left), expr(c.right));
            }
            if (ctx instanceof DenisSqlParser.AddExprContext c) {
                return new Expr.Binary(c.op.getText(), expr(c.left), expr(c.right));
            }
            if (ctx instanceof DenisSqlParser.ConcatExprContext c) {
                return new Expr.Binary("||", expr(c.left), expr(c.right));
            }
            if (ctx instanceof DenisSqlParser.CompareExprContext c) {
                String op = switch (c.op.getType()) {
                    case DenisSqlLexer.EQ -> "=";
                    case DenisSqlLexer.NEQ -> "!=";
                    default -> c.op.getText();
                };
                return new Expr.Binary(op, expr(c.left), expr(c.right));
            }
            if (ctx instanceof DenisSqlParser.InExprContext c) {
                List<DenisSqlParser.ExprContext> all = c.expr();
                List<Expr> values = new ArrayList<>();
                for (int i = 1; i < all.size(); i++) {
                    values.add(expr(all.get(i)));
                }
                return new Expr.In(expr(all.get(0)), values, c.NOT() != null);
            }
            if (ctx instanceof DenisSqlParser.BetweenExprContext c) {
                return new Expr.Between(expr(c.expr(0)), expr(c.low), expr(c.high), c.NOT() != null);
            }
            if (ctx instanceof DenisSqlParser.LikeExprContext c) {
                return new Expr.Like(expr(c.expr(0)), expr(c.pattern), c.NOT() != null);
            }
            if (ctx instanceof DenisSqlParser.IsNullExprContext c) {
                return new Expr.IsNull(expr(c.expr()), c.NOT() != null);
            }
            if (ctx instanceof DenisSqlParser.NotExprContext c) {
                return new Expr.Unary("NOT", expr(c.expr()));
            }
            if (ctx instanceof DenisSqlParser.AndExprContext c) {
                return new Expr.Binary("AND", expr(c.left), expr(c.right));
            }
            if (ctx instanceof DenisSqlParser.OrExprContext c) {
                return new Expr.Binary("OR", expr(c.left), expr(c.right));
            }
            throw new SqlException("Unsupported expression: " + ctx.getText());
        }

        private Expr literal(DenisSqlParser.LiteralContext ctx) {
            if (ctx instanceof DenisSqlParser.IntegerLiteralContext c) {
                return new Expr.Literal(number(c.getText(), true));
            }
            if (ctx instanceof DenisSqlParser.DecimalLiteralContext c) {
                return new Expr.Literal(number(c.getText(), false));
            }
            if (ctx instanceof DenisSqlParser.StringLiteralContext c) {
                return new Expr.Literal(unquote(c.getText()));
            }
            if (ctx instanceof DenisSqlParser.TrueLiteralContext) {
                return new Expr.Literal(Boolean.TRUE);
            }
            if (ctx instanceof DenisSqlParser.FalseLiteralContext) {
                return new Expr.Literal(Boolean.FALSE);
            }
            if (ctx instanceof DenisSqlParser.ParamLiteralContext) {
                return new Expr.Param(params++);
            }
            return new Expr.Literal(null);
        }

        private static Object number(String text, boolean integer) {
            if (integer) {
                try {
                    return Long.parseLong(text);
                } catch (NumberFormatException e) {
                    return Double.parseDouble(text);
                }
            }
            return Double.parseDouble(text);
        }

        /** Remove the quotes of a string literal and resolve doubled quotes and backslash escapes. */
        static String unquote(String token) {
            char quote = token.charAt(0);
            StringBuilder sb = new StringBuilder(token.length());
            for (int i = 1; i < token.length() - 1; i++) {
                char ch = token.charAt(i);
                if (ch == quote && i + 1 < token.length() - 1 && token.charAt(i + 1) == quote) {
                    sb.append(quote);
                    i++;
                } else if (ch == '\\' && i + 1 < token.length() - 1) {
                    char next = token.charAt(++i);
                    sb.append(switch (next) {
                        case 'n' -> '\n';
                        case 't' -> '\t';
                        case 'r' -> '\r';
                        case '0' -> '\0';
                        default -> next;
                    });
                } else {
                    sb.append(ch);
                }
            }
            return sb.toString();
        }

        /** Identifiers are case-insensitive: stored lower case. */
        private static String id(DenisSqlParser.IdentifierContext ctx) {
            return rawId(ctx).toLowerCase(Locale.ROOT);
        }

        private static String rawId(DenisSqlParser.IdentifierContext ctx) {
            String text = ctx.getText();
            if (text.startsWith("`") && text.endsWith("`") && text.length() >= 2) {
                return text.substring(1, text.length() - 1).replace("``", "`");
            }
            return text;
        }

        /** The original text of a rule, with the user's spacing. */
        private static String text(ParserRuleContext ctx) {
            Token start = ctx.getStart();
            Token stop = ctx.getStop();
            if (start == null || stop == null) {
                return ctx.getText();
            }
            return start.getInputStream().getText(Interval.of(start.getStartIndex(), stop.getStopIndex()));
        }
    }
}
