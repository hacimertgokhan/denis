package github.hacimertgokhan.readers;
import com.moandjiezana.toml.Toml;
import com.moandjiezana.toml.TomlWriter;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

public class DenisToml {
    private Toml toml;
    private File file;
    private Map<String, Object> data;

    public DenisToml(String file_name) {
        this.file = new File(file_name);
        if (!file.exists()) {
            try {
                file.createNewFile();
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        }
        this.toml = new Toml().read(file);
        this.data = toml.toMap();
        if (this.data == null) {
            this.data = new HashMap<>();
        }
    }

    public File getFile() {
        return file;
    }

    public void setFile(File file) {
        this.file = file;
    }

    public void setToml(Toml toml) {
        this.toml = toml;
    }

    public Map<String, Object> getData() {
        return data;
    }

    public void setData(Map<String, Object> data) {
        this.data = data;
    }

    public Toml toml() {
        return toml;
    }

    public Object get(String key) {
        return data.get(key);
    }

    // Ana başlık altında veri almak için
    public Object get(String section, String key) {
        Map<String, Object> sectionData = (Map<String, Object>) data.get(section);
        return sectionData != null ? sectionData.get(key) : null;
    }

    public void set(String key, Object value) {
        data.put(key, value);
    }

    // Başlık altına veri eklemek için yeni metod
    public void setSection(String section, Map<String, Object> values) {
        data.put(section, values);
    }

    // Başlık altındaki belirli bir değeri güncellemek için
    public void updateSection(String section, String key, Object value) {
        Map<String, Object> sectionData = (Map<String, Object>) data.get(section);
        if (sectionData == null) {
            sectionData = new HashMap<>();
            data.put(section, sectionData);
        }
        sectionData.put(key, value);
    }

    // Var olan bir başlığı kontrol etmek için
    public boolean hasSection(String section) {
        return data.containsKey(section);
    }

    // Başlık altındaki tüm verileri almak için
    public Map<String, Object> getSection(String section) {
        return (Map<String, Object>) data.get(section);
    }

    public void update(String key, Object value) {
        if (data.containsKey(key)) {
            data.put(key, value);
        }
    }

    public void save() throws IOException {
        TomlWriter writer = new TomlWriter();
        writer.write(data, file);
    }



}