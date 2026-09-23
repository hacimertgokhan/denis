"use strict";

// Throughput of pipelined SET/GET against a running server (not part of the tests).
//   node bench.js            env: DENIS_HOST, DENIS_PORT, DENIS_GROUP, DENIS_PASSWORD, BENCH_OPS, BENCH_POOL
// Creates a scratch project and deletes it afterwards.

const { DenisClient } = require("./index.js");

const ops = Number(process.env.BENCH_OPS || 200000);
const options = {
  host: process.env.DENIS_HOST || "127.0.0.1",
  port: Number(process.env.DENIS_PORT || 5142),
  group: process.env.DENIS_GROUP || "ci",
  password: process.env.DENIS_PASSWORD || "ci-password",
  poolSize: Number(process.env.BENCH_POOL || 4),
  createProject: true,
};

async function measure(label, count, run) {
  const start = process.hrtime.bigint();
  await run();
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  console.log(`${label.padEnd(44)} ${String(Math.round(count / seconds)).padStart(9)} ops/s  (${count} ops, ${seconds.toFixed(2)} s)`);
}

/** `count` commands with at most `window` promises outstanding. */
async function windowed(count, window, issue) {
  let next = 0;
  async function worker() {
    while (next < count) await issue(next++);
  }
  await Promise.all(Array.from({ length: window }, worker));
}

async function main() {
  const client = new DenisClient(options);
  await client.connect();
  const value = "x".repeat(32);
  console.log(`denis-client bench: ${options.host}:${options.port}, pool ${options.poolSize}, ${ops} ops, 32-byte values`);
  try {
    await measure("sequential SET (await each)", 5000, () => windowed(5000, 1, (i) => client.set(`seq${i}`, value)));
    await measure("concurrent SET (auto-pipelined, 1000 in flight)", ops, () => windowed(ops, 1000, (i) => client.set(`k${i}`, value)));
    await measure("concurrent GET (auto-pipelined, 1000 in flight)", ops, () => windowed(ops, 1000, (i) => client.get(`k${i}`)));
    await measure("Promise.all SET (all at once)", ops, () => Promise.all(Array.from({ length: ops }, (_, i) => client.set(`a${i}`, value))));
    await measure("pipeline() SET, batches of 1000", ops, async () => {
      const batches = [];
      for (let b = 0; b < ops; b += 1000) {
        const p = client.pipeline();
        for (let i = b; i < Math.min(ops, b + 1000); i++) p.set(`p${i}`, value);
        batches.push(p.exec());
      }
      await Promise.all(batches);
    });
    await measure("pipeline() GET, batches of 1000", ops, async () => {
      const batches = [];
      for (let b = 0; b < ops; b += 1000) {
        const p = client.pipeline();
        for (let i = b; i < Math.min(ops, b + 1000); i++) p.get(`p${i}`);
        batches.push(p.exec());
      }
      await Promise.all(batches);
    });
  } finally {
    await client.deleteProject(client.token).catch(() => {});
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
