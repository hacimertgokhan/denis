package github.hacimertgokhan.denis.security;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Group password hashing.
 *
 * <p>New hashes use PBKDF2-HMAC-SHA512 (210 000 iterations by default, the
 * OWASP recommendation) and are stored as
 * {@code pbkdf2-sha512$<iterations>$<base64 hash>} next to the group's salt.
 * Hashes written by Denis 0.0.x (one round of SHA-512 over salt + password)
 * are still accepted; {@link Result#needsUpgrade()} tells the caller to
 * re-hash on the next successful login. Comparisons are constant-time.
 */
public final class PasswordHasher {
    public static final int DEFAULT_ITERATIONS = 210_000;
    private static final String PREFIX = "pbkdf2-sha512$";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final int iterations;

    public PasswordHasher() {
        this(DEFAULT_ITERATIONS);
    }

    public PasswordHasher(int iterations) {
        this.iterations = Math.max(10_000, iterations);
    }

    /** Outcome of a verification. */
    public record Result(boolean ok, boolean needsUpgrade) {}

    public static String newSalt() {
        byte[] salt = new byte[32];
        RANDOM.nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }

    /** A random password for generated groups: 24 URL-safe characters (144 bits). */
    public static String newPassword() {
        byte[] bytes = new byte[18];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public String hash(String password, String salt) {
        return PREFIX + iterations + "$" + Base64.getEncoder().encodeToString(pbkdf2(password, salt, iterations));
    }

    public Result verify(String password, String salt, String stored) {
        if (password == null || salt == null || stored == null) {
            return new Result(false, false);
        }
        if (stored.startsWith(PREFIX)) {
            String[] parts = stored.split("\\$");
            if (parts.length != 3) {
                return new Result(false, false);
            }
            int storedIterations;
            byte[] expected;
            try {
                storedIterations = Integer.parseInt(parts[1]);
                expected = Base64.getDecoder().decode(parts[2]);
            } catch (IllegalArgumentException e) {
                return new Result(false, false);
            }
            boolean ok = MessageDigest.isEqual(expected, pbkdf2(password, salt, storedIterations));
            return new Result(ok, ok && storedIterations < iterations);
        }
        boolean ok = MessageDigest.isEqual(stored.getBytes(StandardCharsets.US_ASCII),
                legacySha512(password, salt).getBytes(StandardCharsets.US_ASCII));
        return new Result(ok, ok);
    }

    private static byte[] pbkdf2(String password, String salt, int iterations) {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt.getBytes(StandardCharsets.UTF_8), iterations, 512);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA512").generateSecret(spec).getEncoded();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("PBKDF2WithHmacSHA512 is not available", e);
        } finally {
            spec.clearPassword();
        }
    }

    /** The Denis 0.0.x scheme: Base64(SHA-512(salt + password)). */
    public static String legacySha512(String password, String salt) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-512");
            return Base64.getEncoder().encodeToString(md.digest((salt + password).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
