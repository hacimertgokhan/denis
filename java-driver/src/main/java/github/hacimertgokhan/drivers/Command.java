package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.exceptions.DenisException;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * One protocol command: the request line (already encoded) and how to turn
 * the JSON reply into a Java value.
 */
final class Command<T> {
    /** Decodes a successful ({@code "ok":true}) reply. */
    interface Decoder<T> {
        T decode(Map<String, Object> reply);
    }

    final String name;
    final byte[] frame;
    private final Decoder<T> decoder;
    private final boolean nullOnNotFound;
    /** Code for error replies without a code (master-line servers up to 0.6) whose message is not a well-known one. */
    private final String fallbackCode;

    Command(String line, Decoder<T> decoder) {
        this(line, decoder, false);
    }

    Command(String line, Decoder<T> decoder, boolean nullOnNotFound) {
        this(line, decoder, nullOnNotFound, DenisException.ERROR);
    }

    Command(String line, Decoder<T> decoder, boolean nullOnNotFound, String fallbackCode) {
        int space = line.indexOf(' ');
        this.name = space < 0 ? line : line.substring(0, space);
        byte[] bytes = line.getBytes(StandardCharsets.UTF_8);
        this.frame = new byte[bytes.length + 1];
        System.arraycopy(bytes, 0, frame, 0, bytes.length);
        frame[bytes.length] = '\n';
        this.decoder = decoder;
        this.nullOnNotFound = nullOnNotFound;
        this.fallbackCode = fallbackCode;
    }

    T decode(Map<String, Object> reply) {
        if (!Protocol.isOk(reply)) {
            if (nullOnNotFound && "NOTFOUND".equals(Protocol.code(reply))) {
                return null;
            }
            throw Protocol.error(reply, fallbackCode);
        }
        return decoder.decode(reply);
    }

    /** A command waiting for (or being written to get) its reply. */
    static final class Pending<T> {
        final Command<T> command;
        final CompletableFuture<T> future;
        /** Set by the writer before the command is queued on a connection. */
        volatile long sentNanos;

        Pending(Command<T> command) {
            this(command, new CompletableFuture<>());
        }

        Pending(Command<T> command, CompletableFuture<T> future) {
            this.command = command;
            this.future = future;
        }

        void complete(Map<String, Object> reply) {
            if (future.isDone()) {
                return;
            }
            T value;
            try {
                value = command.decode(reply);
            } catch (DenisException e) {
                future.completeExceptionally(e);
                return;
            } catch (RuntimeException e) {
                future.completeExceptionally(new DenisException(DenisException.PROTOCOL,
                        "unexpected reply to " + command.name + ": " + e.getMessage(), reply, e));
                return;
            }
            future.complete(value);
        }

        void fail(Throwable error) {
            future.completeExceptionally(error);
        }
    }
}
