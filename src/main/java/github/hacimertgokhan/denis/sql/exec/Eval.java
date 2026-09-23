package github.hacimertgokhan.denis.sql.exec;

/** A bound, ready-to-run expression. */
@FunctionalInterface
public interface Eval {
    Object eval(Ctx ctx);
}
