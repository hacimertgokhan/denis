package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.DenisTerminal;
import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.logger.DenisLogger;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.proto.ProtoDatabase;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Everything one server process shares between its connections: the cache,
 * the persisted store, the project registry, the login groups and a few
 * counters for {@code INFO}. Built once by {@link DenisServer} (or by a test
 * with a temporary directory) and handed to every {@code DenisClient}.
 */
public class ServerContext implements AutoCloseable {
    private static final DenisLogger log = new DenisLogger(ServerContext.class);

    public static final String DATABASE_FILE = "database.bin";
    public static final String PROJECTS_FILE = "ddb.json";

    private final ConcurrentHashMap<String, Any> store;
    private final ProtoDatabase persistence;
    private final ProjectRegistry projects;
    private final String groupsFile;
    private final DenisTerminal activityLog;
    private final Instant startedAt = Instant.now();
    private final AtomicLong connectionsTotal = new AtomicLong();
    private final AtomicLong commandsTotal = new AtomicLong();
    private final AtomicLong connectionsOpen = new AtomicLong();

    /** Runtime files relative to the working directory, one second write-behind. */
    public static ServerContext open(DenisTerminal activityLog) throws IOException {
        return open(Path.of(""), ProtoDatabase.DEFAULT_FLUSH_INTERVAL_MILLIS, activityLog);
    }

    public static ServerContext open(Path dataDir, long flushIntervalMillis, DenisTerminal activityLog) throws IOException {
        ProtoDatabase persistence = new ProtoDatabase(dataDir.resolve(DATABASE_FILE), flushIntervalMillis);
        ProjectRegistry projects = new ProjectRegistry(dataDir.resolve(PROJECTS_FILE).toString());
        String groupsFile = dataDir.resolve(GroupManager.DEFAULT_TOML).toString();
        return new ServerContext(new ConcurrentHashMap<>(), persistence, projects, groupsFile, activityLog);
    }

    public ServerContext(ConcurrentHashMap<String, Any> store, ProtoDatabase persistence, ProjectRegistry projects,
                         String groupsFile, DenisTerminal activityLog) {
        this.store = store;
        this.persistence = persistence;
        this.projects = projects;
        this.groupsFile = groupsFile;
        this.activityLog = activityLog;
        warmCache();
    }

    /**
     * Seed the cache with every persisted key so a {@code GET} after a restart
     * is served from memory and never has to consult the file per request.
     */
    private void warmCache() {
        int loaded = 0;
        for (String token : projects.list()) {
            for (Map.Entry<String, String> entry : persistence.findToken(token).entrySet()) {
                if (store.putIfAbsent(ProjectStore.fullKey(token, entry.getKey()), new Any(entry.getValue())) == null) {
                    loaded++;
                }
            }
        }
        if (loaded > 0) {
            log.info(String.format("Cache warmed with %d persisted keys from %s", loaded, persistence.getPath()));
        }
    }

    public ConcurrentHashMap<String, Any> store() {
        return store;
    }

    public ProtoDatabase persistence() {
        return persistence;
    }

    public ProjectRegistry projects() {
        return projects;
    }

    public GroupManager groups() {
        return new GroupManager(groupsFile);
    }

    public String groupsFile() {
        return groupsFile;
    }

    public DenisTerminal activityLog() {
        return activityLog;
    }

    public ProjectStore project(String token) {
        return new ProjectStore(token, store, persistence);
    }

    public Instant startedAt() {
        return startedAt;
    }

    public long uptimeSeconds() {
        return Instant.now().getEpochSecond() - startedAt.getEpochSecond();
    }

    public void connectionOpened() {
        connectionsTotal.incrementAndGet();
        connectionsOpen.incrementAndGet();
    }

    public void connectionClosed() {
        connectionsOpen.decrementAndGet();
    }

    public void commandHandled() {
        commandsTotal.incrementAndGet();
    }

    public long connectionsTotal() {
        return connectionsTotal.get();
    }

    public long connectionsOpen() {
        return connectionsOpen.get();
    }

    public long commandsTotal() {
        return commandsTotal.get();
    }

    @Override
    public void close() throws IOException {
        persistence.close();
    }
}
