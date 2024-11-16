package github.hacimertgokhan.modals;

import java.util.concurrent.ConcurrentHashMap;

public class actString {
    private final ConcurrentHashMap<String, String> store = new ConcurrentHashMap<>();

    public void set(String key, String value) {
        store.put(key, value);
    }

    public String get(String key) {
        return store.getOrDefault(key, "null");
    }

    public void del(String key) {
        store.remove(key);
    }

    public boolean exists(String key) {
        return store.containsKey(key);
    }

}
