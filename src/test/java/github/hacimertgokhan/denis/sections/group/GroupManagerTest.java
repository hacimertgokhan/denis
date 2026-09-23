package github.hacimertgokhan.denis.sections.group;

import github.hacimertgokhan.denis.security.PasswordHasher;
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
        return new GroupManager(dir.resolve("denis.toml"), new PasswordHasher(20_000));
    }

    @Test
    void createsAGroupThatCanLogIn() throws IOException {
        GroupManager manager = manager();

        GroupManager.CreatedGroup created = manager.create("crm", "s3cret");

        assertEquals("crm", created.name());
        assertEquals("s3cret", created.password());
        assertFalse(created.generatedPassword());
        assertTrue(manager.exists("crm"));
        assertTrue(manager.login("crm", "s3cret").ok());
        assertFalse(manager.login("crm", "wrong").ok());
        assertFalse(manager.login("nobody", "s3cret").ok());
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
    void generatedPasswordsAreNotWrittenAnywhere() throws IOException {
        GroupManager.CreatedGroup created = manager().create("gen", null);
        assertTrue(created.generatedPassword());
        assertTrue(created.password().length() >= 20);
        assertFalse(Files.readString(dir.resolve("denis.toml")).contains(created.password()));
        assertFalse(Files.exists(dir.resolve("pawd.dat")));
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
        assertTrue(manager.login("crm", "first").ok());
    }

    @Test
    void groupsAddedByAnotherProcessAreSeen() throws Exception {
        GroupManager server = manager();
        assertFalse(server.exists("late"));
        // the CLI writes the file while the server keeps its instance
        manager().create("late", "pw");
        Thread.sleep(1100);
        assertTrue(server.exists("late"));
    }
}
