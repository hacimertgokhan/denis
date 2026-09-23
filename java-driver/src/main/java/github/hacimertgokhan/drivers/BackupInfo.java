package github.hacimertgokhan.drivers;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Map;

/** A server backup archive ({@code BACKUP} / {@code BACKUPS}). */
public final class BackupInfo {
    private final String name;
    private final String path;
    private final long bytes;
    private final String createdAt;

    BackupInfo(String name, String path, long bytes, String createdAt) {
        this.name = name;
        this.path = path;
        this.bytes = bytes;
        this.createdAt = createdAt;
    }

    static BackupInfo from(Map<String, Object> r) {
        return new BackupInfo(Protocol.optString(r, "name"), Protocol.optString(r, "path"),
                Protocol.optNumber(r, "bytes", 0), Protocol.optString(r, "createdAt"));
    }

    /** File name of the archive. */
    public String name() {
        return name;
    }

    /** Path of the archive on the server machine. */
    public String path() {
        return path;
    }

    /** Size in bytes. */
    public long bytes() {
        return bytes;
    }

    /** Creation time as sent by the server, or {@code null}. */
    public String createdAt() {
        return createdAt;
    }

    /** Creation time as an {@link Instant}, or {@code null} when absent or not ISO-8601. */
    public Instant createdAtInstant() {
        if (createdAt == null) {
            return null;
        }
        try {
            return Instant.parse(createdAt);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    @Override
    public String toString() {
        return "BackupInfo{name=" + name + ", bytes=" + bytes + ", createdAt=" + createdAt + "}";
    }
}
