package github.hacimertgokhan.denis.sections.group;

import com.moandjiezana.toml.Toml;
import com.moandjiezana.toml.TomlWriter;
import github.hacimertgokhan.denis.security.PasswordHasher;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.FileTime;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Login groups ({@code LIN <group> <password>}) stored in {@code denis.toml}.
 * One implementation for the server, the CLI and start-up provisioning.
 *
 * <pre>
 *   [crm]
 *   group = "crm"
 *   salt = "..."
 *   access = "pbkdf2-sha512$210000$..."
 *   unix = 1790000000
 *   accessibility = ["denis", "admin"]
 * </pre>
 *
 * A group whose {@code accessibility} contains {@code admin} may run
 * administrative commands (SAVE, BACKUP, INFO for every project, ...).
 *
 * <p>The file is parsed once and re-read only when its modification time
 * changes (checked at most once per second), so the CLI can add groups while
 * the server runs. Writes go to a temporary file that is atomically renamed.
 * Successful logins are remembered as an HMAC under a per-process random key,
 * so a client that opens several pooled connections pays for PBKDF2 once.
 */
public class GroupManager {
    public static final String DEFAULT_TOML = "denis.toml";
    public static final String ADMIN = "admin";
    /** Group names double as TOML table names, so keep them to a safe charset. */
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private final Path path;
    private final PasswordHasher hasher;
    private final byte[] cacheKey = new byte[32];
    private final Map<String, byte[]> verified = new ConcurrentHashMap<>();
    private volatile Map<String, GroupInfo> groups = Map.of();
    private volatile FileTime loadedModified;
    private volatile long loadedSize = -1;
    private volatile long lastCheck;

    /** A group as stored. */
    public record GroupInfo(String name, String salt, String access, List<String> accessibility, long createdUnix) {
        public boolean admin() {
            return accessibility.contains(ADMIN);
        }
    }

    /** Result of {@link #create}: the password is only known at creation time. */
    public record CreatedGroup(String name, String password, boolean generatedPassword) {}

    /** Result of a login attempt. */
    public record Login(boolean ok, boolean admin, List<String> accessibility) {
        static final Login FAILED = new Login(false, false, List.of());
    }

    public GroupManager() {
        this(DEFAULT_TOML);
    }

    public GroupManager(String tomlPath) {
        this(Paths.get(tomlPath), new PasswordHasher());
    }

    public GroupManager(Path path, PasswordHasher hasher) {
        this.path = path;
        this.hasher = hasher;
        new SecureRandom().nextBytes(cacheKey);
    }

    public static boolean isValidName(String name) {
        return name != null && NAME.matcher(name).matches();
    }

    public Path path() {
        return path;
    }

    // ------------------------------------------------------------------ reading

    private Map<String, GroupInfo> current() {
        long now = System.currentTimeMillis();
        if (now - lastCheck >= 1000 || loadedSize < 0) {
            lastCheck = now;
            reloadIfChanged();
        }
        return groups;
    }

    private synchronized void reloadIfChanged() {
        try {
            if (!Files.exists(path)) {
                if (!groups.isEmpty() || loadedSize != 0) {
                    groups = Map.of();
                    verified.clear();
                }
                loadedSize = 0;
                loadedModified = null;
                return;
            }
            FileTime modified = Files.getLastModifiedTime(path);
            long size = Files.size(path);
            if (modified.equals(loadedModified) && size == loadedSize) {
                return;
            }
            groups = parse(path);
            verified.clear();
            loadedModified = modified;
            loadedSize = size;
        } catch (IOException | RuntimeException e) {
            throw new IllegalStateException("Cannot read " + path + ": " + e.getMessage(), e);
        }
    }

