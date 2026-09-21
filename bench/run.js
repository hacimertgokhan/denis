#!/usr/bin/env node
/**
 * Denis benchmarks against Redis (key-value) and PostgreSQL (SQL subset).
 *
 * Every system runs in Docker with the same limits (see compose.bench.yaml);
 * the load generator is this Node process on the same host, so numbers are
 * comparable with each other, not absolute. Results are printed as Markdown
 * and written to results.json.
 *
 *   node run.js                 # everything
 *   node run.js kv sql          # only these suites (kv, sql, scale, durability, memory)
 *
 * Environment: DENIS_PORT (5150), REDIS_PORT (6390), PG_PORT (5440),
 * DENIS_CONTAINER / REDIS_CONTAINER (for the durability suite), OPS (20000).
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { DenisClient } from "denis-client";
import { createClient } from "redis";
import pg from "pg";

const DENIS_PORT = Number(process.env.DENIS_PORT || 5150);
const REDIS_PORT = Number(process.env.REDIS_PORT || 6390);
const PG_PORT = Number(process.env.PG_PORT || 5440);
const DENIS_CONTAINER = process.env.DENIS_CONTAINER || "bench-denis";
const REDIS_CONTAINER = process.env.REDIS_CONTAINER || "bench-redis";
const PG_CONTAINER = process.env.PG_CONTAINER || "bench-postgres";
const OPS = Number(process.env.OPS || 20_000);
const suites = process.argv.slice(2).length ? process.argv.slice(2) : ["kv", "sql", "scale", "durability", "memory"];

const results = [];

// ------------------------------------------------------------------ helpers

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** Run `ops` operations with `concurrency` workers; op(i) returns a promise. */
async function measure(name, system, ops, concurrency, op) {
  const latencies = new Float64Array(ops);
  let next = 0;
  const start = process.hrtime.bigint();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++;
        if (i >= ops) return;
        const t0 = process.hrtime.bigint();
        await op(i);
        latencies[i] = Number(process.hrtime.bigint() - t0) / 1e6;
      }
    }),
  );
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  const sorted = Array.from(latencies).sort((a, b) => a - b);
  const row = {
    name,
    system,
    concurrency,
    ops,
    opsPerSec: Math.round(ops / seconds),
    p50: +percentile(sorted, 0.5).toFixed(3),
    p95: +percentile(sorted, 0.95).toFixed(3),
    p99: +percentile(sorted, 0.99).toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
  };
  results.push(row);
  console.error(`${name.padEnd(28)} ${system.padEnd(10)} c=${String(concurrency).padEnd(3)} ${String(row.opsPerSec).padStart(7)} ops/s  p50 ${row.p50} ms  p99 ${row.p99} ms`);
  return row;
}

