"use strict";

// Unit tests against an in-process fake Denis server (no real server needed):
//   node --test test/unit.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { DenisClient, DenisConnection, DenisError, DenisPipeline } = require("../index.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, ms = 2000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await sleep(5);
  }
}

/**
 * A fake server speaking enough of the JSON-mode protocol: MODE, LIN, AUTH
 * (CREATE/DELETE), PING, GET/SET/UPDATE/DEL/INCR, IMPORT, WHOAMI, plus test
 * commands: ECHO <text>, SPLIT <text> (reply written byte by byte), DELAY <ms> <text>,
 * SLOW (never answers), KILL (drops the socket), FAIL <code>.
 * Lines of one connection are handled strictly one after another, like Denis.
 */
async function fakeServer(options = {}) {
  const users = options.users || { ci: "pass word" };
  const state = {
    projects: new Map([["tok0", new Map()], ["tok1", new Map()]]),
    created: 0,
    conns: [],
    imports: [],
    refuse: options.refuse || false,
  };

  function handle(conn, line) {
    const space = line.indexOf(" ");
    const cmd = (space < 0 ? line : line.slice(0, space)).toUpperCase();
    const args = space < 0 ? "" : line.slice(space + 1);
    const words = args.split(" ");
    switch (cmd) {
      case "MODE":
        return { ok: true, message: "mode json" };
      case "PING":
        return { ok: true, message: "PONG" };
      case "EXIT":
        return () => conn.socket.end(JSON.stringify({ ok: true, message: "Bye." }) + "\n");
      case "ECHO":
        return { ok: true, data: args };
      case "SPLIT":
        return async () => {
          const bytes = Buffer.from(JSON.stringify({ ok: true, data: args }) + "\n");
          for (const byte of bytes) {
            conn.socket.write(Buffer.from([byte]));
            await sleep(1);
          }
        };
      case "DELAY":
        return sleep(Number(words[0])).then(() => ({ ok: true, data: words.slice(1).join(" ") }));
      case "SLOW":
        return new Promise(() => {});
      case "KILL":
        return () => conn.socket.destroy();
      case "FAIL":
        return { ok: false, error: `failed with ${words[0]}`, code: words[0] };
      case "LIN": {
        const group = words[0];
        const password = args.slice(group.length + 1);
        if (users[group] !== undefined && users[group] === password) {
          conn.loggedIn = true;
          return { ok: true, message: `Logged in to group: ${group}`, group, admin: true };
        }
        return { ok: false, error: "Login failed: unknown group or wrong password", code: "AUTH" };
      }
      default:
        break;
    }
    if (!conn.loggedIn) return { ok: false, error: "Please login first using LIN command", code: "NOAUTH" };
    if (cmd === "AUTH") {
      if (words[0] === "CREATE") {
        const token = `new${++state.created}`;
        state.projects.set(token, new Map());
        return { ok: true, message: "Project created", token };
      }
      if (words[0] === "DELETE") {
        state.projects.delete(words[1]);
        if (conn.token === words[1]) conn.token = null;
        return { ok: true, message: "Project deleted" };
      }
      if (!state.projects.has(words[0])) return { ok: false, error: `Cannot auth with: ${words[0]}`, code: "AUTH" };
      conn.token = words[0];
      return { ok: true, message: `Authenticated to project: ${words[0]}` };
    }
    if (cmd === "WHOAMI") return { ok: true, group: "ci", admin: true, project: conn.token };
    const store = state.projects.get(conn.token);
    if (!store) return { ok: false, error: "Please authenticate first using AUTH command", code: "NOPROJECT" };
    const key = words[0];
    switch (cmd) {
      case "SET":
      case "UPDATE": {
        const rest = args.slice(key.length + 1);
        const value = rest.split(" ").filter((w) => !w.startsWith("-&")).join(" ");
        store.set(key, value);
        return { ok: true, message: "Ok (Cache)" };
      }
      case "GET":
        if (key === "__oom") return { ok: false, error: "out of memory", code: "OOM" };
        return store.has(key) ? { ok: true, key, data: store.get(key) } : { ok: false, key, error: "not found", code: "NOTFOUND" };
      case "DEL": {
        const existed = store.delete(key);
        return { ok: true, message: "Ok (Cache,Protobuf).", deleted: existed };
      }
      case "INCR": {
        const value = Number(store.get(key) || 0) + (words[1] && !words[1].startsWith("-&") ? Number(words[1]) : 1);
        store.set(key, String(value));
        return { ok: true, key, data: String(value), value };
      }
      case "IMPORT": {
        const data = JSON.parse(args);
        state.imports.push({ line, data });
        const tables = Object.values(data.tables || {});
        return {
          ok: true,
          message: "Imported",
          imported: {
            persistent: Object.keys(data.persistent || {}).length,
            cache: Object.keys(data.cache || {}).length,
            tables: tables.length,
            rows: tables.reduce((n, t) => n + (t.rows || []).length, 0),
          },
        };
      }
      default:
        return { ok: false, error: `Unknown command: ${cmd}`, code: "UNKNOWN" };
    }
  }

  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setNoDelay(true);
    if (state.refuse) {
      socket.end(JSON.stringify({ ok: false, error: "max number of clients reached", code: "LIMIT" }) + "\n");
      return;
    }
    const conn = { socket, lines: [], loggedIn: false, token: null, outstanding: 0, maxOutstanding: 0 };
    state.conns.push(conn);
    let buffer = Buffer.alloc(0);
    let chain = Promise.resolve();
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let index;
      while ((index = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, index).toString("utf8").replace(/\r$/, "").trim();
        buffer = buffer.subarray(index + 1);
        if (!line) continue;
        conn.lines.push(line);
        conn.outstanding++;
        conn.maxOutstanding = Math.max(conn.maxOutstanding, conn.outstanding);
        chain = chain
          .then(() => handle(conn, line))
          .then(async (reply) => {
            conn.outstanding--;
            if (socket.destroyed) return;
            if (typeof reply === "function") await reply();
            else socket.write(JSON.stringify(reply) + "\n");
          });
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.port = server.address().port;
  state.server = server;
  /** Drop every client connection (the server keeps listening). */
  state.kill = () => {
    for (const socket of sockets) socket.destroy();
  };
  /** Stop listening and drop every connection. */
  state.close = () =>
    new Promise((resolve) => {
      state.kill();
      server.close(() => resolve());
    });
  return state;
}

function clientFor(fake, options = {}) {
  return new DenisClient({
    port: fake.port,
    group: "ci",
    password: "pass word",
    token: "tok0",
    reconnect: { retries: 5, minDelay: 10, maxDelay: 50 },
    ...options,
  });
}

function countWrites(client) {
  const counts = [];
  client._slots.forEach((slot, i) => {
    counts[i] = 0;
    const socket = slot.conn.socket;
    const write = socket.write.bind(socket);
    socket.write = (...args) => {
      counts[i]++;
      return write(...args);
    };
  });
  return counts;
}

/** A DenisConnection wired to a dummy socket, to feed reply bytes by hand. */
function detachedConnection() {
  const conn = new DenisConnection({ commandTimeout: 0 });
  conn.written = "";
  conn.socket = { write: (s) => (conn.written += s), destroy: () => {} };
  return conn;
}

// ======================================================================= framing

test("framing: replies split at every byte, including inside multi-byte UTF-8 characters", async () => {
  const conn = detachedConnection();
  const text = "çğüşöı ✓ 😀 日本語 \"quoted\"";
  const first = conn.raw(`ECHO ${text}`);
  const second = conn.raw("PING");
  const bytes = Buffer.from(`${JSON.stringify({ ok: true, data: text })}\r\n{"ok":true,"message":"PONG"}\n`);
  for (let i = 0; i < bytes.length; i++) conn._onData(bytes.subarray(i, i + 1));
  assert.equal((await first).data, text);
  assert.equal((await second).message, "PONG");
});

test("framing: many replies in one chunk and a reply spread over uneven chunks", async () => {
  const conn = detachedConnection();
  const replies = Array.from({ length: 50 }, (_, i) => conn.raw(`ECHO ${i}`));
  const payload = Buffer.from(replies.map((_, i) => JSON.stringify({ ok: true, data: `é${i}€` })).join("\n") + "\n");
  // cut in odd places: 1 byte, then 7, 13, ...
  let offset = 0;
  let size = 1;
  while (offset < payload.length) {
    conn._onData(payload.subarray(offset, offset + size));
    offset += size;
    size = (size * 7 + 6) % 23 + 1;
  }
  const values = (await Promise.all(replies)).map((r) => r.data);
  assert.deepEqual(values, replies.map((_, i) => `é${i}€`));
});

test("framing: text-mode lines are turned into reply objects", async () => {
  const conn = detachedConnection();
  const ok = conn.raw("PING");
  const bad = conn.raw("X");
  conn._onData(Buffer.from("PONG\n[Error - today]: nope\n"));
  assert.deepEqual(await ok, { ok: true, raw: "PONG", message: "PONG" });
  assert.equal((await bad).ok, false);
});

test("framing: a real socket receiving a reply byte by byte", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  const text = "a ç ✓ 😀 z";
  const reply = await client.command(`SPLIT ${text}`);
  assert.equal(reply.data, text);
});

