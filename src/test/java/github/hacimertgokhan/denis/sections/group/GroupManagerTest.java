package github.hacimertgokhan.denis.sections.group;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GroupManagerTest {
    @TempDir
    Path dir;

    private GroupManager manager() {
        return new GroupManager(dir.resolve("denis.toml").toString());
    }

    @Test
    void createsAGroupThatCanLogIn() throws IOException {
        GroupManager manager = manager();

        GroupManager.CreatedGroup created = manager.create("crm", "s3cret");

        assertEquals("crm", created.name());
        assertEquals("s3cret", created.password());
        assertFalse(created.generatedPassword());
        assertTrue(manager.exists("crm"));
        assertTrue(manager.verify("crm", "s3cret"));
        assertFalse(manager.verify("crm", "wrong"));
        assertFalse(manager.verify("nobody", "s3cret"));
        assertEquals(List.of("crm"), manager.list());
    }

    @Test
    void passwordIsStoredHashedOnly() throws IOException {
        manager().create("crm", "s3cret");

        String toml = Files.readString(dir.resolve("denis.toml"));
        assertFalse(toml.contains("s3cret"));
        assertTrue(toml.contains("salt"));
        assertTrue(toml.contains("access"));
    }

    @Test
    void duplicateAndInvalidNamesAreRejected() throws IOException {
        GroupManager manager = manager();
        manager.create("crm", "x");

        assertThrows(IllegalStateException.class, () -> manager.create("crm", "y"));
        assertThrows(IllegalArgumentException.class, () -> manager.create("has space", "y"));
        assertThrows(IllegalArgumentException.class, () -> manager.create("", "y"));
    }

    @Test
    void ensureIsIdempotent() throws IOException {
        GroupManager manager = manager();

        assertTrue(manager.ensure("crm", "first"));
        assertFalse(manager.ensure("crm", "second"));
        // the first password stays valid; ensure never rotates it
        assertTrue(manager.verify("crm", "first"));
    }
}