    private static Map<String, GroupInfo> parse(Path path) {
        Toml toml = new Toml().read(path.toFile());
        Map<String, GroupInfo> result = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : toml.toMap().entrySet()) {
            if (!(entry.getValue() instanceof Map<?, ?> table)) {
                continue;
            }
            List<String> accessibility = new ArrayList<>();
            if (table.get("accessibility") instanceof List<?> list) {
                for (Object o : list) {
                    accessibility.add(String.valueOf(o));
                }
            }
            Object unix = table.get("unix");
            result.put(entry.getKey(), new GroupInfo(entry.getKey(), str(table.get("salt")), str(table.get("access")),
                    Collections.unmodifiableList(accessibility), unix instanceof Number n ? n.longValue() : 0));
        }
        return Collections.unmodifiableMap(result);
    }

    private static String str(Object o) {
        return o == null ? null : o.toString();
    }

    public boolean exists(String name) {
        return current().containsKey(name);
    }

    public GroupInfo find(String name) {
        return current().get(name);
    }

    public List<String> list() {
        return new ArrayList<>(current().keySet());
    }

    public List<GroupInfo> groups() {
        return new ArrayList<>(current().values());
    }

    // ------------------------------------------------------------------ login

    /** Check a password; legacy hashes are upgraded to PBKDF2 on success. */
    public Login login(String name, String password) {
        GroupInfo group = find(name);
        if (group == null || password == null) {
            // spend comparable time so unknown names are not distinguishable by timing
            hasher.hash(password == null ? "" : password, "timing-equaliser");
            return Login.FAILED;
        }
        byte[] fingerprint = fingerprint(name, password);
        byte[] known = verified.get(name);
        if (known != null && MessageDigest.isEqual(known, fingerprint)) {
            return new Login(true, group.admin(), group.accessibility());
        }
        PasswordHasher.Result result = hasher.verify(password, group.salt(), group.access());
        if (!result.ok()) {
            return Login.FAILED;
        }
        if (result.needsUpgrade()) {
            try {
                setPassword(name, password);
            } catch (IOException | RuntimeException ignored) {
                // the login is valid either way; the upgrade is retried next time
            }
        }
        verified.put(name, fingerprint);
        return new Login(true, group.admin(), group.accessibility());
    }

    /** @deprecated use {@link #login(String, String)} */
    @Deprecated
    public boolean verify(String name, String password) {
        return login(name, password).ok();
    }

    private byte[] fingerprint(String name, String password) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(cacheKey, "HmacSHA256"));
            return mac.doFinal((name + '\0' + password).getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    // ------------------------------------------------------------------ writing

    /**
     * Create a group. With a {@code null} password a random one is generated
     * and returned (it is shown once and never stored in clear text).
     */
    public synchronized CreatedGroup create(String name, String password, boolean admin) throws IOException {
        if (!isValidName(name)) {
            throw new IllegalArgumentException("Group name may only contain letters, digits, '_' and '-' (1-64 chars): " + name);
        }
        Map<String, Object> data = readRaw();
        if (data.containsKey(name)) {
            throw new IllegalStateException("Group already exists: " + name);
        }
        boolean generated = password == null || password.isBlank();
        String pwd = generated ? PasswordHasher.newPassword() : password;
        String salt = PasswordHasher.newSalt();
        List<String> accessibility = new ArrayList<>();
        accessibility.add("denis");
        if (admin) {
            accessibility.add(ADMIN);
        }
        Map<String, Object> group = new LinkedHashMap<>();
        group.put("group", name);
        group.put("salt", salt);
        group.put("access", hasher.hash(pwd, salt));
        group.put("unix", Instant.now().getEpochSecond());
        group.put("accessibility", accessibility);
        data.put(name, group);
        writeRaw(data);
        return new CreatedGroup(name, pwd, generated);
    }

    public CreatedGroup create(String name, String password) throws IOException {
        return create(name, password, false);
    }

    /** Replace a group's password (new salt, current hash scheme). */
    public synchronized void setPassword(String name, String password) throws IOException {
        if (password == null || password.isBlank()) {
            throw new IllegalArgumentException("Password must not be empty");
        }
        Map<String, Object> data = readRaw();
        Map<String, Object> group = table(data, name);
        String salt = PasswordHasher.newSalt();
        group.put("salt", salt);
        group.put("access", hasher.hash(password, salt));
        group.remove("hash");
        writeRaw(data);
    }

    public synchronized boolean delete(String name) throws IOException {
        Map<String, Object> data = readRaw();
        if (data.remove(name) == null) {
            return false;
        }
        writeRaw(data);
        return true;
    }

    /** Add a value to a group's accessibility list. @return false when it was already there */
    public synchronized boolean grant(String name, String value) throws IOException {
        Map<String, Object> data = readRaw();
        Map<String, Object> group = table(data, name);
        List<String> list = accessibility(group);
        if (list.contains(value)) {
            return false;
        }
        list.add(value);
        group.put("accessibility", list);
        writeRaw(data);
        return true;
    }

    /** Remove a value from a group's accessibility list. @return false when it was not there */
    public synchronized boolean revoke(String name, String value) throws IOException {
        Map<String, Object> data = readRaw();
        Map<String, Object> group = table(data, name);
        List<String> list = accessibility(group);
        if (!list.remove(value)) {
            return false;
        }
        group.put("accessibility", list);
        writeRaw(data);
        return true;
    }

    /**
     * Make sure a group exists, creating it with the given password when it does
     * not. Used by the server at start-up ({@code DENIS_BOOTSTRAP_GROUP} /
     * {@code DENIS_BOOTSTRAP_GROUP_PASSWORD}) so a container comes up ready to log in.
     *
     * @return true when the group was created by this call
     */
    public synchronized boolean ensure(String name, String password, boolean admin) throws IOException {
        if (readRaw().containsKey(name)) {
            return false;
        }
        create(name, password, admin);
        return true;
    }

    public boolean ensure(String name, String password) throws IOException {
        return ensure(name, password, false);
    }

    private static List<String> accessibility(Map<String, Object> group) {
        List<String> list = new ArrayList<>();
        if (group.get("accessibility") instanceof List<?> existing) {
            for (Object o : existing) {
                list.add(String.valueOf(o));
            }
        }
        return list;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> table(Map<String, Object> data, String name) {
        Object group = data.get(name);
        if (!(group instanceof Map)) {
            throw new IllegalArgumentException("Group not found: " + name);
        }
        Map<String, Object> copy = new LinkedHashMap<>((Map<String, Object>) group);
        data.put(name, copy);
        return copy;
    }

    private Map<String, Object> readRaw() {
        if (!Files.exists(path)) {
            return new LinkedHashMap<>();
        }
        return new LinkedHashMap<>(new Toml().read(path.toFile()).toMap());
    }

    private void writeRaw(Map<String, Object> data) throws IOException {
        Path absolute = path.toAbsolutePath();
        if (absolute.getParent() != null) {
            Files.createDirectories(absolute.getParent());
        }
        Path tmp = absolute.resolveSibling(absolute.getFileName() + ".tmp");
        new TomlWriter().write(data, tmp.toFile());
        try {
            Files.move(tmp, absolute, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, absolute, StandardCopyOption.REPLACE_EXISTING);
        }
        loadedSize = -1;
        reloadIfChanged();
    }
}
