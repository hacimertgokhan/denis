package github.hacimertgokhan.drivers;

import java.time.Duration;

/** Immutable settings of a {@link DenisClient} (built by {@link DenisClient.Builder}). */
final class ClientConfig {
    final String host;
    final int port;
    final String group;
    final String password;
    final String token;
    final boolean createProject;
    final int poolSize;
    final Duration connectTimeout;
    final Duration commandTimeout;
    final boolean reconnect;
    final Duration reconnectMinDelay;
    final Duration reconnectMaxDelay;
    final long maxReplyBytes;
    final int importChunkBytes;
    final Duration shutdownTimeout;

    ClientConfig(DenisClient.Builder b) {
        this.host = b.host;
        this.port = b.port;
        this.group = b.group;
        this.password = b.password;
        this.token = b.token;
        this.createProject = b.createProject;
        this.poolSize = b.poolSize;
        this.connectTimeout = b.connectTimeout;
        this.commandTimeout = b.commandTimeout;
        this.reconnect = b.reconnect;
        this.reconnectMinDelay = b.reconnectMinDelay;
        this.reconnectMaxDelay = b.reconnectMaxDelay;
        this.maxReplyBytes = b.maxReplyBytes;
        this.importChunkBytes = b.importChunkBytes;
        this.shutdownTimeout = b.shutdownTimeout;
    }

    int connectTimeoutMillis() {
        return (int) Math.min(Integer.MAX_VALUE, connectTimeout.toMillis());
    }

    /** Command timeout in nanoseconds; 0 means none. */
    long commandTimeoutNanos() {
        return commandTimeout.isZero() ? 0 : commandTimeout.toNanos();
    }

    /** How long a handshake may take. */
    long handshakeTimeoutNanos() {
        long connect = connectTimeout.isZero() ? Duration.ofSeconds(30).toNanos() : connectTimeout.toNanos();
        long command = commandTimeout.isZero() ? Duration.ofSeconds(30).toNanos() : commandTimeout.toNanos();
        return Math.max(connect, command);
    }
}
