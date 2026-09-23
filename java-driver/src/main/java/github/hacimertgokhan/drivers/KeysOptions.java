package github.hacimertgokhan.drivers;

/**
 * Options of {@code KEYS}: which layer to list and how many keys at most.
 * The server additionally caps the result at its {@code keys-limit}.
 * Immutable; every method returns a new instance.
 */
public final class KeysOptions {
    private static final KeysOptions DEFAULTS = new KeysOptions("", 0);

    private final String layerFlag;
    private final int limit;

    private KeysOptions(String layerFlag, int limit) {
        this.layerFlag = layerFlag;
        this.limit = limit;
    }

    /** Keys of both layers, server default limit. */
    public static KeysOptions defaults() {
        return DEFAULTS;
    }

    /** Only keys that have a cache value. */
    public static KeysOptions cacheOnly() {
        return new KeysOptions(" -&cache", 0);
    }

    /** Only keys that have a durable value. */
    public static KeysOptions persistentOnly() {
        return new KeysOptions(" -&protobuff", 0);
    }

    /** Return at most {@code limit} keys ({@code -&limit=<n>}); must be positive. */
    public KeysOptions limit(int limit) {
        if (limit < 1) {
            throw Protocol.invalid("limit must be positive");
        }
        return new KeysOptions(layerFlag, limit);
    }

    /** Shortcut for {@code defaults().limit(limit)}. */
    public static KeysOptions withLimit(int limit) {
        return DEFAULTS.limit(limit);
    }

    String flags() {
        return layerFlag + (limit > 0 ? " -&limit=" + limit : "");
    }

    @Override
    public String toString() {
        return "KeysOptions{" + flags().trim() + "}";
    }
}
