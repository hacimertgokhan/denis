package github.hacimertgokhan.denis.server;

import java.util.concurrent.CompletableFuture;

/**
 * What a command produced: a line to send now, a line that will be ready
 * later (slow work runs off the network thread; the connection reads no
 * further commands until it is sent, which keeps replies in order), or
 * nothing (blank input).
 */
public final class Reply {
    public static final Reply NONE = new Reply(null, null, false);

    private final String line;
    private final CompletableFuture<String> later;
    private final boolean close;

    private Reply(String line, CompletableFuture<String> later, boolean close) {
        this.line = line;
        this.later = later;
        this.close = close;
    }

    public static Reply of(String line) {
        return new Reply(line, null, false);
    }

    /** Send {@code line}, then close the connection. */
    public static Reply closing(String line) {
        return new Reply(line, null, true);
    }

    /** A reply that completes later; an already completed future is sent right away. */
    public static Reply later(CompletableFuture<String> future) {
        if (future.isDone() && !future.isCompletedExceptionally() && !future.isCancelled()) {
            return new Reply(future.join(), null, false);
        }
        return new Reply(null, future, false);
    }

    public String line() {
        return line;
    }

    public CompletableFuture<String> deferred() {
        return later;
    }

    public boolean close() {
        return close;
    }
}
