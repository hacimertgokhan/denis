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
 *   {"tokens": ["..."], "owners": {"&lt;token&gt;": "crm"}}
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
    private FileTime loadedModified;
    private long loadedSize = -1;

    /** A project and its owning group ("" for none). */
    public record Project(String token, String owner) {}

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
            JSONArray tokens = json.optJSONArray("tokens");
            JSONObject ownerMap = json.optJSONObject("owners");
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
        save();
        return true;
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
        JSONObject json = new JSONObject();
        json.put("tokens", tokens);
        json.put("owners", ownerMap);
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
