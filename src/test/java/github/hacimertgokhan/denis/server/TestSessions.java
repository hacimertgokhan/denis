package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.backup.BackupManager;
import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.denis.security.LoginGuard;
import github.hacimertgokhan.denis.security.PasswordHasher;
import github.hacimertgokhan.denis.sql.SqlEngine;
import github.hacimertgokhan.denis.storage.StorageConfig;
import github.hacimertgokhan.denis.storage.StorageEngine;

import java.io.IOException;
import java.nio.file.Path;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A server context without sockets, for driving {@link Session}s directly in tests. */
public final class TestSessions implements AutoCloseable {
    public static final String GROUP = "tester";
    public static final String PASSWORD = "tester-password";
    public static final String MAIN_TOKEN = "T".repeat(128);

    private final StorageEngine storage;
    private final ExecutorService workers = Executors.newFixedThreadPool(2);
    private final ServerContext context;

    public TestSessions(Path dir) throws IOException {
        StorageConfig storageConfig = StorageConfig.inMemory();
        ServerConfig config = new ServerConfig("127.0.0.1", 0, 100, 100, 1 << 20, 1, 2, 64, 0, 1 << 20, false,
                10, 60, 20_000, true, 10_000, 10_000, dir.resolve("denis.toml"), dir.resolve("ddb.json"),
                dir.resolve("backups"), 0, 3, storageConfig, MAIN_TOKEN);
        storage = new StorageEngine(storageConfig).open();
        GroupManager groups = new GroupManager(config.groupsFile(), new PasswordHasher(20_000));
        groups.create(GROUP, PASSWORD, true);
        context = new ServerContext(config, storage, new SqlEngine(storage, 10_000), groups,
                new ProjectRegistry(config.projectsFile()),
                new BackupManager(storage, config.backupDir(), config.groupsFile(), config.projectsFile(), 3, "test"),
                new LoginGuard(10, 60_000), new ServerMetrics(), workers, "test");
    }

    public ServerContext context() {
        return context;
    }

    /** A new session (one "connection"). */
    public Client client() {
        return new Client(new Session(context, "127.0.0.1"));
    }

    /** Sends lines to a session and waits for each reply, as a connection would. */
    public static final class Client {
        private final Session session;

        Client(Session session) {
            this.session = session;
        }

        public String send(String line) {
            Reply reply = session.handle(line);
            if (reply.deferred() != null) {
                return reply.deferred().join();
            }
            return reply.line() == null ? "" : reply.line();
        }
    }

    @Override
    public void close() {
        workers.shutdownNow();
        storage.close();
    }
}
