package github.hacimertgokhan.drivers;

import java.util.List;
import java.util.Map;

/** Reply of {@code HELLO}: server identification and supported features. */
public final class ServerHello {
    private final String server;
    private final String version;
    private final int protocol;
    private final List<String> features;
    private final boolean loggedIn;

    ServerHello(String server, String version, int protocol, List<String> features, boolean loggedIn) {
        this.server = server;
        this.version = version;
        this.protocol = protocol;
        this.features = features;
        this.loggedIn = loggedIn;
    }

    static ServerHello from(Map<String, Object> r) {
        return new ServerHello(Protocol.optString(r, "server"), Protocol.optString(r, "version"),
                (int) Protocol.optNumber(r, "protocol", 0),
                r.get("features") instanceof List ? Protocol.strings(r, "features") : List.of(),
                Boolean.TRUE.equals(r.get("loggedIn")));
    }

    /** Server name, {@code "denis"}. */
    public String server() {
        return server;
    }

    /** Server version, e.g. {@code "0.1.0"}. */
    public String version() {
        return version;
    }

    /** Wire protocol version (this driver targets 2). */
    public int protocol() {
        return protocol;
    }

    /** Feature names such as {@code sql-params}, {@code ttl}, {@code dump}. */
    public List<String> features() {
        return features;
    }

    /** Whether the server announced {@code feature}. */
    public boolean hasFeature(String feature) {
        return features.contains(feature);
    }

    /** Whether the connection that answered is logged in. */
    public boolean loggedIn() {
        return loggedIn;
    }

    @Override
    public String toString() {
        return server + " " + version + " (protocol " + protocol + ", features " + features + ")";
    }
}
