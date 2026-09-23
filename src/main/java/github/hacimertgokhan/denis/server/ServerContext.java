package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.backup.BackupManager;
import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sections.group.GroupManager;
import github.hacimertgokhan.denis.security.LoginGuard;
import github.hacimertgokhan.denis.sql.SqlEngine;
import github.hacimertgokhan.denis.storage.StorageEngine;

import java.util.concurrent.ExecutorService;

/** The services a session works with; one instance per server. */
public record ServerContext(
        ServerConfig config,
        StorageEngine storage,
        SqlEngine sql,
        GroupManager groups,
        ProjectRegistry projects,
        BackupManager backups,
        LoginGuard loginGuard,
        ServerMetrics metrics,
        ExecutorService workers,
        String version) {
}
