# Contributing to Denis

## Layout

| Path | What |
| --- | --- |
| `src/main/java/github/hacimertgokhan/` | the server: `Main` (bootstrap, accept loop), `denis/DenisClient` (one client session, the wire protocol), `denis/cli` (management CLI), `denis/sections/group` (login groups), `readers` (config), `proto` (protobuf persistence), `denis/sql` (SQL subset) |
| `src/main/resources/` | bundled defaults: `denis.properties`, `lang/*.json`, `log4j2.xml` |
| `src/test/java/` | JUnit 5 unit tests, mirrored on the main packages |
| `clients/node/` | Node.js client (`npm test`) |
| `java-driver/` | Java client (own Maven module) |
| `docker/`, `Dockerfile`, `compose.yaml` | container build and run |
| `bin/`, `install.*`, `start*.{sh,bat}`, `service/` | release bundle launchers |

## Rules of the road

- **Never commit runtime state.** `denis.properties`, `denis.toml`, `ddb.json`,
  `pawd.dat`, `database.bin`, `storage/`, `logs/` and `denis/` are produced by a
  running server and contain tokens and password hashes. They are ignored; keep
  them that way.
- **No build output or binaries in git.** Jars go to GitHub Releases; Maven
  resolves dependencies. `target/`, `out/`, `builds/`, `lib/` are ignored.
- **File names** must be valid on every OS: no `:`, no leading/trailing spaces.
  (The old activity logs made the repository impossible to clone on Windows.)
- **Line endings are LF** (`.gitattributes`), 4-space indent for Java, 2 for
  everything else (`.editorconfig`).
- **Configuration** goes through `DenisProperties` and is documented in the
  README table: a new key needs a default in `src/main/resources/denis.properties`
  and works from the environment automatically (`DENIS_<KEY>`).
- **Protocol changes** are additive: keep `text` mode replies stable for people
  using telnet, add fields to `json` mode replies rather than changing them, and
  update both clients plus the README "Wire protocol" section in the same PR.
- **Tests**: unit tests run in `mvn package` and in the Docker build stage;
  anything that needs a live server goes into the client integration tests,
  which CI runs against the freshly built image.

## Working on it

```sh
mvn -B package                                # server + unit tests
docker build -t denis:local .                 # image (runs the unit tests too)
docker run -d -p 5142:5142 -e DENIS_BOOTSTRAP_GROUP=dev -e DENIS_BOOTSTRAP_GROUP_PASSWORD=dev denis:local
(cd clients/node && DENIS_INTEGRATION=1 DENIS_GROUP=dev DENIS_PASSWORD=dev npm test)
(cd java-driver && DENIS_INTEGRATION=1 DENIS_GROUP=dev DENIS_PASSWORD=dev mvn -B test)
```

## Commits and pull requests

- Conventional Commits (`feat(server): ...`, `fix(cli): ...`, `docs: ...`); the
  body says *why*.
- One topic per PR; CI (`.github/workflows/ci.yml`) must be green.
- Releases are drafted from merged PR titles by release-drafter; label your PR
  (`feature`, `bug`, `chore`, `documentation`) so it lands in the right section.
