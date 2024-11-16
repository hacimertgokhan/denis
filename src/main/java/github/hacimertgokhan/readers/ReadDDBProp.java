package github.hacimertgokhan.readers;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

public class PropertiesReader {

    public static void main(String[] args) {
        // Properties nesnesi oluşturulur
        Properties properties = new Properties();

        // resources klasöründeki dosya okunur
        try (InputStream input = PropertiesReader.class.getClassLoader().getResourceAsStream("config.properties")) {
            if (input == null) {
                System.out.println("Unable to find config.properties");
                return;
            }

            // Dosya yüklenir
            properties.load(input);

            // Veriler alınır
            String dbUrl = properties.getProperty("database.url");
            String dbUser = properties.getProperty("database.user");
            String dbPassword = properties.getProperty("database.password");

            // Çıktı
            System.out.println("Database URL: " + dbUrl);
            System.out.println("Database User: " + dbUser);
            System.out.println("Database Password: " + dbPassword);

        } catch (IOException ex) {
            ex.printStackTrace();

        }
    }
}