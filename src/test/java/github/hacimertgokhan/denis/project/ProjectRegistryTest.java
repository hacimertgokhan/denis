package github.hacimertgokhan.denis.project;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProjectRegistryTest {
    @TempDir
    Path dir;

    @Test
    void concurrentCreatesLoseNoToken() throws Exception {
        ProjectRegistry registry = new ProjectRegistry(dir.resolve("ddb.json"));
        ExecutorService pool = Executors.newFixedThreadPool(8);
        Set<String> created = ConcurrentHashMap.newKeySet();
        List<Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < 200; i++) {
            futures.add(pool.submit(() -> created.add(registry.create("crm"))));
        }
        for (Future<?> f : futures) {
            f.get();
        }
        pool.shutdown();
        assertEquals(200, created.size());
        ProjectRegistry reread = new ProjectRegistry(dir.resolve("ddb.json"));
        assertEquals(200, reread.list().size());
        created.forEach(t -> assertEquals("crm", reread.owner(t)));
    }

    @Test
    void legacyFileWithoutOwnersIsReadable() throws Exception {
        Files.writeString(dir.resolve("ddb.json"), "{\"tokens\": [\"abc\", \"def\"]}");
        ProjectRegistry registry = new ProjectRegistry(dir.resolve("ddb.json"));
        assertTrue(registry.exists("abc"));
        assertEquals("", registry.owner("def"));
        assertNull(registry.owner("nope"));
        assertTrue(registry.delete("abc"));
        assertFalse(registry.exists("abc"));
        assertTrue(Files.readString(dir.resolve("ddb.json")).contains("def"));
    }
}
