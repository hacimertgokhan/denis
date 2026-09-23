# Contributing to Denis

## Layout

| Path | What |
| --- | --- |
| `src/main/java/github/hacimertgokhan/denis/storage/` | storage engine: keyspaces and slots, write-ahead log (`wal/`), snapshots (`snapshot/`), record codec (`codec/`), tables and indexes (`table/`) |
| `src/main/java/github/hacimertgokhan/denis/sql/` | SQL: parser (ANTLR grammar in `src/main/antlr4/`), AST (`ast/`), binder and evaluators (`exec/`), planner and executor (`SqlEngine`) |
| `src/main/java/github/hacimertgokhan/denis/server/` | NIO server (`DenisServer`), protocol (`Session`), configuration, metrics |
| `.../denis/security/`, `.../sections/group/`, `.../project/` | password hashing, login lockout, groups (`denis.toml`), project tokens (`ddb.json`) |
| `.../denis/backup/` | online backups, verification, restore |
| `.../denis/cli/` | `denis` command line (picocli) |
| `src/test/java/` | JUnit 5 tests mirroring the main packages, incl. end-to-end server tests over real sockets |
| `benchmarks/` | JMH micro benchmarks, end-to-end load generator, `run.sh`, recorded results |
| `clients/node/`, `java-driver/` | client libraries |
| `studio/` | Denis Studio desktop app (Electron) |
| `docs/` | protocol, SQL, architecture, operations |
| `bin/`, `install.*`, `service/`, `Dockerfile`, `compose.yaml` | distribution |

## Rules of the road

- **Never commit runtime state**: `denis.properties`, `denis.toml`, `ddb.json`,
  `data/`, `logs/`, backups. They contain password hashes and data.
- **No build output or binaries in git.** Releases are built by CI from tags.
- **Measure performance changes.** Run `benchmarks/run.sh` before and after
  (same machine, idle) and put the comparison table in the PR; commit the
  results file when the change is notable. Keep a change only if the numbers
  support it.
- **Durability changes need a crash test**: see `StorageEngineTest`
  (copying the data directory before `close()` simulates a crash).
- **Protocol changes are additive**: text-mode replies stay stable, json
  replies only gain fields; update `docs/PROTOCOL.md`, both clients and
  Studio in the same PR.
- **Configuration** goes through `DenisProperties`/`ServerConfig` with a
  documented default in `src/main/resources/denis.properties`; every key works
  from the environment as `DENIS_<KEY>`.
- **Dependencies**: the server jar must stay small (it targets small devices
  too). Adding a runtime dependency needs a good reason.
- **Style**: 4-space indent for Java, 2 for everything else, LF line endings
  (`.editorconfig`, `.gitattributes`); the build compiles with `-Xlint:all`
  and must not add warnings.

## Working on it

```sh
mvn -B verify                                        # server + tests
mvn -B -q -DskipTests install && bash benchmarks/run.sh my-change   # benchmarks
docker build -t denis:local .
(cd clients/node && npm test)
(cd java-driver && mvn -B test)
(cd studio && npm install && npm test && npm start)
```

## Commits and pull requests

- Conventional Commits (`feat(server): ...`, `fix(sql): ...`, `perf(storage): ...`,
  `docs: ...`); the body says *why*.
- One topic per PR; CI must be green.
- Releases are drafted from merged PR titles; label PRs (`feature`, `bug`,
  `performance`, `chore`, `documentation`).
