package github.hacimertgokhan.readers;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

public class ReadDDBProp {
    private Properties properties = new Properties();

    public ReadDDBProp() {
        try (InputStream input = ReadDDBProp.class.getClassLoader().getResourceAsStream("denis.properties")) {
            if (input == null) {
                System.out.println("Unable to find denis.properties");
                return;
            }

            properties.load(input);

        } catch (IOException ex) {
            ex.printStackTrace();

        }
    }

    public String getProperty(String key) {
        return properties.getProperty(key);
    }

}