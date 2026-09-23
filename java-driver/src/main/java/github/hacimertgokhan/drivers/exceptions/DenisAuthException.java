package github.hacimertgokhan.drivers.exceptions;

import java.util.Map;

/**
 * Authentication or authorization failure: codes {@code AUTH} (wrong group or
 * password, project not accessible), {@code NOAUTH} (login required),
 * {@code NOPROJECT} (project selection required), {@code LOCKED} (too many
 * failed logins) and {@code FORBIDDEN} (admin group required).
 */
public class DenisAuthException extends DenisException {
    private static final long serialVersionUID = 1L;

    public DenisAuthException(String code, String message, Map<String, Object> reply) {
        super(code, message, reply, null);
    }
}
