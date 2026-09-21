// Drives the MCP server in-process with the SDK client against a live Denis server:
//   DENIS_INTEGRATION=1 DENIS_GROUP=crm DENIS_PASSWORD=s3cret node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DenisClient } from "denis-client";
import { createServer } from "../src/index.js";
import { loadConfig } from "../src/config.js";

const enabled = process.env.DENIS_INTEGRATION === "1";

async function connect(extraEnv = {}) {
  const config = loadConfig({ ...process.env, ...extraEnv });
  const denis = new DenisClient({ ...config, poolSize: 2 });
  const server = createServer(denis, config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); await denis.close(); } };
}

test("denis mcp integration", { skip: !enabled && "set DENIS_INTEGRATION=1 with a running server" }, async (t) => {
  const { client, close } = await connect();
  const table = `mcp_${Date.now()}`;
  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    return { text: res.content[0].text, data: res.structuredContent, isError: res.isError === true };
  };

  await t.test("lists every tool with annotations", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["denis_delete", "denis_describe", "denis_execute", "denis_get", "denis_info", "denis_keys", "denis_mget", "denis_query", "denis_set"]);
    assert.equal(tools.find((tool) => tool.name === "denis_query").annotations.readOnlyHint, true);
  });

  await t.test("execute + query round trip", async () => {
    const created = await call("denis_execute", { sql: `CREATE TABLE ${table} (id INT, name TEXT, price REAL)` });
    assert.equal(created.isError, false, created.text);
    const inserted = await call("denis_execute", { sql: `INSERT INTO ${table} (id, name, price) VALUES (1, 'Pen', 2.5), (2, 'Book', 12), (3, 'Bag', 40)` });
    assert.equal(inserted.data.affected, 3);

    const rows = await call("denis_query", { sql: `SELECT name, price FROM ${table} WHERE price > 10 ORDER BY price DESC` });
    assert.deepEqual(rows.data.rows, [{ name: "Bag", price: 40 }, { name: "Book", price: 12 }]);
    assert.match(rows.text, /\| name \| price \|/);

    const limited = await call("denis_query", { sql: `SELECT id FROM ${table}`, limit: 2 });
    assert.equal(limited.data.truncated, true);
    assert.equal(limited.data.count, 2);
    assert.equal(limited.data.total, 3);
  });

  await t.test("describe shows the table", async () => {
    const described = await call("denis_describe", {});
    const found = described.data.tables.find((tbl) => tbl.name === table);
    assert.equal(found.rows, 3);
    assert.deepEqual(found.columns.map((c) => c.name), ["id", "name", "price"]);
    assert.match(described.text, new RegExp(`\\*\\*${table}\\*\\*`));
  });

  await t.test("query refuses writes and execute refuses reads", async () => {
    const refused = await call("denis_query", { sql: `DELETE FROM ${table}` });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /denis_execute/);
    const refusedRead = await call("denis_execute", { sql: `SELECT * FROM ${table}` });
    assert.equal(refusedRead.isError, true);
  });

  await t.test("server errors carry a hint", async () => {
    const missing = await call("denis_query", { sql: "SELECT * FROM no_such_table_xyz" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /Table not found/);
    assert.match(missing.text, /denis_describe/);
  });

  await t.test("key-value tools", async () => {
    const key = `mcp:${Date.now()}`;
    await call("denis_set", { key, value: { a: 1, b: "x" } });
    const got = await call("denis_get", { key });
    assert.deepEqual(got.data.parsed, { a: 1, b: "x" });
    const keys = await call("denis_keys", { pattern: "mcp:*" });
    assert.ok(keys.data.keys.includes(key));
    const many = await call("denis_mget", { keys: [key, "nope_xyz"] });
    assert.equal(many.data.values.nope_xyz, null);
    await call("denis_delete", { key });
    assert.equal((await call("denis_get", { key })).data.found, false);
    assert.equal(typeof (await call("denis_info", {})).data.version, "string");
  });

  await t.test("resources and prompt", async () => {
    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === "denis://schema"));
    const schema = await client.readResource({ uri: "denis://schema" });
    assert.match(schema.contents[0].text, /SQL tables/);
    const one = await client.readResource({ uri: `denis://table/${table}` });
    assert.equal(JSON.parse(one.contents[0].text).rows, 3);
    const prompt = await client.getPrompt({ name: "denis_analyze", arguments: { question: "how many items?" } });
    assert.match(prompt.messages[0].content.text, /how many items\?/);
  });

  await call("denis_execute", { sql: `DROP TABLE ${table}` });
  await close();

  await t.test("read-only mode hides the writing tools", async () => {
    const ro = await connect({ DENIS_READ_ONLY: "1" });
    const { tools } = await ro.client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["denis_describe", "denis_get", "denis_info", "denis_keys", "denis_mget", "denis_query"]);
    await ro.close();
  });
});
