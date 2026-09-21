package github.hacimertgokhan.denis.sections.group;

import github.hacimertgokhan.denis.fingerprint.PawdStore;
import github.hacimertgokhan.denis.fingerprint.tools.GenToHashSalter;
import github.hacimertgokhan.readers.DenisToml;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Creates and inspects login groups ({@code LIN <group> <password>}) in
 * {@code denis.toml}. One place for the CLI, the interactive shell and the
 * server's start-up bootstrap so they cannot drift apart.
 */
public class GroupManager {
    public static final String DEFAULT_TOML = "denis.toml";
    /** Group names double as TOML table names, so keep them to a safe charset. */
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private final String tomlPath;
    private final GenToHashSalter hasher = new GenToHashSalter();

    public GroupManager() {
        this(DEFAULT_TOML);
    }

    public GroupManager(String tomlPath) {
        this.tomlPath = tomlPath;
    }

    /** Result of {@link #create}: the password is only known at creation time. */
    public record CreatedGroup(String name, String password, boolean generatedPassword) {}

    public static boolean isValidName(String name) {
        return name != null && NAME.matcher(name).matches();
    }

    public boolean exists(String name) {
        return new DenisToml(tomlPath).get(name) != null;
    }

    public List<String> list() {
        Map<String, Object> data = new DenisToml(tomlPath).getData();
        return new ArrayList<>(data.keySet());
    }

    /**
     * Create a group. With a {@code null} password one is generated and also written
     * to {@code pawd.dat}, as the interactive shell always did; a password supplied
     * by the operator is only stored hashed.
     */
    public CreatedGroup create(String name, String password) throws IOException {
        if (!isValidName(name)) {
            throw new IllegalArgumentException("Group name may only contain letters, digits, '_' and '-' (1-64 chars): " + name);
        }
        DenisToml toml = new DenisToml(tomlPath);
        if (toml.get(name) != null) {
            throw new IllegalStateException("Group already exists: " + name);
        }

        boolean generated = password == null || password.isBlank();
        String pwd = generated ? hasher.generatePwd() : password;
        String salt = hasher.generateSalt();

        List<String> accessibility = new ArrayList<>();
        accessibility.add("denis");
        Map<String, Object> group = new HashMap<>();
        group.put("group", name);
        group.put("hash", hasher.hashPassword(name, salt));
        group.put("salt", salt);
        group.put("access", hasher.hashPassword(pwd, salt));
        group.put("unix", Instant.now().getEpochSecond());
        group.put("accessibility", accessibility);
        toml.set(name, group);
        toml.save();

        if (generated) {
            new PawdStore().put(name, pwd);
        }
        return new CreatedGroup(name, pwd, generated);
    }

    /** @return true when the group existed and was removed from denis.toml */
    public boolean delete(String name) throws IOException {
        DenisToml toml = new DenisToml(tomlPath);
        if (toml.get(name) == null) {
            return false;
        }
        toml.getData().remove(name);
        toml.save();
        return true;
    }

    public boolean verify(String name, String password) {
        Group group = new Group(name, tomlPath);
        return group.isExists() && group.in(password);
    }

    /**
     * Make sure a group exists, creating it with the given password when it does
     * not. Used by the server at start-up ({@code DENIS_BOOTSTRAP_GROUP} /
     * {@code DENIS_BOOTSTRAP_GROUP_PASSWORD}) so a container comes up ready to log in.
     *
     * @return true when the group was created by this call
     */
    public boolean ensure(String name, String password) throws IOException {
        if (exists(name)) {
            return false;
        }
        create(name, password);
        return true;
    }
}
