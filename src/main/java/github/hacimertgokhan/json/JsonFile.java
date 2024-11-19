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
     * ddb.json dosyasından token dizisini okuyup listeler
     * @return token dizisindeki tüm elementlerin listesi
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
                new DenisLogger(JsonFile.class).warn("ddb.json dosyasında 'token' anahtarı bulunamadı!");
            }
        } catch (Exception e) {
            new DenisLogger(JsonFile.class).warn("Token listesi okunurken hata oluştu: " + e.getMessage());
        }

        return tokens;
    }


    /**
     * String yapıda olan dizileri döndürür.
     * @return token dizisindeki tüm elementlerin listesi
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
                new DenisLogger(JsonFile.class).warn(String.format("Json dosyasında '%s' anahtarı bulunamadı!", key));
            }
        } catch (Exception e) {
            new DenisLogger(JsonFile.class).warn("Token listesi okunurken hata oluştu: " + e.getMessage());
        }

        return tokens;
    }

    /**
     * Belirtilen anahtara bir dizi yazar veya günceller
     * @param key JSON anahtarı
     * @param items Yazılacak liste
     */
    public void writeArray(String key, List<?> items) throws IOException {
        JSONObject json = readJson();
        JSONArray array = new JSONArray(items);
        json.put(key, array);
        writeJson(json);
    }

    /**
     * Belirtilen anahtardaki diziye yeni eleman ekler
     * @param key JSON anahtarı
     * @param item Eklenecek eleman
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
     * Belirtilen anahtardaki diziden eleman siler
     * @param key JSON anahtarı
     * @param index Silinecek elemanın indeksi
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

    /**
     * Belirtilen anahtardaki diziye yeni değer ekler ve günceller
     * @param key JSON anahtarı
     * @param newValue Eklenecek yeni değer
     * @return Güncellenen dizideki toplam eleman sayısı
     */
    public int updateArrayWithNewValue(String key, String newValue) throws IOException {
        JSONObject json = readJson();

        if (!json.has(key)) {
            // Eğer anahtar yoksa yeni dizi oluştur
            JSONArray newArray = new JSONArray();
            newArray.put(newValue);
            json.put(key, newArray);
            writeJson(json);
            return 1;
        }

        // Mevcut diziyi al
        JSONArray currentArray = json.getJSONArray(key);

        // Değerleri ArrayList'e aktar
        List<String> values = new ArrayList<>();
        for (int i = 0; i < currentArray.length(); i++) {
            values.add(currentArray.getString(i));
        }

        // Yeni değeri ekle
        values.add(newValue);

        // Diziyi güncelle
        json.put(key, new JSONArray(values));

        // Dosyaya yaz
        writeJson(json);

        return values.size();
    }

    /**
     * Belirtilen anahtardaki diziyi birden fazla yeni değerle günceller
     * @param key JSON anahtarı
     * @param newValues Eklenecek yeni değerler listesi
     * @return Güncellenen dizideki toplam eleman sayısı
     */
    public int updateArrayWithMultipleValues(String key, List<String> newValues) throws IOException {
        JSONObject json = readJson();

        if (!json.has(key)) {
            // Eğer anahtar yoksa yeni dizi oluştur
            json.put(key, new JSONArray(newValues));
            writeJson(json);
            return newValues.size();
        }

        // Mevcut diziyi al
        JSONArray currentArray = json.getJSONArray(key);

        // Değerleri ArrayList'e aktar
        List<String> values = new ArrayList<>();
        for (int i = 0; i < currentArray.length(); i++) {
            values.add(currentArray.getString(i));
        }

        // Yeni değerleri ekle
        values.addAll(newValues);

        // Diziyi güncelle
        json.put(key, new JSONArray(values));

        // Dosyaya yaz
        writeJson(json);

        return values.size();
    }


}