function docker(cmd) {
  return execSync(`docker ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function waitFor(check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function denisClient(poolSize, token) {
  const client = new DenisClient({ port: DENIS_PORT, group: "bench", password: "bench", token, createProject: !token, poolSize, commandTimeout: 120_000 });
  await client.connect();
  return client;
}

async function redisClient() {
  const client = createClient({ url: `redis://127.0.0.1:${REDIS_PORT}` });
  client.on("error", () => {}); // the durability suite kills the server on purpose
  await client.connect();
  return client;
}

function pgPool(max) {
  return new pg.Pool({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: "bench", database: "bench", max });
}

const value100 = "x".repeat(100);

// ------------------------------------------------------------------ suites

async function kvSuite() {
  console.error("\n== key-value: Denis vs Redis ==");
  const redis = await redisClient();
  await redis.flushAll();
  for (const concurrency of [1, 16, 64]) {
    const denis = await denisClient(concurrency);
    const key = (i) => `k:${concurrency}:${i}`;
    // warm-up (JIT, thread pool, connections) — not measured
    await Promise.all(Array.from({ length: 2_000 }, (_, i) => denis.set(`warm:${i}`, value100).then(() => denis.get(`warm:${i}`))));
    await Promise.all(Array.from({ length: 2_000 }, (_, i) => redis.set(`warm:${i}`, value100).then(() => redis.get(`warm:${i}`))));

    await measure("set (cache only)", "denis", OPS, concurrency, (i) => denis.set(key(i), value100));
    await measure("set (cache only)", "redis", OPS, concurrency, (i) => redis.set(key(i), value100));
    await measure("set persisted", "denis", OPS, concurrency, (i) => denis.set(`p:${key(i)}`, value100, { persist: true }));
    await measure("set persisted (aof everysec)", "redis", OPS, concurrency, (i) => redis.set(`p:${key(i)}`, value100));
    await measure("get hit", "denis", OPS, concurrency, (i) => denis.get(key(i)));
    await measure("get hit", "redis", OPS, concurrency, (i) => redis.get(key(i)));
    await measure("get miss", "denis", OPS, concurrency, (i) => denis.get(`missing:${i}`));
    await measure("get miss", "redis", OPS, concurrency, (i) => redis.get(`missing:${i}`));
    await measure("exists", "denis", OPS, concurrency, (i) => denis.exists(key(i)));
    await measure("exists", "redis", OPS, concurrency, (i) => redis.exists(key(i)));
    const ten = (i) => Array.from({ length: 10 }, (_, j) => key((i + j) % OPS));
    await measure("mget 10 keys", "denis", OPS / 10, concurrency, (i) => denis.mget(ten(i)));
    await measure("mget 10 keys", "redis", OPS / 10, concurrency, (i) => redis.mGet(ten(i)));
    await measure("delete", "denis", OPS, concurrency, (i) => denis.del(key(i)));
    await measure("delete", "redis", OPS, concurrency, (i) => redis.del(key(i)));
    await denis.close();
  }

  // value sizes at concurrency 16
  const denis = await denisClient(16);
  for (const [label, size] of [["1 KB", 1024], ["16 KB", 16 * 1024], ["64 KB", 64 * 1024]]) {
    const big = "y".repeat(size);
    const n = size >= 16 * 1024 ? 2_000 : OPS / 2;
    await measure(`set ${label} value`, "denis", n, 16, (i) => denis.set(`big:${size}:${i}`, big));
    await measure(`set ${label} value`, "redis", n, 16, (i) => redis.set(`big:${size}:${i}`, big));
    await measure(`get ${label} value`, "denis", n, 16, (i) => denis.get(`big:${size}:${i}`));
    await measure(`get ${label} value`, "redis", n, 16, (i) => redis.get(`big:${size}:${i}`));
  }
  // KEYS over ~60k keys in the store (both are O(n) scans)
  await measure("keys pattern (~60k keys)", "denis", 20, 1, () => denis.keys("k:16:1*"));
  await measure("keys pattern (~60k keys)", "redis", 20, 1, () => redis.keys("k:16:1*"));
  await denis.close();
  await redis.quit();
}

const CATEGORIES = ["books", "toys", "food", "tools", "games"];
const productRow = (i) => ({ id: i, name: `product_${i}`, price: +((i * 7919) % 10000 / 100).toFixed(2), category: CATEGORIES[i % CATEGORIES.length] });

async function sqlSuite() {
  console.error("\n== SQL: Denis vs PostgreSQL ==");
  const pool = pgPool(16);
  await pool.query("DROP TABLE IF EXISTS products");
  await pool.query("CREATE TABLE products (id INT PRIMARY KEY, name TEXT, price REAL, category TEXT)");

  for (const concurrency of [1, 16]) {
    const denis = await denisClient(concurrency);
    const table = `products_c${concurrency}`;
    await denis.execute(`CREATE TABLE ${table} (id INT, name TEXT, price REAL, category TEXT)`);
    await pool.query(`DELETE FROM products`);
    const n = 5_000;
    const insert = (i) => {
      const r = productRow(i);
      return `INSERT INTO ${table} (id, name, price, category) VALUES (${r.id}, '${r.name}', ${r.price}, '${r.category}')`;
    };
    await measure("insert 1 row", "denis", n, concurrency, (i) => denis.execute(insert(i)));
    await measure("insert 1 row", "postgres", n, concurrency, (i) => {
      const r = productRow(i);
      return pool.query("INSERT INTO products (id, name, price, category) VALUES ($1, $2, $3, $4)", [r.id, r.name, r.price, r.category]);
    });
    // grow both tables to 10k rows with batch inserts
    const batch = (system, from) => {
      const rows = Array.from({ length: 500 }, (_, j) => productRow(from + j));
      const values = rows.map((r) => `(${r.id}, '${r.name}', ${r.price}, '${r.category}')`).join(", ");
      return system === "denis"
        ? denis.execute(`INSERT INTO ${table} (id, name, price, category) VALUES ${values}`)
        : pool.query(`INSERT INTO products (id, name, price, category) VALUES ${values}`);
    };
    await measure("insert 500-row batch", "denis", 10, 1, (i) => batch("denis", n + i * 500));
    await measure("insert 500-row batch", "postgres", 10, 1, (i) => batch("postgres", n + i * 500));

    const q = 2_000;
    await measure("select by id (10k rows)", "denis", q, concurrency, (i) => denis.query(`SELECT * FROM ${table} WHERE id = ${i * 5}`));
    await measure("select by id (10k rows, pk)", "postgres", q, concurrency, (i) => pool.query("SELECT * FROM products WHERE id = $1", [i * 5]));
    await measure("select range+order+limit 20", "denis", 500, concurrency, () => denis.query(`SELECT id, name, price FROM ${table} WHERE price > 50 AND category = 'toys' ORDER BY price DESC LIMIT 20`));
    await measure("select range+order+limit 20", "postgres", 500, concurrency, () => pool.query("SELECT id, name, price FROM products WHERE price > 50 AND category = 'toys' ORDER BY price DESC LIMIT 20"));
    await measure("count(*)", "denis", 200, concurrency, () => denis.query(`SELECT COUNT(*) FROM ${table}`));
    await measure("count(*)", "postgres", 200, concurrency, () => pool.query("SELECT COUNT(*) FROM products"));
    await measure("update by id", "denis", 1_000, concurrency, (i) => denis.execute(`UPDATE ${table} SET price = 1.5 WHERE id = ${i}`));
    await measure("update by id", "postgres", 1_000, concurrency, (i) => pool.query("UPDATE products SET price = 1.5 WHERE id = $1", [i]));
    await measure("delete by id", "denis", 1_000, concurrency, (i) => denis.execute(`DELETE FROM ${table} WHERE id = ${i}`));
    await measure("delete by id", "postgres", 1_000, concurrency, (i) => pool.query("DELETE FROM products WHERE id = $1", [i]));
    await denis.execute(`DROP TABLE ${table}`);
    await denis.close();
  }
  await pool.end();
}

async function scaleSuite() {
  console.error("\n== SQL scaling: Denis point query vs table size ==");
  const denis = await denisClient(1);
  const pool = pgPool(1);
  await pool.query("DROP TABLE IF EXISTS scale");
  await pool.query("CREATE TABLE scale (id INT PRIMARY KEY, name TEXT, price REAL, category TEXT)");
  await denis.execute("CREATE TABLE scale (id INT, name TEXT, price REAL, category TEXT)");
  let rows = 0;
  for (const target of [1_000, 10_000, 50_000]) {
    while (rows < target) {
      const batch = Array.from({ length: 500 }, (_, j) => productRow(rows + j));
      const values = batch.map((r) => `(${r.id}, '${r.name}', ${r.price}, '${r.category}')`).join(", ");
      await denis.execute(`INSERT INTO scale (id, name, price, category) VALUES ${values}`);
      await pool.query(`INSERT INTO scale (id, name, price, category) VALUES ${values}`);
      rows += 500;
    }
    const q = target >= 50_000 ? 100 : 500;
    await measure(`select by id @ ${target} rows`, "denis", q, 1, (i) => denis.query(`SELECT name FROM scale WHERE id = ${(i * 97) % target}`));
    await measure(`select by id @ ${target} rows`, "postgres", q, 1, (i) => pool.query("SELECT name FROM scale WHERE id = $1", [(i * 97) % target]));
    await measure(`count(*) @ ${target} rows`, "denis", 20, 1, () => denis.query("SELECT COUNT(*) FROM scale"));
    await measure(`count(*) @ ${target} rows`, "postgres", 20, 1, () => pool.query("SELECT COUNT(*) FROM scale"));
  }
  await denis.execute("DROP TABLE scale");
  await pool.query("DROP TABLE scale");
  await denis.close();
  await pool.end();
}

async function durabilitySuite() {
  console.error("\n== durability: restart and SIGKILL ==");
  const n = 5_000;
  // clean restart: everything persisted must survive
  let denis = await denisClient(16);
  const token = denis.token;
  await Promise.all(Array.from({ length: n }, (_, i) => denis.set(`dur:${i}`, String(i), { persist: true })));
  await denis.save();
  await denis.close();
  docker(`restart ${DENIS_CONTAINER}`);
  await waitFor(async () => (await denisClient(1, token)).ping());
  denis = await denisClient(16, token);
  let present = 0;
  for (let i = 0; i < n; i += 100) {
    const values = await denis.mget(Array.from({ length: 100 }, (_, j) => `dur:${i + j}`));
    present += Object.values(values).filter((v) => v !== null).length;
  }
  results.push({ name: "graceful restart", system: "denis", concurrency: 16, ops: n, survived: present, lost: n - present });
  console.error(`graceful restart: ${present}/${n} persisted keys survived`);
  // SIGKILL while writing: only the last flush window (1 s) may be lost
  const acked = [];
  let stop = false;
  const writer = (async () => {
    for (let i = 0; !stop; i++) {
      await denis.set(`crash:${i}`, String(i), { persist: true });
      acked.push(i);
    }
  })();
  await new Promise((r) => setTimeout(r, 3_000));
  const killedAt = Date.now();
  docker(`kill -s KILL ${DENIS_CONTAINER}`);
  stop = true;
  await writer.catch(() => {});
  docker(`start ${DENIS_CONTAINER}`);
  await waitFor(async () => (await denisClient(1, token)).ping());
  denis = await denisClient(16, token);
  const survivedKeys = await denis.keys("crash:*");
  const lost = acked.length - survivedKeys.length;
  results.push({ name: "SIGKILL while writing", system: "denis", concurrency: 1, ops: acked.length, survived: survivedKeys.length, lost });
  console.error(`SIGKILL: ${survivedKeys.length}/${acked.length} acknowledged persisted writes survived (${lost} lost, flush interval 1 s)`);
  await denis.close();

  // Redis with appendonly everysec for comparison
  let redis = await redisClient();
  await redis.flushAll();
  const ackedRedis = [];
  stop = false;
  const redisWriter = (async () => {
    for (let i = 0; !stop; i++) {
      await redis.set(`crash:${i}`, String(i));
      ackedRedis.push(i);
    }
  })();
  await new Promise((r) => setTimeout(r, 3_000));
  docker(`kill -s KILL ${REDIS_CONTAINER}`);
  stop = true;
  await redisWriter.catch(() => {});
  docker(`start ${REDIS_CONTAINER}`);
  await waitFor(async () => { const c = await redisClient(); const ok = (await c.ping()) === "PONG"; await c.quit(); return ok; });
  redis = await redisClient();
  const redisSurvived = (await redis.keys("crash:*")).length;
  results.push({ name: "SIGKILL while writing (aof everysec)", system: "redis", concurrency: 1, ops: ackedRedis.length, survived: redisSurvived, lost: ackedRedis.length - redisSurvived });
  console.error(`SIGKILL redis: ${redisSurvived}/${ackedRedis.length} survived`);
  await redis.quit();
  void killedAt;
}

async function memorySuite() {
  console.error("\n== memory: 100k keys x 100 bytes ==");
  const denis = await denisClient(32);
  const redis = await redisClient();
  const n = 100_000;
  await measure("load 100k keys (100 B)", "denis", n, 32, (i) => denis.set(`mem:${i}`, value100, { persist: true }));
  await measure("load 100k keys (100 B)", "redis", n, 32, (i) => redis.set(`mem:${i}`, value100));
  await denis.save();
  await new Promise((r) => setTimeout(r, 2_000));
  const stats = docker(`stats --no-stream --format "{{.Name}} {{.MemUsage}}" ${DENIS_CONTAINER} ${REDIS_CONTAINER} ${PG_CONTAINER}`).trim();
  for (const line of stats.split("\n")) {
    const [name, usage] = line.split(" ");
    results.push({ name: "container memory after load", system: name.replace("bench-", ""), memory: usage });
  }
  const dbFile = docker(`exec ${DENIS_CONTAINER} stat -c %s /data/database.bin`).trim();
  results.push({ name: "database.bin size after load", system: "denis", bytes: Number(dbFile) });
  console.error(stats, `\ndatabase.bin: ${dbFile} bytes`);
  await denis.close();
  await redis.quit();
}

// -------------------------------------------------------------------- main

function markdown() {
  const lines = [];
  const perf = results.filter((r) => r.opsPerSec !== undefined);
  lines.push("| Workload | System | Conc. | Ops | ops/s | p50 ms | p95 ms | p99 ms | max ms |", "| --- | --- | --: | --: | --: | --: | --: | --: | --: |");
  for (const r of perf) lines.push(`| ${r.name} | ${r.system} | ${r.concurrency} | ${r.ops} | ${r.opsPerSec} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} |`);
  const other = results.filter((r) => r.opsPerSec === undefined);
  if (other.length) {
    lines.push("", "| Check | System | Result |", "| --- | --- | --- |");
    for (const r of other) {
      const detail = r.survived !== undefined ? `${r.survived}/${r.ops} survived, ${r.lost} lost` : r.memory ?? `${r.bytes} bytes`;
      lines.push(`| ${r.name} | ${r.system} | ${detail} |`);
    }
  }
  return lines.join("\n");
}

const started = Date.now();
const save = () => writeFileSync("results.json", JSON.stringify({ date: new Date().toISOString(), suites, results }, null, 2));
for (const suite of suites) {
  await { kv: kvSuite, sql: sqlSuite, scale: scaleSuite, durability: durabilitySuite, memory: memorySuite }[suite]();
  save(); // partial results survive a crash in a later suite
}
const versions = {
  denis: docker(`exec ${DENIS_CONTAINER} /app/entrypoint.sh --version`).trim(),
  redis: docker(`exec ${REDIS_CONTAINER} redis-server --version`).trim().split(" ").slice(0, 3).join(" "),
  postgres: docker(`exec ${PG_CONTAINER} postgres --version`).trim(),
  node: process.version,
};
writeFileSync("results.json", JSON.stringify({ date: new Date().toISOString(), durationSeconds: Math.round((Date.now() - started) / 1000), versions, results }, null, 2));
console.log(markdown());
console.error(`\ndone in ${Math.round((Date.now() - started) / 1000)} s; results.json written`);
process.exit(0);
