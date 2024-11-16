package github.hacimertgokhan.modals.concurrent;

import java.util.Collections;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

public class actListring {
    private final ConcurrentHashMap<String, List<String>> store = new ConcurrentHashMap<>();

    public ConcurrentHashMap<String, List<String>> getStore() {
        return store;
    }

    public void set(String key, List<String> value) {
        store.put(key, value);
    }

    public List<String> get(String key) {
        return store.getOrDefault(key, Collections.singletonList("null"));
    }

    public void del(String key) {
        store.remove(key);
    }

    public boolean exists(String key) {
        return store.containsKey(key);
    }

}