// ======================================================================= handshake

test("handshake: MODE json, LIN (password with spaces) and AUTH are pipelined", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 2 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  assert.equal(fake.conns.length, 2);
  for (const conn of fake.conns) {
    assert.deepEqual(conn.lines.slice(0, 3), ["MODE json", "LIN ci pass word", "AUTH tok0"]);
    // all three were in flight together
    assert.equal(conn.maxOutstanding >= 2, true);
  }
  assert.equal(client.token, "tok0");
});

test("handshake: createProject creates exactly one project for the whole pool", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 3, token: undefined, createProject: true });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  assert.equal(fake.created, 1);
  assert.equal(client.token, "new1");
  assert.equal(fake.conns.length, 3);
  for (const conn of fake.conns) assert.equal(conn.token, "new1");
});

test("handshake: a wrong password rejects with the server code AUTH", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { password: "wrong" });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await assert.rejects(client.ping(), (err) => err instanceof DenisError && err.code === "AUTH" && err.reply.ok === false);
  await assert.rejects(client.connect(), (err) => err.code === "AUTH");
});

test("handshake: a LIMIT refusal surfaces as code LIMIT", async (t) => {
  const fake = await fakeServer({ refuse: true });
  const client = clientFor(fake, { reconnect: false });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await assert.rejects(client.connect(), (err) => err.code === "LIMIT");
});

