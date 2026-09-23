#!/usr/bin/env node
"use strict";

/**
 * End-to-end check of the main-process modules (ConnectionManager, adapter,
 * dump files, CSV export) against a real Denis server.
 *
 *   DENIS_E2E_JAR=/path/to/denis.jar npm run test:e2e
 *       starts `java -jar <jar> server` in a fresh temp directory with
 *       DENIS_BOOTSTRAP_GROUP=studio / studio-pw on DENIS_E2E_PORT (default 7103),
 *       restarts it once (reconnect + durability) and stops it at the end.
 *
 *   DENIS_E2E_HOST / DENIS_E2E_PORT / DENIS_E2E_GROUP / DENIS_E2E_PASSWORD
 *       without DENIS_E2E_JAR: use an already running server (no restart test).
 *
 * The script only ever stops the server process it started itself.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { DenisClient } = require("denis-client");
const { ConnectionManager } = require("../../src/main/connection");
const dumpfile = require("../../src/main/dumpfile");
const { toCsv } = require("../../src/main/export");
const { classify } = require("../../src/main/console-commands");

const JAR = process.env.DENIS_E2E_JAR;
const HOST = process.env.DENIS_E2E_HOST || "127.0.0.1";
const PORT = Number(process.env.DENIS_E2E_PORT || 7103);
const GROUP = process.env.DENIS_E2E_GROUP || "studio";
const PASSWORD = process.env.DENIS_E2E_PASSWORD || "studio-pw";

const results = [];
const findings = [];
let server = null;
let workDir = null;

function log(...a) {
  console.log(...a);
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    log(`PASS  ${name} (${Date.now() - started} ms)${detail ? ` - ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    log(`FAIL  ${name}: ${err && err.code ? `[${err.code}] ` : ""}${err && err.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function waitForPort(port, ms = 30000) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.createConnection({ host: HOST, port });
      s.once("connect", () => {
        s.destroy();
        resolve();
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() > end) reject(new Error(`port ${port} did not open`));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

async function startServer() {
  if (!workDir) workDir = fs.mkdtempSync(path.join(os.tmpdir(), "denis-studio-e2e-"));
  const logFile = fs.openSync(path.join(workDir, "server.log"), "a");
  server = spawn("java", ["-jar", JAR, "server"], {
    cwd: workDir,
    env: { ...process.env, DENIS_BOOTSTRAP_GROUP: GROUP, DENIS_BOOTSTRAP_GROUP_PASSWORD: PASSWORD, DENIS_DDB_PORT: String(PORT), DENIS_PASSWORD_ITERATIONS: "20000" },
    stdio: ["ignore", logFile, logFile],
    windowsHide: true,
  });
  await waitForPort(PORT);
}

async function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
}

async function main() {
  if (JAR) {
    log(`starting ${JAR} on port ${PORT}`);
    await startServer();
    log(`server data directory: ${workDir}`);
  } else {
    log(`using a running server at ${HOST}:${PORT}`);
  }

  const manager = new ConnectionManager({
    createClient: (o) => new DenisClient(o),
    options: { heartbeatMs: 1000, reconnectDelays: [300, 500, 1000, 1000, 2000] },
    logger: { info() {}, warn: (m) => log(`      (manager) ${m}`) },
  });
  const states = [];
  manager.on("status", (s) => states.push(s.state));
  const target = { host: HOST, port: PORT, group: GROUP, name: "e2e" };
  let tokenA;
  let tokenB;
  let dumpText;

  await step("test connection (HELLO + LIN)", async () => {
    const r = await manager.test(target, PASSWORD);
    assert(r.version && r.protocol === 2, "version/protocol missing");
    assert(r.admin === true, "bootstrap group should be admin");
    const bad = await manager.test(target, "wrong").then(() => null, (e) => e);
    assert(bad && bad.code === "AUTH", `wrong password gives AUTH (got ${bad && bad.code})`);
    return `Denis ${r.version}, admin, ${r.latencyMs} ms`;
  });

  await step("connect without project", async () => {
    const s = await manager.connect(target, PASSWORD);
    assert(s.state === "connected" && s.project === null, "connected without project");
    return `client mode: ${s.clientMode}`;
  });

  await step("projects: create + use", async () => {
    tokenA = await manager.run((api) => api.createProject());
    await manager.use(tokenA);
    assert(manager.getStatus().project === tokenA, "project switched");
    const list = await manager.run((api) => api.projects());
    assert(list.some((p) => p.token === tokenA && p.current), "PROJECTS shows current");
    return `${list.length} project(s)`;
  });

  await step("keys: set/get/layers/ttl/incr/expire/persist/del", async () => {
    await manager.run(async (api) => {
      await api.set("cache:one", "hello world", { ttl: 120 });
      await api.set("durable:one", '{"name":"Ada","tags":["x"]}', { persist: true });
      await api.set("counter", "41", { persist: true });
      await api.set("trailing", "ends with space ");
      for (let i = 0; i < 30; i++) await api.set(`bulk:${String(i).padStart(2, "0")}`, `v${i}`);
    });
    const [c1, d1, tr] = await manager.run((api) => api.keyMeta(["cache:one", "durable:one", "trailing"]));
    assert(c1.cache && !c1.persistent && c1.ttl > 100 && c1.ttl <= 120, `cache:one meta ${JSON.stringify(c1)}`);
    assert(d1.cache && d1.persistent && d1.ttl === -1, `durable:one meta ${JSON.stringify(d1)}`);
    assert((await manager.run((api) => api.get("durable:one", { source: "persistent" }))) === '{"name":"Ada","tags":["x"]}', "durable value");
    const trailing = await manager.run((api) => api.get("trailing"));
    if (trailing !== "ends with space ") findings.push(`trailing space not kept by this server build: ${JSON.stringify(trailing)}`);
    assert(tr.exists, "trailing key exists");
    assert((await manager.run((api) => api.incr("counter", 1, { persist: true }))) === 42, "INCR");
    const typeErr = await manager.run((api) => api.incr("cache:one", 1)).then(() => null, (e) => e);
    assert(typeErr && typeErr.code === "TYPE", `INCR on text -> TYPE (got ${typeErr && typeErr.code})`);
    assert((await manager.run((api) => api.expire("counter", 300))) === true, "EXPIRE");
    assert((await manager.run((api) => api.ttl("counter"))) > 0, "TTL after EXPIRE");
    await manager.run((api) => api.persist("counter"));
    assert((await manager.run((api) => api.ttl("counter"))) === -1, "PERSIST");
    const keys = await manager.run((api) => api.keys("bulk:*", { limit: 10 }));
    assert(keys.keys.length === 10 && keys.truncated === true, `KEYS limit/truncated ${JSON.stringify(keys)}`);
    const durableOnly = await manager.run((api) => api.keys("*", { layer: "persistent" }));
    assert(durableOnly.keys.includes("durable:one") && !durableOnly.keys.includes("cache:one"), "KEYS -&protobuff");
    await manager.run((api) => api.del("durable:one", "cache"));
    const [after] = await manager.run((api) => api.keyMeta(["durable:one"]));
    assert(!after.cache && after.persistent, "DEL -&cache keeps durable");
    assert((await manager.run((api) => api.get("nope"))) === null, "missing key -> null");
    const bad = await manager.run((api) => api.set("k", "x -&save")).then(() => null, (e) => e);
    assert(bad && bad.code === "EINVAL", "-& word rejected client side");
    return "ok";
  });

  let selectResult;
  await step("SQL: create/insert(params)/select/explain/show/describe/errors", async () => {
    await manager.run((api) => api.query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)"));
    const ins = await manager.run((api) => api.query("INSERT INTO users (name, age) VALUES (?, ?)", ["Ada, \"the first\"", null]));
    assert(ins.affected === 1 && ins.lastRowId === 1, `insert ${JSON.stringify(ins)}`);
    assert(ins.columns === undefined, "a change is not a result set");
    await manager.run((api) => api.query("INSERT INTO users (name, age)\nVALUES (?, ?)", ["=cmd()", 36]));
    selectResult = await manager.run((api) => api.query("SELECT * FROM users ORDER BY id", []));
    assert(selectResult.columns.join() === "id,name,age" && selectResult.rows.length === 2, `select ${JSON.stringify(selectResult)}`);
    // the server sends row objects; the grid's arrays follow the order of "columns"
    const reordered = await manager.run((api) => api.query("SELECT age, name, id FROM users ORDER BY id", []));
    assert(reordered.columns.join() === "age,name,id" && reordered.rows[1][0] === 36 && reordered.rows[1][2] === 2, `column order ${JSON.stringify(reordered)}`);
    const explain = await manager.run((api) => api.query("EXPLAIN SELECT * FROM users WHERE id = 1"));
    assert(explain.columns[0] === "plan", "EXPLAIN plan column");
    const show = await manager.run((api) => api.query("SHOW TABLES"));
    assert(show.rows.some((r) => r[0] === "users"), "SHOW TABLES");
    const desc = await manager.run((api) => api.query("DESCRIBE users"));
    assert(desc.rows.length === 3, "DESCRIBE");
    const err = await manager.run((api) => api.query("SELECT * FROM nope")).then(() => null, (e) => e);
    assert(err && err.code === "SQL", `SQL error code (got ${err && err.code})`);
    const comment = await manager.run((api) => api.query("SELECT 1 -- trailing comment")).then(() => "accepted", (e) => e.message);
    if (comment !== "accepted") findings.push(`SQL comments are not accepted by the parser (the studio strips them): ${comment}`);
    return `EXPLAIN: ${explain.rows.map((r) => r[0]).join(" | ")}`;
  });

  await step("CSV export of a real result", async () => {
    const csv = toCsv(selectResult.columns, selectResult.rows);
    assert(csv.includes('"Ada, ""the first"""') && csv.includes("'=cmd()") && csv.includes("1,") && csv.endsWith("\r\n"), csv);
    return csv.split("\r\n").length - 1 + " lines";
  });

  await step("server info / dbsize", async () => {
    const info = await manager.run((api) => api.info());
    assert(info.server && info.memory && info.persistence && info.keyspace, "INFO sections");
    const size = await manager.run((api) => api.dbsize());
    assert(size.tables === 1, `DBSIZE tables ${JSON.stringify(size)}`);
    return `ops/s ${info.stats.opsPerSecond}, fsync ${info.persistence.fsync}, ${size.keys} keys`;
  });

  await step("logical export: DUMP -> .denis.json -> parse", async () => {
    const dump = await manager.run((api) => api.dump());
    const file = dumpfile.wrapDump(dump, { ...target, project: tokenA, serverVersion: manager.getStatus().version, studioVersion: "e2e" });
    dumpText = dumpfile.serialize(file);
    assert(!dumpText.includes(tokenA), "full token not in export");
    const parsed = dumpfile.parseDumpFile(dumpText);
    assert(parsed.summary.tables === 1 && parsed.summary.rows === 2, JSON.stringify(parsed.summary));
    return `${parsed.summary.keys} keys, ${parsed.summary.tables} table, ${parsed.summary.rows} rows, ${Buffer.byteLength(dumpText)} bytes`;
  });

  await step("import into a new project (+ replace, + conflict)", async () => {
    tokenB = await manager.run((api) => api.createProject());
    await manager.use(tokenB);
    const { dump } = dumpfile.parseDumpFile(dumpText);
    const r = await manager.run((api) => api.import(dump, {}));
    assert(r.tables === 1 && r.rows === 2, `import ${JSON.stringify(r)}`);
    assert((await manager.run((api) => api.get("counter"))) === "42", "imported value");
    const conflict = await manager.run((api) => api.import(dump, {})).then(() => null, (e) => e);
    assert(conflict && conflict.code === "SQL" && /already exists/.test(conflict.message), `conflict error (got ${conflict && conflict.message})`);
    const again = await manager.run((api) => api.import(dump, { replace: true }));
    assert(again.rows === 2, "replace import");
    const count = await manager.run((api) => api.query("SELECT COUNT(*) AS n FROM users"));
    assert(count.rows[0][0] === 2, `rows after replace: ${JSON.stringify(count.rows)}`);
    return `imported ${JSON.stringify(r)}`;
  });

  await step("large import is chunked (append)", async () => {
    const rows = Array.from({ length: 20000 }, (_, i) => [i + 1, `name-${i}-${"x".repeat(60)}`]);
    const dump = { format: 1, cache: {}, persistent: {}, ttl: {}, tables: { big: { columns: [{ name: "id", type: "INTEGER", primaryKey: true, notNull: true }, { name: "name", type: "TEXT" }], indexes: [], rows } } };
    const bytes = Buffer.byteLength(JSON.stringify(dump));
    const r = await manager.run((api) => api.import(dump, {}));
    const count = await manager.run((api) => api.query("SELECT COUNT(*) FROM big"));
    assert(count.rows[0][0] === 20000, `big count ${JSON.stringify(count.rows)}`);
    return `${(bytes / 1048576).toFixed(1)} MB, ${JSON.stringify(r)}`;
  });

  await step("admin: SAVE / BACKUP / BACKUPS", async () => {
    const save = await manager.run((api) => api.save());
    const backup = await manager.run((api) => api.backup());
    const list = await manager.run((api) => api.backups());
    assert(list.backups.some((b) => b.name === backup.name), "backup listed");
    return `snapshot ${save.bytes} B, backup ${backup.name} (${backup.bytes} B)`;
  });

  await step("console classification + raw command", async () => {
    assert(classify("MODE text").kind === "refuse", "MODE refused");
    const reply = await manager.run((api) => api.command("DBSIZE"));
    assert(reply.ok === true && typeof reply.keys === "number", JSON.stringify(reply));
    const unknown = await manager.run((api) => api.command("FROB"));
    assert(unknown.ok === false && unknown.code === "UNKNOWN", JSON.stringify(unknown));
    return "ok";
  });

  await step("protocol quirk: UPDATE <key> <value containing SET>", async () => {
    const reply = await manager.run((api) => api.command("UPDATE counter hello SET world"));
    if (!reply.ok && reply.code === "SQL") {
      findings.push(`"UPDATE counter hello SET world" (key-value UPDATE whose value contains " SET ") is routed to SQL: ${reply.error}`);
      return "server treats it as SQL (reported)";
    }
    return `reply ${JSON.stringify(reply)}`;
  });

  if (JAR) {
    await step("server restart: reconnect + durability", async () => {
      await manager.use(tokenA);
      await stopServer();
      const lost = await manager.run((api) => api.ping()).then(() => null, (e) => e);
      assert(lost, "a command during the outage fails");
      await startServer();
      const end = Date.now() + 20000;
      while (manager.getStatus().state !== "connected" && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
      assert(manager.getStatus().state === "connected", `state ${manager.getStatus().state}`);
      assert(manager.getStatus().project === tokenA, "project restored");
      const durable = await manager.run((api) => api.get("durable:one"));
      const cacheOnly = await manager.run((api) => api.get("cache:one"));
      assert(durable === '{"name":"Ada","tags":["x"]}', `durable after restart: ${durable}`);
      assert(cacheOnly === null, "cache-only value is gone after restart");
      const rows = await manager.run((api) => api.query("SELECT COUNT(*) FROM users"));
      assert(rows.rows[0][0] === 2, "table survives restart");
      return `states seen: ${[...new Set(states)].join(" -> ")}`;
    });
  }

  await step("delete projects (current one resets the session)", async () => {
    await manager.use(tokenB);
    await manager.deleteProject(tokenB);
    assert(manager.getStatus().project === null, "no project after deleting the current one");
    await manager.deleteProject(tokenA);
    const list = await manager.run((api) => api.projects());
    assert(!list.some((p) => p.token === tokenA || p.token === tokenB), "projects gone");
    return "ok";
  });

  await step("disconnect", async () => {
    await manager.disconnect();
    assert(manager.getStatus().state === "disconnected", "disconnected");
  });

  if (JAR) await stopServer();

  log("");
  const failed = results.filter((r) => !r.ok);
  log(`${results.length - failed.length}/${results.length} steps passed`);
  if (findings.length) {
    log("\nFindings:");
    for (const f of findings) log(`  - ${f}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  await stopServer();
  process.exitCode = 1;
});
