package github.hacimertgokhan.denis.project;

import github.hacimertgokhan.denis.CreateSecureToken;
import github.hacimertgokhan.json.JsonFile;
import github.hacimertgokhan.logger.DenisLogger;

import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The set of project tokens ({@code AUTH <token>}), backed by the
 * {@code tokens} array of {@code ddb.json}.
 *
 * <p>One instance is shared by every connection: the file is parsed once at
 * start-up and {@link #create()} both registers and persists the new token, so
 * a project created on one connection is usable on every other one right away.
 * Before 0.3.0 each connection parsed the file on connect and kept a private
 * copy.</p>
 *
 * <p>Tokens added to the file from outside while the server runs (for example
 * {@code denis cli token -c}) are picked up lazily: an unknown token triggers one
 * re-read of the file before it is refused.</p>
 */
public class ProjectRegistry {
    private static final DenisLogger log = new DenisLogger(ProjectRegistry.class);
    public static final String TOKENS_KEY = "tokens";
    public static final String QUOTAS_KEY = "quotas";

    /** Limits of one project; {@code 0} means unlimited. */
    public record Quota(long maxKeys, long maxBytes) {
        public static final Quota UNLIMITED = new Quota(0, 0);

        public JSONObject toJson() {
            return new JSONObject().put("maxKeys", maxKeys).put("maxBytes", maxBytes);
        }
    }

    private final JsonFile file;
    private final Set<String> tokens = ConcurrentHashMap.newKeySet();
    private final ConcurrentHashMap<String, Quota> quotas = new ConcurrentHashMap<>();

    public ProjectRegistry(String path) {
        this(new JsonFile(path));
    }

    public ProjectRegistry(JsonFile file) {
        this.file = file;
        reload();
    }

    /** Re-read {@code ddb.json} so tokens added or removed by the CLI are seen. */
    public synchronized void reload() {
        try {
            if (!file.fileExists()) {
                file.createEmptyJson();
                return;
            }
            List<String> current = file.getList(TOKENS_KEY);
            tokens.retainAll(current);
            tokens.addAll(current);
            JSONObject stored = file.readJson().optJSONObject(QUOTAS_KEY);
            quotas.clear();
            if (stored != null) {
                for (String token : stored.keySet()) {
                    JSONObject q = stored.getJSONObject(token);
                    quotas.put(token, new Quota(q.optLong("maxKeys", 0), q.optLong("maxBytes", 0)));
                }
            }
        } catch (IOException e) {
            log.error("Could not read project tokens: " + e.getMessage());
        }
    }

    /** Remove a token from {@code ddb.json}; existing sessions on it keep working until they disconnect. */
    public synchronized boolean delete(String token) throws IOException {
        List<String> current = new ArrayList<>(file.getList(TOKENS_KEY));
        if (!current.remove(token)) {
            return false;
        }
        file.writeArray(TOKENS_KEY, current);
        tokens.remove(token);
        if (quotas.remove(token) != null) {
            saveQuotas();
        }
        return true;
    }

    public Quota quota(String token) {
        return quotas.getOrDefault(token, Quota.UNLIMITED);
    }

    /** Set (or with {@code null} clear) the limits of a project and persist them. */
    public synchronized void setQuota(String token, Quota quota) throws IOException {
        if (quota == null || (quota.maxKeys() <= 0 && quota.maxBytes() <= 0)) {
            quotas.remove(token);
        } else {
            quotas.put(token, quota);
        }
        saveQuotas();
    }

    private void saveQuotas() throws IOException {
        JSONObject all = new JSONObject();
        quotas.forEach((token, quota) -> all.put(token, quota.toJson()));
        file.updateValue(QUOTAS_KEY, all);
    }

    public boolean exists(String token) {
        if (token == null || token.isBlank()) {
            return false;
        }
        if (tokens.contains(token)) {
            return true;
        }
        reload();
        return tokens.contains(token);
    }

    public List<String> list() {
        return new ArrayList<>(tokens);
    }

    public int size() {
        return tokens.size();
    }

    /** Generate, persist and register a new project token. */
    public synchronized String create() throws IOException {
        String token = new CreateSecureToken().getToken();
        file.appendToArray(TOKENS_KEY, token);
        tokens.add(token);
        return token;
    }
}
