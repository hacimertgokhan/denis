# Operating Denis

## Install

Denis needs Java 17 or newer (a JRE is enough).

| platform | command |
| --- | --- |
| Linux, macOS, Raspberry Pi | `curl -fsSL https://raw.githubusercontent.com/hacimertgokhan/denis/master/install.sh \| sh` |
| Windows (PowerShell) | `irm https://raw.githubusercontent.com/hacimertgokhan/denis/master/install.ps1 \| iex` |
| from a release bundle | extract it, run `sh install.sh` or `install.bat` |
| Docker | `docker run -d -p 127.0.0.1:5142:5142 -v denis-data:/data -e DENIS_BOOTSTRAP_GROUP=admin -e DENIS_BOOTSTRAP_GROUP_PASSWORD=... ghcr.io/hacimertgokhan/denis` |

The installers put everything in one directory (`~/.denis`,
`%LOCALAPPDATA%\Denis`), put `denis` on the PATH, and run `denis init`, which
writes `denis.properties` and creates an admin group whose password is printed
**once**. Installer options: `DENIS_PROFILE=small` (small devices),
`DENIS_BIND=0.0.0.0` (accept remote clients), `DENIS_SERVICE=1` (systemd user
service), `DENIS_VERSION`, `DENIS_INSTALL`. Upgrading is running the installer
again: program files are replaced, configuration and data are kept.

Start with `denis server`; stop with Ctrl+C / SIGTERM (a final checkpoint is
written).

### As a service

- **Linux (system)**: `service/denis.service` — a hardened unit running as
  user `denis` with data in `/var/lib/denis` (instructions in the file).
- **Linux (user)**: `DENIS_SERVICE=1` with the installer.
- **Windows**: register `bin\denis.bat server` with a service wrapper such as
  WinSW or NSSM, or use the Docker image.

## Configuration

`denis.properties` in `DENIS_HOME` (the installation directory by default);
every key can be overridden by an environment variable `DENIS_<KEY>` with `-`
as `_` (`DENIS_MAX_MEMORY=256mb`). The bundled file documents every key; the
important ones:

| key | default | notes |
| --- | --- | --- |
| `bind-address` | `127.0.0.1` | `0.0.0.0` to accept other machines |
| `ddb-port` | `5142` | |
| `fsync` | `everysec` | `always` for no acknowledged-write loss, `no` for speed |
| `max-memory` | `0` (unlimited) | keep it below the JVM heap (`-Xmx`) |
| `eviction-policy` | `cache-lru` | or `noeviction` |
| `checkpoint-wal-size` / `checkpoint-interval-seconds` | `64mb` / `300` | disk used by the log ≈ this |
| `backup-interval-minutes` / `backup-retention` | `0` / `7` | automatic backups |
| `max-connections-per-ip` / `max-clients` | `64` / `10000` | |
| `login-max-failures` / `login-lockout-seconds` | `10` / `60` | brute-force protection |
| `persistence` | `on` | `off`: pure in-memory cache, no files |
| `log-file` | `logs/denis.log` | `none` for console only |

JVM options go into `DENIS_JAVA_OPTS` (launchers) or `JAVA_OPTS` (Docker).

## Small devices (IoT)

Denis runs on a Raspberry Pi Zero 2 / Pi 3 class board. Recommended:

```sh
DENIS_PROFILE=small sh install.sh      # or: denis init --profile small
export DENIS_JAVA_OPTS="-Xmx96m -XX:+UseSerialGC -Xss256k -XX:TieredStopAtLevel=1"
denis server
```

The `small` profile sets 1 network thread, 2 workers, `max-memory=64mb`,
smaller log segments and checkpoints (less disk and SD-card wear), fewer
PBKDF2 iterations (logins stay fast on slow CPUs) and a lower result-row
limit. The server itself idles at a few MB of heap; the JVM adds about 30 MB.
For SD cards prefer `fsync=everysec` (the default) — `always` issues one flush
per write batch.

## Groups and projects

```sh
denis cli group create app -p 's3cret'      # --admin for an admin group
denis cli group list | test | passwd | delete | grant <name> admin | revoke
denis cli token list | create [--owner group] | delete <token>
```

Admin groups can use every project and run `SAVE`, `BACKUP`, `BACKUPS`, and
see recovery details in `INFO`. Other groups see and open only the projects
they created (and ownerless legacy ones).

## Backups

- **Online** (server running): `denis backup create -g admin -p ...`, the
  `BACKUP` command, Denis Studio, or automatically with
  `backup-interval-minutes`. A backup is a zip with a fresh snapshot, the log
  since it, `denis.toml`, `ddb.json` and a manifest with SHA-256 checksums.
  Writers are never blocked.
- **List / verify**: `denis backup list`, `denis backup verify <file>`
  (checksums and a full decode of every record).
- **Restore** (server stopped): `denis backup restore <file>` verifies first,
  moves the current data to `before-restore-<time>/` (nothing is deleted) and
  extracts the backup.
- **One project**: `DUMP` / `IMPORT` (JSON) — what Denis Studio's
  export/import uses; also handy to copy a project between servers.

Copy backups off the machine (`data/backups/` is on the same disk).

## Health and monitoring

- `PING` without login; the Docker image uses it as health check.
- `INFO` (any logged-in group): uptime, connections, ops/s, hit ratio,
  memory used/max, evictions, persistence health (`healthy`, `walBytes`,
  `lastCheckpointAt`, `lastError`), key and table counts.
- Denis Studio's dashboard shows the same live.
- `denis db verify` checks the snapshot and every log segment offline.

If `INFO` shows `"healthy": false`, the log cannot be written (disk full or
read-only); durable writes are refused with `PERSISTENCE` until space is
freed, then the server recovers by itself.

## Upgrading from 0.0.x

1. Stop the old server and keep a copy of its directory.
2. Install 0.1 into the same directory (or copy `denis.toml`, `ddb.json`,
   `database.bin` into the new `DENIS_HOME`).
3. Start it: `database.bin` is imported into `data/` and renamed
   `database.bin.migrated`; group passwords keep working and are re-hashed
   with PBKDF2 on the next login.
4. The server now listens on `127.0.0.1` only — set `bind-address=0.0.0.0` if
   clients connect from other machines. `pawd.dat` is no longer used; delete
   it after you have stored the passwords elsewhere.

## Security checklist

- Keep `bind-address=127.0.0.1` unless needed; otherwise firewall the port to
  known clients. For untrusted networks use SSH tunnels, a VPN or a TLS
  terminator (Denis does not speak TLS itself).
- Use long random group passwords (`denis cli group passwd <name>` generates
  one); give applications non-admin groups.
- Keep `enforce-project-ownership=true`.
- Run as an unprivileged user (the systemd unit and Docker image do).
- Protect `denis.toml` and backups: they contain password hashes and all data.
