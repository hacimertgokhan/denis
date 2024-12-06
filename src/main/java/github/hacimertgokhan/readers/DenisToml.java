package github.hacimertgokhan.readers;
import com.moandjiezana.toml.Toml;
import com.moandjiezana.toml.TomlWriter;

import java.io.File;
import java.io.IOException;
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
    }

    public Toml toml() {
        return toml;
    }

    public Object get(String key) {
        return data.get(key);
    }

    public void set(String key, Object value) {
        data.put(key, value);
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
