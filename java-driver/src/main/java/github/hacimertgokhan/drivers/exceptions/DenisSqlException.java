package github.hacimertgokhan.drivers.exceptions;

import java.util.Map;

/** A SQL statement failed on the server (code {@code SQL}). */
public class DenisSqlException extends DenisException {
    private static final long serialVersionUID = 1L;

    public DenisSqlException(String message, Map<String, Object> reply) {
        super("SQL", message, reply, null);
    }

    /** The Denis 0.0.x text form of the error ({@code "ERROR: <message>"}), or {@code null}. */
    public String data() {
        Map<String, Object> reply = reply();
        Object data = reply == null ? null : reply.get("data");
        return data instanceof String ? (String) data : null;
    }
}
