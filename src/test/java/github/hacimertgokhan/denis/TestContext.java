package github.hacimertgokhan.denis;

import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.denis.server.ServerContext;
import github.hacimertgokhan.proto.ProtoDatabase;

import java.io.IOException;
import java.nio.file.Path;
import java.util.concurrent.ConcurrentHashMap;

/** A {@link ServerContext} on a temporary directory with one login group. */
public final class TestContext {
    public static final String GROUP = "test";
    public static final String PASSWORD = "s3cret";
    public static final String MAIN_TOKEN = "M".repeat(128);

    private TestContext() {
    }

    /** Synchronous persistence (flush interval 0) so tests can read the file right away. */
    public static ServerContext open(Path dir) throws IOException {
        return open(dir, 0);
    }

    public static ServerContext open(Path dir, long flushIntervalMillis) throws IOException {
        String groupsFile = dir.resolve(GroupManager.DEFAULT_TOML).toString();
        GroupManager groups = new GroupManager(groupsFile);
        if (!groups.exists(GROUP)) {
            groups.create(GROUP, PASSWORD);
        }
        ProtoDatabase persistence = new ProtoDatabase(dir.resolve(ServerContext.DATABASE_FILE), flushIntervalMillis);
        ProjectRegistry projects = new ProjectRegistry(dir.resolve(ServerContext.PROJECTS_FILE).toString());
        ServerContext ctx = new ServerContext(new ConcurrentHashMap<>(), persistence, projects, groupsFile, null);
        ctx.setMainToken(MAIN_TOKEN);
        return ctx;
    }
}
