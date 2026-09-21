package github.hacimertgokhan.json;

import github.hacimertgokhan.logger.DenisLogger;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.*;
import java.util.ArrayList;
import java.util.List;

public class JsonFile {
    private final String filePath;

    public JsonFile(String filePath) {
        this.filePath = filePath;
    }

    public JSONObject readJson() throws IOException {
        try (FileInputStream fis = new FileInputStream(filePath)) {
            JSONTokener tokener = new JSONTokener(fis);
            return new JSONObject(tokener);
        } catch (FileNotFoundException e) {
            return new JSONObject();
        }
    }

    public JSONArray readJsonArray() throws IOException {
        try (FileInputStream fis = new FileInputStream(filePath)) {
            JSONTokener tokener = new JSONTokener(fis);
            return new JSONArray(tokener);
        } catch (FileNotFoundException e) {
            return new JSONArray();
        }
    }

    public void writeJson(JSONObject jsonObject) throws IOException {
        try (FileWriter writer = new FileWriter(filePath)) {
            writer.write(jsonObject.toString(4)); // 4 space indentation
        }
    }

    public void writeJsonArray(JSONArray jsonArray) throws IOException {
        try (FileWriter writer = new FileWriter(filePath)) {
            writer.write(jsonArray.toString(4)); // 4 space indentation
        }
    }

    public void updateValue(String key, Object newValue) throws IOException {
        JSONObject json = readJson();
        json.put(key, newValue);
        writeJson(json);
    }

    public void appendToArray(Object newItem) throws IOException {
        JSONArray jsonArray = readJsonArray();
        jsonArray.put(newItem);
        writeJsonArray(jsonArray);
    }

    public void deleteKey(String key) throws IOException {
        JSONObject json = readJson();
        json.remove(key);
        writeJson(json);
    }

    public void deleteFromArray(int index) throws IOException {
        JSONArray jsonArray = readJsonArray();
        if (index >= 0 && index < jsonArray.length()) {
            jsonArray.remove(index);
            writeJsonArray(jsonArray);
        }
    }

    public boolean fileExists() {
        return new File(filePath).exists();
    }

    public void createEmptyJson() throws IOException {
        writeJson(new JSONObject());
    }

    public void createEmptyJsonArray() throws IOException {
        writeJsonArray(new JSONArray());
    }



    /**
     * The {@code tokens} array of ddb.json.
     * @return every token, or an empty list
     */
    public List<String> tokenList() throws IOException {
        List<String> tokens = new ArrayList<>();

        try {
            JSONObject json = readJson();
            if (json.has("tokens")) {
                JSONArray tokenArray = json.getJSONArray("tokens");
                for (int i = 0; i < tokenArray.length(); i++) {
                    String token = tokenArray.getString(i);
                    tokens.add(token);
                }
            } else {
                new DenisLogger(JsonFile.class).debug("No 'tokens' array in " + filePath);
            }
        } catch (Exception e) {
            new DenisLogger(JsonFile.class).warn("Could not read the token list from " + filePath + ": " + e.getMessage());
        }

        return tokens;
    }


    /**
     * A string array stored under {@code key}.
     * @return its elements, or an empty list
     */
    public List<String> getList(String key) throws IOException {
        List<String> tokens = new ArrayList<>();
        try {
            JSONObject json = readJson();
            if (json.has(key)) {
                JSONArray tokenArray = json.getJSONArray(key);
                for (int i = 0; i < tokenArray.length(); i++) {
                    String token = tokenArray.getString(i);
                    tokens.add(token);
                }
            } else {
                new DenisLogger(JsonFile.class).debug(String.format("No '%s' array in %s", key, filePath));
            }
        } catch (Exception e) {
            new DenisLogger(JsonFile.class).warn("Could not read '" + key + "' from " + filePath + ": " + e.getMessage());
        }

        return tokens;
    }

    /**
     * Write (or replace) an array under {@code key}.
     * @param key JSON key
     * @param items the elements to write
     */
    public void writeArray(String key, List<?> items) throws IOException {
        JSONObject json = readJson();
        JSONArray array = new JSONArray(items);
        json.put(key, array);
        writeJson(json);
    }

    /**
     * Append one element to the array under {@code key}, creating it when missing.
     * @param key JSON key
     * @param item the element to append
     */
    public void appendToArray(String key, Object item) throws IOException {
        JSONObject json = readJson();
        JSONArray array;

        if (json.has(key)) {
            array = json.getJSONArray(key);
        } else {
            array = new JSONArray();
        }

        array.put(item);
        json.put(key, array);
        writeJson(json);
    }

    /**
     * Remove one element from the array under {@code key}.
     * @param key JSON key
     * @param index index of the element to remove
     */
    public void removeFromArray(String key, int index) throws IOException {
        JSONObject json = readJson();
        if (json.has(key)) {
            JSONArray array = json.getJSONArray(key);
            if (index >= 0 && index < array.length()) {
                array.remove(index);
                json.put(key, array);
                writeJson(json);
            }
        }
    }
}
