package github.hacimertgokhan.denis.security;

import github.hacimertgokhan.denis.sections.group.GroupManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SecurityTest {
    @TempDir
    Path dir;

    @Test
    void pbkdf2HashesVerifyAndNeverContainThePassword() {
        PasswordHasher hasher = new PasswordHasher(20_000);
        String salt = PasswordHasher.newSalt();
        String hash = hasher.hash("s3cret", salt);
        assertTrue(hash.startsWith("pbkdf2-sha512$20000$"));
        assertFalse(hash.contains("s3cret"));
        assertTrue(hasher.verify("s3cret", salt, hash).ok());
        assertFalse(hasher.verify("s3cret!", salt, hash).ok());
        assertFalse(hasher.verify("s3cret", PasswordHasher.newSalt(), hash).ok());
        assertFalse(hasher.verify("s3cret", salt, hash).needsUpgrade());
        // more iterations configured than stored: upgrade on next login
        assertTrue(new PasswordHasher(30_000).verify("s3cret", salt, hash).needsUpgrade());
    }

    @Test
    void legacySha512HashesStillLogInAndAskForAnUpgrade() {
        String salt = PasswordHasher.newSalt();
        String legacy = PasswordHasher.legacySha512("old", salt);
        PasswordHasher.Result result = new PasswordHasher(20_000).verify("old", salt, legacy);
        assertTrue(result.ok());
        assertTrue(result.needsUpgrade());
        assertFalse(new PasswordHasher(20_000).verify("wrong", salt, legacy).ok());
    }

    @Test
    void legacyGroupIsUpgradedOnLogin() throws IOException {
        Path toml = dir.resolve("denis.toml");
        String salt = "c2FsdA==";
        Files.writeString(toml, "[old]\ngroup = \"old\"\nsalt = \"" + salt + "\"\naccess = \""
                + PasswordHasher.legacySha512("pw", salt) + "\"\naccessibility = [\"denis\"]\n");
        GroupManager groups = new GroupManager(toml, new PasswordHasher(20_000));
        assertTrue(groups.login("old", "pw").ok());
        String upgraded = Files.readString(toml);
        assertTrue(upgraded.contains("pbkdf2-sha512$"), upgraded);
        assertTrue(new GroupManager(toml, new PasswordHasher(20_000)).login("old", "pw").ok());
        assertFalse(new GroupManager(toml, new PasswordHasher(20_000)).login("old", "nope").ok());
    }

    @Test
    void adminGroupsAndAccessibility() throws IOException {
        GroupManager groups = new GroupManager(dir.resolve("denis.toml"), new PasswordHasher(20_000));
        groups.create("ops", "x", true);
        groups.create("app", "y", false);
        assertTrue(groups.login("ops", "x").admin());
        assertFalse(groups.login("app", "y").admin());
        assertTrue(groups.grant("app", GroupManager.ADMIN));
        assertTrue(groups.find("app").admin());
        assertTrue(groups.revoke("app", GroupManager.ADMIN));
        assertFalse(groups.find("app").admin());
        groups.setPassword("app", "z");
        assertFalse(groups.login("app", "y").ok());
        assertTrue(groups.login("app", "z").ok());
        assertTrue(groups.delete("app"));
        assertFalse(groups.exists("app"));
    }

    @Test
    void loginGuardLocksAnAddressOutAndForgivesOnSuccess() throws InterruptedException {
        LoginGuard guard = new LoginGuard(3, 200);
        guard.failure("10.0.0.1");
        guard.failure("10.0.0.1");
        assertEquals(0, guard.retryAfter("10.0.0.1"));
        guard.failure("10.0.0.1");
        assertTrue(guard.retryAfter("10.0.0.1") > 0);
        assertEquals(0, guard.retryAfter("10.0.0.2"), "other addresses are not affected");
        Thread.sleep(250);
        assertEquals(0, guard.retryAfter("10.0.0.1"));
        guard.failure("10.0.0.3");
        guard.success("10.0.0.3");
        guard.failure("10.0.0.3");
        guard.failure("10.0.0.3");
        assertEquals(0, guard.retryAfter("10.0.0.3"));
    }
}