test("connect: an unreachable server rejects with ECONN", async () => {
  const fake = await fakeServer();
  const port = fake.port;
  await fake.close();
  const client = new DenisClient({ port, connectTimeout: 1000 });
  await assert.rejects(client.ping(), (err) => err.code === "ECONN");
  await client.close();
});

// ======================================================================= pipelining

test("pipelining: concurrent commands are multiplexed and matched to their replies", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 2 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  const n = 2000;
  await Promise.all(Array.from({ length: n }, (_, i) => client.set(`k${i}`, `value ${i} ✓`)));
  const values = await Promise.all(Array.from({ length: n }, (_, i) => client.get(`k${i}`)));
  assert.deepEqual(values, Array.from({ length: n }, (_, i) => `value ${i} ✓`));
  // both connections were used, each with many commands in flight at once
  assert.equal(fake.conns.every((c) => c.lines.length > 100), true);
  assert.equal(fake.conns.some((c) => c.maxOutstanding > 50), true);
});

test("pipelining: replies stay in order even when the server answers slowly", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  const replies = await Promise.all([
    client.command("DELAY 40 first"),
    client.command("ECHO second"),
    client.command("DELAY 5 third"),
    client.command("ECHO fourth"),
  ]);
  assert.deepEqual(replies.map((r) => r.data), ["first", "second", "third", "fourth"]);
});

test("pipelining: commands issued in the same tick go out in one socket write", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  const writes = countWrites(client);
  await Promise.all(Array.from({ length: 200 }, () => client.ping()));
  assert.equal(writes[0], 1);
});

test("pipeline(): one write on one connection, per-command results and errors", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 3 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  const writes = countWrites(client);
  const pipeline = client.pipeline().set("a", "1").get("a").get("missing").get("__oom").incr("n").incr("n", 4).set("bad key", "x");
  assert.ok(pipeline instanceof DenisPipeline);
  assert.equal(pipeline.length, 7);
  const results = await pipeline.exec();
  assert.equal(results.length, 7);
  assert.deepEqual(results.slice(0, 3), [true, "1", null]);
  assert.ok(results[3] instanceof DenisError);
  assert.equal(results[3].code, "OOM");
  assert.equal(results[3].reply.code, "OOM");
  assert.deepEqual(results.slice(4, 6), [1, 5]);
  assert.ok(results[6] instanceof DenisError);
  assert.equal(results[6].code, "EINVAL");
  assert.equal(writes.reduce((a, b) => a + b, 0), 1, "the whole pipeline is one write");
  assert.equal(fake.conns.filter((c) => c.lines.includes("GET a")).length, 1, "one connection");
  assert.deepEqual(await client.pipeline().exec(), []);
});

