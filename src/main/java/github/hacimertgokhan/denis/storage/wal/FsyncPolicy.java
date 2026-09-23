package github.hacimertgokhan.denis.storage.wal;

import java.util.Locale;

/**
 * When the write-ahead log is forced to stable storage.
 * <ul>
 *   <li>{@code ALWAYS}: a durable write is acknowledged only after fsync. Many
 *       writers share one fsync (group commit), but a single client waits for
 *       the disk on every write.</li>
 *   <li>{@code EVERYSEC} (default): writes reach the OS immediately and are
 *       fsynced once per second; a power cut loses at most about a second.</li>
 *   <li>{@code NO}: the OS decides; fastest, weakest.</li>
 * </ul>
 */
public enum FsyncPolicy {
    ALWAYS, EVERYSEC, NO;

    public static FsyncPolicy parse(String value) {
        if (value == null || value.isBlank()) {
            return EVERYSEC;
        }
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "always" -> ALWAYS;
            case "everysec", "every-second", "1s" -> EVERYSEC;
            case "no", "never", "os" -> NO;
            default -> throw new IllegalArgumentException("fsync must be always, everysec or no: " + value);
        };
    }

    public String configName() {
        return name().toLowerCase(Locale.ROOT);
    }
}
