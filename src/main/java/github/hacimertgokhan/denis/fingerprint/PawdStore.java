package github.hacimertgokhan.denis.fingerprint;

import github.hacimertgokhan.logger.DenisLogger;

import java.io.*;
import java.util.HashMap;
import java.util.Map;

public class PawdStore {

    private final String fileName = "pawd.dat";
    private final Map<String, String> keyValueStore = new HashMap<>();

    public PawdStore() {}

    public void put(String key, String value) {
        keyValueStore.put(key, value);
        saveToFile();
    }

    public String get(String key) {
        return keyValueStore.get(key);
    }

    public void loadFromFile() {
        File file = new File(fileName);
        if (!file.exists()) {
            new DenisLogger(PawdStore.class).info("Creating pawd.dat file.");
            try {
                file.createNewFile();
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        } else {
            new DenisLogger(PawdStore.class).info("pawd.dat found, skipping.");
        }
        try (BufferedReader reader = new BufferedReader(new FileReader(fileName))) {
            String line;
            int i = 0;
            while ((line = reader.readLine()) != null) {
                String[] parts = line.split(":", 2);
                if (parts.length == 2) {
                    i++;
                    keyValueStore.put(parts[0], parts[1]);
                }
            }
            new DenisLogger(PawdStore.class).info(String.format("Loaded %s group pawd.", i));
        } catch (FileNotFoundException e) {
            System.out.println("Something went wrong about pawd.dat");
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private void saveToFile() {
        try (BufferedWriter writer = new BufferedWriter(new FileWriter(fileName))) {
            for (Map.Entry<String, String> entry : keyValueStore.entrySet()) {
                writer.write(entry.getKey() + ":" + entry.getValue());
                writer.newLine();
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