test("back-pressure: at most maxPending commands in flight per connection", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1, maxPending: 3 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  const replies = await Promise.all(Array.from({ length: 20 }, (_, i) => client.command(`DELAY 2 r${i}`)));
  assert.deepEqual(replies.map((r) => r.data), Array.from({ length: 20 }, (_, i) => `r${i}`));
  const conn = fake.conns[0];
  assert.equal(conn.maxOutstanding, 3);
});

// ======================================================================= timeouts / reconnect

test("timeout: ETIMEOUT for the slow command, ECLOSED for the rest, then a fresh connection", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1, commandTimeout: 150 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  const slow = client.command("SLOW");
  const behind = client.ping();
  await assert.rejects(slow, (err) => err.code === "ETIMEOUT" && /SLOW/.test(err.message));
  await assert.rejects(behind, (err) => err.code === "ECLOSED");
  assert.equal(await client.ping(), true);
  assert.equal(fake.conns.length, 2);
  assert.deepEqual(fake.conns[1].lines.slice(0, 3), ["MODE json", "LIN ci pass word", "AUTH tok0"]);
});

test("timeout: a command waiting for a connection times out too", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1, maxPending: 1, commandTimeout: 100 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  const busy = client.command("DELAY 300 x", { timeout: 1000 });
  await assert.rejects(client.ping(), (err) => err.code === "ETIMEOUT" && /no connection available/.test(err.message));
  assert.equal((await busy).data, "x");
});

test("reconnect: in-flight commands reject with ECLOSED, the connection is re-handshaken, waiting commands run", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  const events = [];
  client.on("reconnect", (info) => events.push(info));
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.set("a", "1");
  await client.use("tok1");
  await client.set("a", "on tok1");
  const inFlight = client.command("DELAY 200 never");
  await sleep(20);
  fake.kill();
  await assert.rejects(inFlight, (err) => err.code === "ECLOSED");
  // not replayed: the new connection never saw the DELAY
  const value = await client.get("a");
  assert.equal(value, "on tok1");
  assert.equal(events.length >= 1, true);
  assert.equal(events[0].attempt, 1);
  assert.equal(typeof events[0].delay, "number");
  const second = fake.conns[1];
  assert.deepEqual(second.lines.slice(0, 3), ["MODE json", "LIN ci pass word", "AUTH tok1"]);
  assert.equal(second.lines.some((l) => l.startsWith("DELAY")), false);
});

test("reconnect: a command dropped by the server (KILL) is not retried", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await assert.rejects(client.command("KILL"), (err) => err.code === "ECLOSED");
  assert.equal(await client.ping(), true);
  assert.equal(fake.conns.flatMap((c) => c.lines).filter((l) => l === "KILL").length, 1);
});

test("reconnect: after a raw EXIT the connection takes no new commands and is replaced", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  const events = [];
  client.on("reconnect", (info) => events.push(info));
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  const bye = client.command("EXIT");
  const next = client.ping(); // issued before the server closed: must not land on the closing connection
  assert.equal((await bye).message, "Bye.");
  assert.equal(await next, true);
  assert.equal(fake.conns.length, 2);
  assert.equal(events.length, 0, "a planned close is not a reconnect");
});

test("reconnect: gives up after `retries`, emits error and rejects waiting commands", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1, reconnect: { retries: 2, minDelay: 10, maxDelay: 20 } });
  const errors = [];
  const attempts = [];
  client.on("error", (err) => errors.push(err));
  client.on("reconnect", (info) => attempts.push(info.attempt));
  t.after(() => client.close());
  await client.connect();
  await fake.close();
  await waitFor(() => client._slots[0].state === "reconnecting");
  const waiting = client.ping();
  await assert.rejects(waiting, (err) => err.code === "ECONN" && /gave up reconnecting/.test(err.message));
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "ECONN");
});

test("reconnect: false reconnects only on demand", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1, reconnect: false });
  const events = [];
  client.on("reconnect", (info) => events.push(info));
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  fake.kill();
  await waitFor(() => client._slots[0].state === "idle");
  assert.equal(fake.conns.length, 1);
  assert.equal(await client.ping(), true);
  assert.equal(fake.conns.length, 2);
  assert.equal(events.length, 0);
});

// ======================================================================= projects

