package github.hacimertgokhan.readers;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;

/**
 * Server configuration, resolved in this order (later wins):
 * <ol>
 *   <li>{@code denis.properties} bundled in the jar (defaults),</li>
 *   <li>an external {@code denis.properties} next to the working directory, or the
 *       file named by {@code -Ddenis.config=...} / {@code DENIS_CONFIG},</li>
 *   <li>environment variables.</li>
 * </ol>
 * Every property key can be given as an environment variable by upper-casing it and
 * replacing {@code -} with {@code _}, prefixed with {@code DENIS_}: {@code ddb-port}
 * becomes {@code DENIS_DDB_PORT}, {@code max-connections-per-ip} becomes
 * {@code DENIS_MAX_CONNECTIONS_PER_IP}. The {@code ddb-*} keys are also accepted
 * without the prefix ({@code DDB_PORT}, {@code DDB_ADDRESS}, {@code DDB_MAIN_TOKEN})
 * because that is how the Docker image documents them.
 */
public class DenisProperties {
    public static final String ENV_PREFIX = "DENIS_";

    private final Properties properties = new Properties();
    private final String fileName = "denis.properties";
    private final Path externalPath;
    private final Path home;
    private final Map<String, String> environment;

    public DenisProperties() {
        this(System.getenv());
    }

    /** For tests: resolve against a given environment instead of {@link System#getenv()}. */
    public DenisProperties(Map<String, String> environment) {
        this.environment = environment;
        String homeSetting = System.getProperty("denis.home");
        if (homeSetting == null || homeSetting.isBlank()) {
            homeSetting = environment.getOrDefault("DENIS_HOME", "");
        }
        this.home = homeSetting.isBlank() ? Paths.get("") : Paths.get(homeSetting);
        String configured = System.getProperty("denis.config");
        if (configured == null || configured.isBlank()) {
            configured = environment.getOrDefault("DENIS_CONFIG", fileName);
        }
        this.externalPath = home.resolve(configured);

        try (InputStream input = DenisProperties.class.getClassLoader().getResourceAsStream(fileName)) {
            if (input != null) {
                properties.load(input);
            }
        } catch (IOException ex) {
            ex.printStackTrace();
        }

        if (Files.exists(externalPath)) {
            try (InputStream input = Files.newInputStream(externalPath)) {
                properties.load(input);
            } catch (IOException ex) {
                ex.printStackTrace();
            }
        }
    }

    /** Environment variable name(s) that override a property key. */
    static String[] environmentNames(String key) {
        String upper = key.toUpperCase(Locale.ROOT).replace('-', '_').replace('.', '_');
        if (upper.startsWith("DDB_")) {
            return new String[]{ENV_PREFIX + upper, upper};
        }
        return new String[]{ENV_PREFIX + upper};
    }

    public String getProperty(String key) {
        for (String name : environmentNames(key)) {
            String value = environment.get(name);
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return properties.getProperty(key);
    }

    public String getProperty(String key, String defaultValue) {
        String value = getProperty(key);
        return value == null || value.isBlank() ? defaultValue : value;
    }

    public int getInt(String key, int defaultValue) {
        String value = getProperty(key);
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(String.format("%s must be an integer, got '%s'", key, value));
        }
    }

    public boolean getBoolean(String key, boolean defaultValue) {
        String value = getProperty(key);
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        return Boolean.parseBoolean(value.trim());
    }

    /** True when the value comes from the environment rather than a file. */
    public boolean isFromEnvironment(String key) {
        for (String name : environmentNames(key)) {
            String value = environment.get(name);
            if (value != null && !value.isBlank()) {
                return true;
            }
        }
        return false;
    }

    public Path getExternalPath() {
        return externalPath;
    }

    /**
     * The installation directory ({@code DENIS_HOME} or {@code -Ddenis.home}),
     * against which relative paths in the configuration are resolved; the
     * working directory when unset. The launchers set it, so {@code denis}
     * finds its data from any current directory.
     */
    public Path home() {
        return home;
    }

    /** A configured path, resolved against {@link #home()} when relative. */
    public Path path(String key, String defaultValue) {
        String value = getProperty(key, defaultValue);
        return home.resolve(value);
    }

    /**
     * Persist a value to the external properties file. Values that are set through
     * the environment keep winning over the file; use this for values the server
     * generates itself (for example the main token on first start).
     */
    public void setProperty(String key, String value) {
        properties.setProperty(key, value);
        try {
            Path parent = externalPath.toAbsolutePath().getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            // edit the one line in place so the comments of the file survive
            java.util.List<String> lines = Files.exists(externalPath)
                    ? new java.util.ArrayList<>(Files.readAllLines(externalPath, java.nio.charset.StandardCharsets.UTF_8))
                    : new java.util.ArrayList<>();
            String entry = key + "=" + escape(value);
            boolean replaced = false;
            for (int i = 0; i < lines.size(); i++) {
                String trimmed = lines.get(i).trim();
                if (!trimmed.startsWith("#") && !trimmed.startsWith("!")
                        && (trimmed.startsWith(key + "=") || trimmed.startsWith(key + " ") || trimmed.startsWith(key + ":") || trimmed.equals(key))) {
                    lines.set(i, entry);
                    replaced = true;
                    break;
                }
            }
            if (!replaced) {
                lines.add(entry);
            }
            Files.write(externalPath, lines, java.nio.charset.StandardCharsets.UTF_8);
        } catch (IOException ex) {
            throw new java.io.UncheckedIOException("Cannot write " + externalPath, ex);
        }
    }

    /** Properties-file escaping of a value (backslashes, leading spaces, line breaks). */
    private static String escape(String value) {
        StringBuilder sb = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                default -> sb.append(i == 0 && c == ' ' ? "\\ " : String.valueOf(c));
            }
        }
        return sb.toString();
    }
}
