#!/usr/bin/env node
/**
 * denis-mcp-server — Model Context Protocol server for Denis Database.
 *
 * Runs over stdio, so an MCP host starts it as a subprocess:
 *
 *   {
 *     "mcpServers": {
 *       "denis": {
 *         "command": "npx",
 *         "args": ["-y", "denis-mcp-server"],
 *         "env": { "DENIS_HOST": "127.0.0.1", "DENIS_PORT": "5142",
 *                  "DENIS_GROUP": "crm", "DENIS_PASSWORD": "s3cret", "DENIS_TOKEN": "..." }
 *       }
 *     }
 *   }
 *
 * Tools: denis_describe, denis_query, denis_get, denis_mget, denis_keys, denis_info
 *        and, unless DENIS_READ_ONLY=1: denis_execute, denis_set, denis_delete.
 * Resources: denis://schema (project overview), denis://protocol (command reference).
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DenisClient } from "denis-client";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { describeProject, registerTools, schemaToMarkdown } from "./tools.js";

export function createServer(denis, config) {
  const server = new McpServer({ name: "denis-mcp-server", version: "0.1.0" });

  registerTools(server, denis, config);

  server.registerResource(
    "schema",
    "denis://schema",
    {
      title: "Denis project schema",
      description: "Tables, columns, row counts and a sample of the key-value keys in the current project.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: schemaToMarkdown(await describeProject(denis)) }],
    }),
  );

  server.registerResource(
    "protocol",
    "denis://protocol",
    {
      title: "Denis command reference",
      description: "Every wire-protocol command the server understands, as reported by HELP.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const commands = await denis.help();
      const text = ["# Denis commands", "", ...commands.map((c) => `- \`${c.usage}\` — ${c.description}`)].join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "table",
    new ResourceTemplate("denis://table/{name}", { list: undefined }),
    {
      title: "Denis table",
      description: "Column definitions and row count of one SQL table.",
      mimeType: "application/json",
    },
    async (uri, { name }) => {
      const table = await denis.describe(String(name));
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(table ?? { error: `Table not found: ${name}` }, null, 2) }],
      };
    },
  );

  server.registerPrompt(
    "denis_analyze",
    {
      title: "Analyze the data in Denis",
      description: "Look at the project's schema and answer a question about the stored data with SQL.",
      argsSchema: { question: z.string().describe("What you want to know, in plain language") },
    },
    ({ question }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use the Denis tools to answer this question about the data: ${question}\n\nSteps: call denis_describe to learn the tables and columns, write one or more read-only SELECT statements for denis_query (single table, WHERE/ORDER BY/LIMIT only, no joins), then answer with the numbers or rows you found. Do not modify data unless asked to.`,
          },
        },
      ],
    }),
  );

  return server;
}

async function main() {
  const config = loadConfig();
  const denis = new DenisClient({
    host: config.host,
    port: config.port,
    group: config.group,
    password: config.password,
    token: config.token,
    createProject: config.createProject,
    poolSize: 2,
  });
  const server = createServer(denis, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Fail fast with a readable message when the database is unreachable.
  try {
    await denis.connect();
    console.error(`denis-mcp-server: connected to ${config.host}:${config.port} as ${config.group}${config.readOnly ? " (read-only)" : ""}`);
  } catch (err) {
    console.error(`denis-mcp-server: could not connect to Denis at ${config.host}:${config.port}: ${err.message}`);
  }
  const shutdown = async () => {
    await denis.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`denis-mcp-server: ${err.message}`);
    process.exit(1);
  });
}
