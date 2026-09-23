package github.hacimertgokhan.denis.security;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Brute-force protection for {@code LIN}: after {@code maxFailures} failed
 * logins from one address within the lockout window, further attempts from
 * that address are refused until the window has passed. Successful logins
 * reset the counter. Bounded in size so a flood of addresses cannot grow it
 * without limit.
 */
public final class LoginGuard {
    private static final int MAX_TRACKED = 10_000;

    private final int maxFailures;
    private final long lockoutMillis;
    private final Map<String, Attempts> attempts = new ConcurrentHashMap<>();

    private static final class Attempts {
        int failures;
        long firstFailure;
        long lockedUntil;
    }

    public LoginGuard(int maxFailures, long lockoutMillis) {
        this.maxFailures = maxFailures;
        this.lockoutMillis = lockoutMillis;
    }

    /** @return milliseconds the address must still wait, or 0 when it may try */
    public long retryAfter(String address) {
        if (maxFailures <= 0) {
            return 0;
        }
        Attempts a = attempts.get(address);
        if (a == null) {
            return 0;
        }
        synchronized (a) {
            long now = System.currentTimeMillis();
            return a.lockedUntil > now ? a.lockedUntil - now : 0;
        }
    }

    public void failure(String address) {
        if (maxFailures <= 0) {
            return;
        }
        if (attempts.size() >= MAX_TRACKED) {
            prune();
        }
        Attempts a = attempts.computeIfAbsent(address, k -> new Attempts());
        synchronized (a) {
            long now = System.currentTimeMillis();
            if (now - a.firstFailure > lockoutMillis) {
                a.failures = 0;
                a.firstFailure = now;
            }
            a.failures++;
            if (a.failures >= maxFailures) {
                a.lockedUntil = now + lockoutMillis;
                a.failures = 0;
                a.firstFailure = now;
            }
        }
    }

    public void success(String address) {
        attempts.remove(address);
    }

    private void prune() {
        long now = System.currentTimeMillis();
        for (Iterator<Map.Entry<String, Attempts>> it = attempts.entrySet().iterator(); it.hasNext(); ) {
            Attempts a = it.next().getValue();
            synchronized (a) {
                if (a.lockedUntil < now && now - a.firstFailure > lockoutMillis) {
                    it.remove();
                }
            }
        }
        if (attempts.size() >= MAX_TRACKED) {
            attempts.clear();
        }
    }
}
