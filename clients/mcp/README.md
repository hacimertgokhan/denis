# denis-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[Denis Database](https://github.com/hacimertgokhan/denis). It lets an AI
assistant (Claude Desktop, Claude Code, Cursor, any MCP host) look at what is
stored in a Denis project, write SQL against it, and read or write keys — the
model sees the real schema first, then queries it.

Plain Node.js (18+), no build step; depends on the `denis-client` package in
`../node` and the official MCP SDK.

## Setup

```sh
cd clients/mcp && npm install
```

Add it to your MCP host. Claude Desktop / Claude Code (`claude mcp add-json denis '<the object below>'`):

```json
{
  "mcpServers": {
    "denis": {
      "command": "node",
      "args": ["/path/to/denis/clients/mcp/src/index.js"],
      "env": {
        "DENIS_HOST": "127.0.0.1",
        "DENIS_PORT": "5142",
        "DENIS_GROUP": "crm",
        "DENIS_PASSWORD": "s3cret",
        "DENIS_TOKEN": "<project token>"
      }
    }
  }
}
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `DENIS_HOST` | `127.0.0.1` | server host |
| `DENIS_PORT` | `5142` | server port |
| `DENIS_GROUP` | required | login group (`LIN`) |
| `DENIS_PASSWORD` | required | its password |
| `DENIS_TOKEN` | — | project token (`AUTH`); a new project is created when unset — pass it so the assistant sees your data |
| `DENIS_READ_ONLY` | `0` | `1` hides `denis_execute`, `denis_set`, `denis_delete` |
| `DENIS_MAX_ROWS` | `200` | default row cap of `denis_query` |

Get a token with `denis cli token list` (or `denis cli token create`) on the
server, or `docker compose exec denis /app/entrypoint.sh cli token list`.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `denis_describe` | read | Tables with columns and row counts, key count with a sample, server version. **Call first.** |
| `denis_query` | read | `SELECT` / `SHOW TABLES` / `DESCRIBE`; rows as a Markdown table plus structured content; capped by `limit` |
| `denis_execute` | write | `INSERT` / `UPDATE` / `DELETE` / `CREATE TABLE` / `DROP TABLE`; returns the affected count |
| `denis_get` | read | one key; JSON values are also returned parsed |
| `denis_mget` | read | up to 100 keys |
| `denis_keys` | read | key names matching a glob (`user:*`) |
| `denis_set` | write | one key; objects are stored as JSON; persisted by default |
| `denis_delete` | write | one key |
| `denis_info` | read | server statistics |

Every tool returns text **and** `structuredContent`, carries MCP annotations
(`readOnlyHint`, `destructiveHint`, ...) and answers errors with a hint
(`Table not found ... Call denis_describe to list the existing tables.`).
`denis_query` refuses statements that modify data and `denis_execute` refuses
reads, so a read-only workflow cannot accidentally write.

Resources: `denis://schema` (Markdown overview), `denis://protocol` (command
reference from `HELP`), `denis://table/{name}` (one table as JSON).
Prompt: `denis_analyze(question)` — a ready-made instruction to answer a data
question with `denis_describe` + `denis_query`.

## Example conversation

> **User:** Which products cost more than 10?
>
> **Assistant** calls `denis_describe` → sees `products (id INT, name TEXT, price REAL)` with 3 rows,
> then `denis_query` with `SELECT name, price FROM products WHERE price > 10 ORDER BY price DESC`
> and answers with the two matching rows.

## Development

```sh
npm test                         # unit tests, no server needed
DENIS_INTEGRATION=1 DENIS_GROUP=crm DENIS_PASSWORD=s3cret npm run test:integration
npm run inspect                  # MCP Inspector UI against a running server
```

The integration test drives the server in-process through the SDK client
(`InMemoryTransport`), so it covers the same code path an MCP host uses.
