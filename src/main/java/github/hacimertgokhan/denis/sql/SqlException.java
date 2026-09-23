package github.hacimertgokhan.denis.sql;

/** A statement that cannot be parsed or executed; the message is shown to the client as-is. */
public class SqlException extends RuntimeException {
    public SqlException(String message) {
        super(message);
    }
}
