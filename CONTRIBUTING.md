# Contributing to Denis

## Layout

| Path | What |
| --- | --- |
| `src/main/java/github/hacimertgokhan/denis/storage/` | storage engine: keyspaces and slots, write-ahead log (`wal/`), snapshots (`snapshot/`, incl. the reader for the 0.3-0.6 `database.bin` + journal), record codec (`codec/`), tables and indexes (`table/`), quotas |
| `src/main/java/github/hacimertgokhan/denis/sql/` | SQL: parser (ANTLR grammar in `src/main/antlr4/`), AST (`ast/`), binder and evaluators (`exec/`), planner and executor (`SqlEngine`) |
| `src/main/java/github/hacimertgokhan/denis/query/` | the `QUERY { ... }` document language |
| `src/main/java/github/hacimertgokhan/denis/server/` | NIO server (`DenisServer`), protocol (`Session`, incl. `ADMIN`), configuration, metrics |
| `.../denis/security/`, `.../sections/group/`, `.../project/` | password hashing, login lockout, groups (`denis.toml`), project tokens and quotas (`ddb.json`) |
| `.../denis/backup/` | online backups, verification, restore |
| `.../denis/cli/` | `denis` command line (picocli), incl. the remote shell |
| `src/test/java/` | JUnit 5 tests mirroring the main packages, incl. end-to-end server tests over real sockets |
| `benchmarks/` | JMH micro benchmarks, end-to-end load generator, `run.sh`, recorded results |
| `clients/node/`, `java-driver/` | client libraries |
| `clients/mcp/` | MCP server for AI assistants |
| `studio/` | Denis Studio desktop app (Electron) |
| `web/` | Denis Cloud web platform (Next.js), `compose.cloud.yaml` |
| `examples/` | example applications |
| `docs/` | protocol, SQL, architecture, operations |
| `bin/`, `install.*`, `service/`, `docker/`, `Dockerfile`, `compose.yaml` | distribution |

## Rules of the road

- **Never commit runtime state or secrets**: `denis.properties`, `denis.toml`,
  `ddb.json`, `data/`, `logs/`, backups, `.env`. They contain the main token,
  password hashes and data. `git config core.hooksPath .githooks` enables a
  pre-commit hook that refuses them.
- **No build output or binaries in git.** Releases are built by CI from tags.
- **Measure performance changes.** Run `benchmarks/run.sh` before and after
  (same machine, idle) and put the comparison table in the PR; commit the
  results file when the change is notable. Keep a change only if the numbers
  support it.
- **Durability changes need a crash test**: see `StorageEngineTest`
  (copying the data directory before `close()` simulates a crash).
- **Protocol changes are additive**: text-mode replies stay stable, json
  replies only gain fields (`CompatibilityTest` pins the released shapes);
  update `docs/PROTOCOL.md`, both clients, the MCP server and Studio in the same PR.
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
docker run -d -p 5142:5142 -e DENIS_BOOTSTRAP_GROUP=dev -e DENIS_BOOTSTRAP_GROUP_PASSWORD=dev-password denis:local
(cd clients/node && npm test && DENIS_INTEGRATION=1 DENIS_GROUP=dev DENIS_PASSWORD=dev-password npm run test:integration)
(cd clients/mcp && npm install && DENIS_INTEGRATION=1 DENIS_GROUP=dev DENIS_PASSWORD=dev-password npm test)
(cd java-driver && DENIS_INTEGRATION=1 DENIS_GROUP=dev DENIS_PASSWORD=dev-password mvn -B test)
(cd studio && npm install && npm test && npm start)
(cd web && npm ci && npx tsc --noEmit)
```

## Commits and pull requests

- Conventional Commits (`feat(server): ...`, `fix(sql): ...`, `perf(storage): ...`,
  `docs: ...`); the body says *why*.
- One topic per PR; CI (`.github/workflows/ci.yml`) must be green.
- Releases are drafted from merged PR titles by release-drafter; label your PR
  (`breaking`, `feature`, `bug`, `performance`, `chore`, `documentation`) so it
  lands in the right section and bumps the right SemVer component.

## Releasing

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (Added / Changed /
   Removed / Breaking) and set `<version>X.Y.Z</version>` in `pom.xml` and
   `benchmarks/pom.xml`.
2. Commit (`chore(release): X.Y.Z`) and tag: `git tag vX.Y.Z && git push origin master --tags`.
3. The `Release` workflow checks that the tag matches `pom.xml`, builds the jar
   and the bundles with `.sha256` files, pushes `ghcr.io/<owner>/denis:X.Y.Z`
   (+ `latest`, amd64 and arm64), packages Denis Studio and creates the GitHub
   Release with the changelog section as its notes.

Client packages (`clients/node`, `clients/mcp`, `java-driver`) are versioned
separately; bump them when their API changes.