test("use(): AUTH on every pooled connection; a refused token keeps the old one", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 3 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  assert.equal(await client.use("tok1"), true);
  assert.equal(client.token, "tok1");
  assert.deepEqual(fake.conns.map((c) => c.token), ["tok1", "tok1", "tok1"]);
  await assert.rejects(client.use("missing"), (err) => err.code === "AUTH");
  assert.equal(client.token, "tok1");
  assert.deepEqual(fake.conns.map((c) => c.token), ["tok1", "tok1", "tok1"]);
  await assert.rejects(client.use("has space"), (err) => err.code === "EINVAL");
});

test("deleteProject(current token): the pool is recycled onto no project", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 2, token: "tok1" });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.connect();
  assert.equal(await client.deleteProject("tok1"), true);
  assert.equal(client.token, undefined);
  const who = await client.whoami();
  assert.equal(who.project, null);
  await assert.rejects(client.get("a"), (err) => err.code === "NOPROJECT");
  await waitFor(() => fake.conns.length === 4);
  for (const conn of fake.conns.slice(2)) assert.deepEqual(conn.lines.slice(0, 2), ["MODE json", "LIN ci pass word"]);
  assert.equal(fake.conns.slice(2).some((c) => c.lines.some((l) => l.startsWith("AUTH tok"))), false);
});

// ======================================================================= commands

test("set(): empty values and trailing whitespace survive the server's line trim", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await client.set("e", "");
  await client.set("w", "a  ");
  await client.set("p", "v", { persist: true, ttl: 5 });
  await client.set("o", { a: [1, "x y"] });
  await client.update("u", "b ");
  await client.update("v", "plain");
  const lines = fake.conns[0].lines;
  assert.deepEqual(lines.slice(3), [
    "SET e  -&cache",
    "SET w a   -&cache",
    "SET p v -&save -&ttl=5",
    'SET o {"a":[1,"x y"]}',
    "SET u b  -&cache",
    "UPDATE v plain",
  ]);
  assert.equal(await client.get("e"), "");
  assert.deepEqual(await client.getJSON("o"), { a: [1, "x y"] });
});

test("errors: invalid input is rejected locally with EINVAL", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  const invalid = (err) => err instanceof DenisError && err.code === "EINVAL";
  await assert.rejects(client.get("has space"), invalid);
  await assert.rejects(client.get(""), invalid);
  await assert.rejects(client.set("k", "line\nbreak"), invalid);
  await assert.rejects(client.set("k", "a -&save"), invalid);
  await assert.rejects(client.set("k", "v", { ttl: 0 }), invalid);
  await assert.rejects(client.incr("k", 1.5), invalid);
  await assert.rejects(client.expire("k", -1), invalid);
  await assert.rejects(client.keys("a b"), invalid);
  await assert.rejects(client.keys("*", { layer: "disk" }), invalid);
  await assert.rejects(client.mget("k"), invalid);
  await assert.rejects(client.command("PING\nPING"), invalid);
  await assert.rejects(client.command("   "), invalid);
  await assert.rejects(client.sql("SELECT 1\nFROM t"), invalid);
  await assert.rejects(client.query("SELECT ?", "nope"), invalid);
  await assert.rejects(client.import("{not json"), invalid);
  // nothing reached the server
  assert.equal(fake.conns.length, 0);
  assert.deepEqual(await client.mget([]), {});
  assert.throws(() => new DenisClient({ poolSize: 0 }), invalid);
});

test("errors: server codes become DenisError.code, command() never throws on ok:false", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  await assert.rejects(client.get("__oom"), (err) => err.code === "OOM" && err.reply.error === "out of memory");
  const reply = await client.command("FAIL BUSY");
  assert.deepEqual(reply, { ok: false, error: "failed with BUSY", code: "BUSY" });
  await assert.rejects(client.exists("k"), (err) => err.code === "UNKNOWN");
  assert.equal(await client.get("missing"), null);
  assert.equal(await client.del("missing"), false);
});

