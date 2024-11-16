package github.hacimertgokhan.modals.concurrent;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

public class actListrig {
    private final ConcurrentHashMap<List<String>, String> store = new ConcurrentHashMap<>();

    public ConcurrentHashMap<List<String>, String> getStore() {
        return store;
    }

    public void set(List<String> key, String value) {
        store.put(key, value);
    }

    public String get(List<String> key) {
        return store.getOrDefault(key, "null");
    }

    public void del(List<String> key) {
        store.remove(key);
    }

    public boolean exists(String key) {
        return store.containsKey(key);
    }

}
