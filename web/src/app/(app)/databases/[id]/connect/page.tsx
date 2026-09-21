import { notFound } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiKeys } from "@/components/app/api-keys";
import { CodeBlock } from "@/components/app/code-block";
import { SectionRow } from "@/components/app/page-primitives";
import { listApiKeys } from "@/lib/api-keys";
import { getOwnedDatabase } from "@/lib/databases";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Connect" };

export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const database = await getOwnedDatabase(user.id, id);
  if (!database) notFound();
  const keys = await listApiKeys(database.id);
  const base = env().NEXT_PUBLIC_APP_URL;
  const KEY = "dk_your_api_key";

  return (
    <>
      <ApiKeys
        databaseId={database.id}
        keys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          scope: k.scope,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        }))}
      />

      <div id="mcp" className="border-t">
      <SectionRow
        title="Connect an AI assistant"
        description="The hosted MCP endpoint gives Claude, Cursor or any MCP client the denis_* tools. Use a read-only key when the assistant should only analyse data."
      >
          <Tabs defaultValue="claude-code">
            <TabsList>
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
              <TabsTrigger value="cursor">Cursor / generic</TabsTrigger>
            </TabsList>
            <TabsContent value="claude-code">
              <CodeBlock
                language="bash"
                code={`claude mcp add --transport http denis-${database.slug} ${base}/api/mcp \\
  --header "Authorization: Bearer ${KEY}"`}
              />
            </TabsContent>
            <TabsContent value="claude-desktop">
              <CodeBlock
                language="json"
                title="claude_desktop_config.json"
                code={`{
  "mcpServers": {
    "denis-${database.slug}": {
      "url": "${base}/api/mcp",
      "headers": { "Authorization": "Bearer ${KEY}" }
    }
  }
}`}
              />
            </TabsContent>
            <TabsContent value="cursor">
              <CodeBlock
                language="json"
                title=".cursor/mcp.json"
                code={`{
  "mcpServers": {
    "denis-${database.slug}": {
      "url": "${base}/api/mcp",
      "headers": { "Authorization": "Bearer ${KEY}" }
    }
  }
}`}
              />
            </TabsContent>
          </Tabs>
          <p className="mt-3 text-[13.5px] text-muted-foreground">
            Try: <em>“Describe my database and tell me which products cost more than 10.”</em> The assistant calls denis_describe, writes the SQL and runs denis_query.
          </p>
      </SectionRow>
      <SectionRow
        title="REST API"
        description="One endpoint, any protocol command. Replies are the engine's JSON objects; SQL results come back as rows, affected counts or tables. Errors use { error: { code, message } }."
      >
          <Tabs defaultValue="curl">
            <TabsList>
              <TabsTrigger value="curl">curl</TabsTrigger>
              <TabsTrigger value="node">Node.js</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="jwt">JWT</TabsTrigger>
            </TabsList>
            <TabsContent value="curl">
              <CodeBlock
                language="bash"
                code={`# one command
curl -X POST ${base}/api/v1/exec \\
  -H "Authorization: Bearer ${KEY}" -H "Content-Type: application/json" \\
  -d '{"command":"SET greeting hello world -&save"}'

# several, in order
curl -X POST ${base}/api/v1/exec \\
  -H "Authorization: Bearer ${KEY}" -H "Content-Type: application/json" \\
  -d '{"commands":["GET greeting","SELECT COUNT(*) FROM products"]}'`}
              />
            </TabsContent>
            <TabsContent value="node">
              <CodeBlock
                language="typescript"
                code={`const BASE = "${base}";
const KEY = process.env.DENIS_API_KEY; // ${KEY}

async function denis(command: string) {
  const res = await fetch(BASE + "/api/v1/exec", {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  const { reply, error } = await res.json();
  if (error) throw new Error(error.message);
  return reply; // { ok, ... } as documented in docs/PROTOCOL.md
}

await denis("SET user:1 " + JSON.stringify({ name: "Ada" }) + " -&save");
const { data } = await denis("GET user:1");          // '{"name":"Ada"}'
const { rows } = await denis("SELECT * FROM products WHERE price > 10");`}
              />
            </TabsContent>
            <TabsContent value="python">
              <CodeBlock
                language="python"
                code={`import os, requests

BASE = "${base}"
KEY = os.environ["DENIS_API_KEY"]  # ${KEY}

def denis(command: str):
    r = requests.post(f"{BASE}/api/v1/exec",
                      headers={"Authorization": f"Bearer {KEY}"},
                      json={"command": command})
    body = r.json()
    if "error" in body:
        raise RuntimeError(body["error"]["message"])
    return body["reply"]

denis("SET greeting hello -&save")
print(denis("GET greeting")["data"])
print(denis("SELECT COUNT(*) FROM products")["rows"])`}
              />
            </TabsContent>
            <TabsContent value="jwt">
              <CodeBlock
                language="bash"
                code={`# exchange the key for a short-lived access token + refresh token
curl -X POST ${base}/api/v1/token -H "Content-Type: application/json" \\
  -d '{"apiKey":"${KEY}"}'
# -> {"accessToken":"...","refreshToken":"...","expiresIn":900,"tokenType":"Bearer"}

# use the access token like the key
curl ${base}/api/v1/exec -H "Authorization: Bearer <accessToken>"

# refresh
curl -X POST ${base}/api/v1/token -H "Content-Type: application/json" \\
  -d '{"refreshToken":"<refreshToken>"}'`}
              />
            </TabsContent>
          </Tabs>
      </SectionRow>
      </div>
    </>
  );
}