test("import(): large dumps are split into chunks, one table per line, results summed", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1, importChunkBytes: 400 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  const dump = {
    ok: true,
    format: 1,
    persistent: {},
    cache: {},
    ttl: {},
    tables: {
      users: { columns: [{ name: "id", type: "INTEGER" }], indexes: [], rows: [[1], [2], [3]] },
      orders: { columns: [{ name: "id", type: "INTEGER" }], indexes: [], rows: [[1]] },
    },
  };
  for (let i = 0; i < 60; i++) dump.persistent[`p${i}`] = `persistent value ${i} ✓`;
  for (let i = 0; i < 40; i++) {
    dump.cache[`c${i}`] = `cache value ${i}`;
    if (i % 3 === 0) dump.ttl[`c${i}`] = 1000 + i;
  }
  const result = await client.import(dump, { replace: true });
  assert.deepEqual(result, { persistent: 60, cache: 40, tables: 2, rows: 4 });
  const imports = fake.imports;
  assert.equal(imports.length > 4, true, `split into ${imports.length} lines`);
  const keyLines = imports.filter((i) => !i.data.tables);
  for (const { line } of keyLines) assert.equal(Buffer.byteLength(line) <= 400 + 16, true, `line of ${Buffer.byteLength(line)} bytes`);
  const tableLines = imports.filter((i) => i.data.tables);
  assert.equal(tableLines.length, 2);
  for (const { data } of tableLines) {
    assert.equal(Object.keys(data.tables).length, 1);
    assert.equal(data.replace, true);
    assert.equal(data.ok, undefined);
  }
  // every key arrived exactly once, and each TTL travelled with its cache key
  const persistent = Object.assign({}, ...imports.map((i) => i.data.persistent || {}));
  const cache = Object.assign({}, ...imports.map((i) => i.data.cache || {}));
  assert.deepEqual(persistent, dump.persistent);
  assert.deepEqual(cache, dump.cache);
  for (const { data } of imports) {
    for (const key of Object.keys(data.ttl || {})) assert.ok(data.cache && key in data.cache);
  }
  assert.equal(imports.reduce((n, i) => n + Object.keys(i.data.ttl || {}).length, 0), Object.keys(dump.ttl).length);
});

test("import(): a table larger than a line is created once and its rows appended", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1, importChunkBytes: 400 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push([i, `name number ${i}`]);
  const dump = {
    tables: {
      big: { columns: [{ name: "id", type: "INTEGER" }, { name: "n", type: "TEXT" }], indexes: [{ name: "i", column: "n" }], rows },
    },
  };
  await client.import(dump, { replace: true });
  const lines = fake.imports.map((i) => i.data);
  assert.equal(lines.length > 2, true, `split into ${lines.length} lines`);
  assert.equal(lines[0].replace, true);
  assert.equal(lines[0].append, undefined);
  assert.deepEqual(lines[0].tables.big.indexes, dump.tables.big.indexes);
  for (const line of lines.slice(1)) {
    assert.equal(line.append, true);
    assert.equal(line.replace, false, "later parts must not drop the table again");
    assert.equal(line.tables.big.indexes, undefined);
  }
  assert.deepEqual(lines.flatMap((l) => l.tables.big.rows), rows);
});

test("import(): a small dump is one IMPORT line; JSON text is accepted", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 1 });
  t.after(async () => {
    await client.close();
    await fake.close();
  });
  const result = await client.import(JSON.stringify({ persistent: { a: "1" }, cache: { b: "2" } }));
  assert.deepEqual(result, { persistent: 1, cache: 1, tables: 0, rows: 0 });
  assert.equal(fake.imports.length, 1);
  assert.equal(fake.imports[0].data.replace, false);
});

// ======================================================================= close

test("close(): in-flight commands finish, new ones reject with ECLOSED, 'close' is emitted", async (t) => {
  const fake = await fakeServer();
  const client = clientFor(fake, { poolSize: 2 });
  t.after(() => fake.close());
  let closed = false;
  client.on("close", () => (closed = true));
  await client.connect();
  const slow = client.command("DELAY 80 done");
  await sleep(10);
  const closing = client.close();
  await assert.rejects(client.ping(), (err) => err.code === "ECLOSED");
  assert.equal((await slow).data, "done");
  await closing;
  assert.equal(closed, true);
  assert.equal(fake.conns.every((c) => c.lines[c.lines.length - 1] === "EXIT"), true);
  assert.equal(client.close(), closing, "close() is idempotent");
});

test("DenisConnection can be used on its own", async (t) => {
  const fake = await fakeServer();
  t.after(() => fake.close());
  const conn = new DenisConnection({ port: fake.port, group: "ci", password: "pass word", token: "tok0" });
  await conn.connect();
  await conn.handshake();
  assert.equal(conn.ready, true);
  assert.deepEqual(await conn.raw("ECHO hi"), { ok: true, data: "hi" });
  await conn.quit();
  assert.equal(conn.closed, true);
  await assert.rejects(conn.raw("PING"), (err) => err.code === "ECLOSED");
});
