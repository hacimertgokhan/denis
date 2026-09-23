package github.hacimertgokhan.denis.project;

import github.hacimertgokhan.denis.CreateSecureToken;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Project tokens ({@code AUTH <token>}) and the group that created each one,
 * stored in {@code ddb.json}:
 *
 * <pre>
 *   {"tokens": ["..."], "owners": {"&lt;token&gt;": "crm"}, "quotas": {"&lt;token&gt;": {"maxKeys": 0, "maxBytes": 0}}}
 * </pre>
 *
 * Tokens from Denis 0.0.x (and ones created with {@code denis cli token -c})
 * have no owner and stay usable by every group. Loaded once and re-read when
 * the file changes; writes are atomic (temporary file + rename) and
 * serialised, so concurrent {@code AUTH CREATE} calls cannot lose a token.
 */
public final class ProjectRegistry {
    private final Path path;
    private final Map<String, String> owners = new LinkedHashMap<>();
    private final Map<String, Quota> quotas = new LinkedHashMap<>();
    private FileTime loadedModified;
    private long loadedSize = -1;

    /** A project and its owning group ("" for none). */
    public record Project(String token, String owner) {}

    /** Limits of one project; {@code 0} means unlimited. Written to ddb.json as in Denis 0.4+. */
    public record Quota(long maxKeys, long maxBytes) {
        public static final Quota UNLIMITED = new Quota(0, 0);

        public JSONObject toJson() {
            return new JSONObject().put("maxKeys", maxKeys).put("maxBytes", maxBytes);
        }
    }

    public ProjectRegistry(Path path) {
        this.path = path;
    }

    public Path path() {
        return path;
    }

    private synchronized void refresh() {
        try {
            if (!Files.exists(path)) {
                owners.clear();
                loadedSize = 0;
                return;
            }
            FileTime modified = Files.getLastModifiedTime(path);
            long size = Files.size(path);
            if (modified.equals(loadedModified) && size == loadedSize) {
                return;
            }
            JSONObject json;
            try (InputStream in = Files.newInputStream(path)) {
                String text = new String(in.readAllBytes(), StandardCharsets.UTF_8).strip();
                json = text.isEmpty() ? new JSONObject() : new JSONObject(new JSONTokener(text));
            }
            owners.clear();
            quotas.clear();
            JSONArray tokens = json.optJSONArray("tokens");
            JSONObject ownerMap = json.optJSONObject("owners");
            JSONObject quotaMap = json.optJSONObject("quotas");
            if (quotaMap != null) {
                for (String token : quotaMap.keySet()) {
                    JSONObject q = quotaMap.optJSONObject(token);
                    if (q != null) {
                        quotas.put(token, new Quota(q.optLong("maxKeys", 0), q.optLong("maxBytes", 0)));
                    }
                }
            }
            if (tokens != null) {
                for (int i = 0; i < tokens.length(); i++) {
                    String token = tokens.optString(i, null);
                    if (token != null && !token.isBlank()) {
                        owners.put(token, ownerMap == null ? "" : ownerMap.optString(token, ""));
                    }
                }
            }
            loadedModified = modified;
            loadedSize = size;
        } catch (IOException | RuntimeException e) {
            throw new IllegalStateException("Cannot read " + path + ": " + e.getMessage(), e);
        }
    }

    public synchronized boolean exists(String token) {
        if (owners.containsKey(token)) {
            return true;
        }
        refresh();
        return owners.containsKey(token);
    }

    /** Owning group, "" when unowned, null when the token does not exist. */
    public synchronized String owner(String token) {
        if (!owners.containsKey(token)) {
            refresh();
        }
        return owners.get(token);
    }

    public synchronized List<Project> list() {
        refresh();
        List<Project> list = new ArrayList<>();
        owners.forEach((token, owner) -> list.add(new Project(token, owner)));
        return list;
    }

    /** Create a new project owned by {@code owner} (null for none) and return its token. */
    public synchronized String create(String owner) throws IOException {
        refresh();
        String token;
        do {
            token = new CreateSecureToken().getToken();
        } while (owners.containsKey(token));
        owners.put(token, owner == null ? "" : owner);
        save();
        return token;
    }

    public synchronized boolean delete(String token) throws IOException {
        refresh();
        if (owners.remove(token) == null) {
            return false;
        }
        quotas.remove(token);
        save();
        return true;
    }

    /**
     * Adopt a token issued elsewhere ({@code ADMIN IMPORT}), e.g. after the
     * registry was lost while the data survived. @return false when it already existed
     */
    public synchronized boolean register(String token, String owner) throws IOException {
        if (token == null || !token.matches("[A-Za-z0-9]{32,256}")) {
            throw new IllegalArgumentException("a project token is 32-256 letters and digits");
        }
        refresh();
        if (owners.containsKey(token)) {
            return false;
        }
        owners.put(token, owner == null ? "" : owner);
        save();
        return true;
    }

    public synchronized Quota quota(String token) {
        if (!owners.containsKey(token)) {
            refresh();
        }
        return quotas.getOrDefault(token, Quota.UNLIMITED);
    }

    public synchronized void setQuota(String token, Quota quota) throws IOException {
        refresh();
        if (quota.maxKeys() <= 0 && quota.maxBytes() <= 0) {
            quotas.remove(token);
        } else {
            quotas.put(token, quota);
        }
        save();
    }

    public synchronized int size() {
        refresh();
        return owners.size();
    }

    private void save() throws IOException {
        JSONArray tokens = new JSONArray();
        JSONObject ownerMap = new JSONObject();
        owners.forEach((token, owner) -> {
            tokens.put(token);
            if (!owner.isEmpty()) {
                ownerMap.put(token, owner);
            }
        });
        JSONObject quotaMap = new JSONObject();
        quotas.forEach((token, quota) -> quotaMap.put(token, quota.toJson()));
        JSONObject json = new JSONObject();
        json.put("tokens", tokens);
        json.put("owners", ownerMap);
        json.put("quotas", quotaMap);
        Path absolute = path.toAbsolutePath();
        if (absolute.getParent() != null) {
            Files.createDirectories(absolute.getParent());
        }
        Path tmp = absolute.resolveSibling(absolute.getFileName() + ".tmp");
        Files.writeString(tmp, json.toString(2), StandardCharsets.UTF_8);
        try {
            Files.move(tmp, absolute, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, absolute, StandardCopyOption.REPLACE_EXISTING);
        }
        loadedModified = Files.getLastModifiedTime(absolute);
        loadedSize = Files.size(absolute);
    }
}
