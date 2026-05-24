package github.hacimertgokhan.readers;

import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Properties;

public class DenisProperties {
    private final Properties properties = new Properties();
    private final String fileName = "denis.properties";
    private final Path externalPath = Paths.get(System.getProperty("denis.config", fileName));

    public DenisProperties() {
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

    public String getProperty(String key) {
        return properties.getProperty(key);
    }

    public void setProperty(String key, String value) {
        properties.setProperty(key, value);
        try (FileOutputStream output = new FileOutputStream(externalPath.toFile())) {
            properties.store(output, null);
        } catch (IOException ex) {
            ex.printStackTrace();
        }
    }
}
