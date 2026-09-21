import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { fail } from "@/lib/api";
import { authenticateRequest, checkRateLimit } from "@/lib/api-keys";
import { createMcpServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

/**
 * Hosted MCP endpoint (Streamable HTTP, stateless). Any MCP client can add
 *   { "url": "https://denis.hacimertgokhan.com/api/mcp", "headers": { "Authorization": "Bearer dk_..." } }
 * and gets the denis_* tools scoped to the key's database.
 */
async function handle(request: Request) {
  try {
    const principal = await authenticateRequest(request);
    checkRateLimit(principal.keyId);
    const server = createMcpServer(principal);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (err) {
    return fail(err);
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
