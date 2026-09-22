import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/app/code-block";
import { SectionRow } from "@/components/app/page-primitives";
import { env } from "@/lib/env";

const REPO = "https://github.com/hacimertgokhan/denis";

/**
 * How to use this database from code: the client for Node, plain HTTP for
 * everything else, the query language, the patterns an application needs
 * (users, sessions, counters, tables) and backups. Every snippet carries
 * this database's URL; the key is the placeholder from the Connect tab.
 */
export function ExamplesGuide({ database }: { database: { id: string; slug: string; name: string } }) {
  const base = env().NEXT_PUBLIC_APP_URL;
  const KEY = "dk_your_api_key";

  return (
    <div>
      <SectionRow
        title="1. Connect"
        description="Create an API key on the Connect tab (read-only for dashboards and assistants, write for applications). Keys live on your server, never in a browser or a mobile app."
      >
        <Tabs defaultValue="node">
          <TabsList>
            <TabsTrigger value="node">Node.js</TabsTrigger>
            <TabsTrigger value="python">Python</TabsTrigger>
            <TabsTrigger value="curl">curl</TabsTrigger>
            <TabsTrigger value="go">Go</TabsTrigger>
          </TabsList>
          <TabsContent value="node">
            <CodeBlock language="bash" code={`npm install denis-client`} className="mb-2" />
            <CodeBlock
              language="typescript"
              code={`import { DenisCloud } from "denis-client";

// ${database.name}
const denis = new DenisCloud({
  apiKey: process.env.DENIS_API_KEY, // ${KEY}
  url: "${base}",
  useJwt: true, // the key is exchanged for short-lived tokens
});

await denis.ping(); // true`}
            />
          </TabsContent>
          <TabsContent value="python">
            <CodeBlock
              language="python"
              code={`import os, requests

class Denis:
    """The REST gateway from Python: one command, or a batch of up to 50."""
    def __init__(self, key: str, base: str = "${base}"):
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        self.base = base

    def run(self, command: str) -> dict:
        r = self.s.post(f"{self.base}/api/v1/exec", json={"command": command}, timeout=15)
        body = r.json()
        if "error" in body:
            raise RuntimeError(body["error"]["message"])
        return body["reply"]

    def batch(self, commands: list[str]) -> list[dict]:
        r = self.s.post(f"{self.base}/api/v1/exec", json={"commands": commands}, timeout=30)
        return [x["reply"] for x in r.json()["results"]]

denis = Denis(os.environ["DENIS_API_KEY"])  # ${KEY}
print(denis.run("PING"))`}
            />
          </TabsContent>
          <TabsContent value="curl">
            <CodeBlock
              language="bash"
              code={`# who am I?
curl ${base}/api/v1/exec -H "Authorization: Bearer ${KEY}"

# one command
curl -X POST ${base}/api/v1/exec \\
  -H "Authorization: Bearer ${KEY}" -H "Content-Type: application/json" \\
  -d '{"command":"PING"}'`}
            />
          </TabsContent>
          <TabsContent value="go">
            <CodeBlock
              language="go"
              code={`package main

import ("bytes"; "encoding/json"; "net/http"; "os")

// Exec sends one protocol line to ${database.name} and returns the reply object.
func Exec(command string) (map[string]any, error) {
	body, _ := json.Marshal(map[string]string{"command": command})
	req, _ := http.NewRequest("POST", "${base}/api/v1/exec", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+os.Getenv("DENIS_API_KEY")) // ${KEY}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil { return nil, err }
	defer res.Body.Close()
	var out struct{ Reply map[string]any; Error *struct{ Message string } }
	json.NewDecoder(res.Body).Decode(&out)
	if out.Error != nil { return nil, errors.New(out.Error.Message) }
	return out.Reply, nil
}`}
            />
          </TabsContent>
        </Tabs>
      </SectionRow>

      <SectionRow
        title="2. Keys"
        description="Strings, or JSON when you need structure. -&save (persist: true) writes the key to disk; without it the key lives in memory only."
      >
        <Tabs defaultValue="node">
          <TabsList>
            <TabsTrigger value="node">Node.js</TabsTrigger>
            <TabsTrigger value="wire">Protocol</TabsTrigger>
          </TabsList>
          <TabsContent value="node">
            <CodeBlock
              language="typescript"
              code={`await denis.set("greeting", "hello world", { persist: true });
await denis.get("greeting");                                  // "hello world"

// objects are stored as JSON text and come back parsed
await denis.set("user:42", { name: "Ada", plan: "pro" }, { persist: true });
const user = await denis.getJSON<{ name: string; plan: string }>("user:42");

await denis.exists("user:42");                                // true
await denis.keys("user:*");                                   // ["user:42", ...]
await denis.mget(["user:42", "user:43"]);                     // { "user:42": "...", "user:43": null }
await denis.del("greeting");`}
            />
          </TabsContent>
          <TabsContent value="wire">
            <CodeBlock
              language="bash"
              code={`SET greeting hello world -&save        {"ok":true,"message":"Ok (Cache, Protobuf)"}
GET greeting                            {"ok":true,"key":"greeting","data":"hello world"}
SET user:42 {"name":"Ada"} -&save
EXISTS user:42                          {"ok":true,"key":"user:42","exists":true}
KEYS user:*                             {"ok":true,"keys":["user:42"],"count":1}
MGET user:42 user:43                    {"ok":true,"values":{"user:42":"{\\"name\\":\\"Ada\\"}","user:43":null}}
DEL greeting`}
            />
          </TabsContent>
        </Tabs>
        <p className="text-muted-foreground mt-3 text-[13px]">
          Keys are one word (no spaces); values may hold spaces and Unicode but not line breaks, and no word of a value may start with <code>-&amp;</code>. The
          client refuses both before anything is sent.
        </p>
      </SectionRow>

      <SectionRow
        title="3. Tables"
        description="A small SQL: one table per statement, an index on every column, rows in memory. Strings in single quotes, a quote inside is escaped with a backslash."
      >
        <CodeBlock
          language="typescript"
          code={`await denis.execute("CREATE TABLE IF NOT EXISTS products (id INT, name TEXT, price REAL, category TEXT)");
await denis.execute("INSERT INTO products (id, name, price, category) VALUES (1, 'Pen', 2.5, 'office'), (2, 'Book', 12, 'books')");

const rows = await denis.query("SELECT name, price FROM products WHERE price > 5 ORDER BY price DESC LIMIT 20");
// [{ name: "Book", price: 12 }]

await denis.execute("UPDATE products SET price = 3 WHERE id = 1");   // 1 (rows affected)
await denis.execute("DELETE FROM products WHERE category = 'books'");
await denis.tables();                                                // [{ name, columns, rows }]
await denis.describe("products");

// values from users: quote them, never concatenate raw text
const q = (s: string) => "'" + s.replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "\\\\'") + "'";
await denis.query(\`SELECT * FROM products WHERE name = \${q(userInput)}\`);`}
        />
        <p className="text-muted-foreground mt-3 text-[13px]">
          Supported: <code>WHERE</code> with <code>= != &lt; &lt;= &gt; &gt;= LIKE IS NULL AND OR</code>, <code>ORDER BY</code>, <code>LIMIT/OFFSET</code>,{" "}
          <code>COUNT(*)</code>. Not supported: joins, GROUP BY, subqueries, comparing two columns — do that in your code.
        </p>
      </SectionRow>

      <SectionRow
        title="4. Many reads in one round trip"
        description="A QUERY document fetches keys and rows together and returns only the fields you name. This is what an application's page load should look like."
      >
        <CodeBlock
          language="typescript"
          code={`const { data, errors } = await denis.graph(\`{
  user:   get("user:42") { name plan }
  cart:   prefix("cart:42:") { sku qty }
  orders: table("orders", where: "user_id = 42", order: "total desc", limit: 5) { id total }
  n:      count("orders")
}\`);

data.user    // { name: "Ada", plan: "pro" }        only the selected fields
data.cart    // { "cart:42:a": { sku, qty }, ... }
data.orders  // [{ id, total }, ...]
errors       // [] — a failing field is null here with its reason, the rest still resolve`}
        />
      </SectionRow>

      <SectionRow
        title="5. Patterns an app needs"
        description="Accounts, sessions and counters are keys; anything you filter or sort is a table. The Stockroom example on GitHub is a complete app built this way."
      >
        <Tabs defaultValue="auth">
          <TabsList>
            <TabsTrigger value="auth">Users and sessions</TabsTrigger>
            <TabsTrigger value="counter">Counters and ids</TabsTrigger>
            <TabsTrigger value="cache">Cache with a lifetime</TabsTrigger>
          </TabsList>
          <TabsContent value="auth">
            <CodeBlock
              language="typescript"
              code={`import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// sign up: hash the password with a per-user salt, store the account under its email
async function register(email: string, password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  await denis.set(\`user:\${email}\`, { email, salt, hash, createdAt: new Date().toISOString() }, { persist: true });
}

// sign in: compare in constant time, then issue a random session token with an expiry
async function signIn(email: string, password: string) {
  const user = await denis.getJSON<{ salt: string; hash: string }>(\`user:\${email}\`);
  if (!user) return null;
  const ok = timingSafeEqual(Buffer.from(scryptSync(password, user.salt, 64).toString("hex"), "hex"), Buffer.from(user.hash, "hex"));
  if (!ok) return null;
  const token = randomBytes(32).toString("hex");
  await denis.set(\`session:\${token}\`, { email, expiresAt: Date.now() + 14 * 86400_000 }, { persist: true });
  return token; // put it in an httpOnly cookie
}

// every request: the cookie's token -> the account, or nothing
async function currentUser(token: string) {
  const s = await denis.getJSON<{ email: string; expiresAt: number }>(\`session:\${token}\`);
  return s && s.expiresAt > Date.now() ? denis.getJSON(\`user:\${s.email}\`) : null;
}`}
            />
          </TabsContent>
          <TabsContent value="counter">
            <CodeBlock
              language="typescript"
              code={`// a counter in a key: read, add one, write back (fine for one writer; use a table id column for many)
async function nextId(name: string) {
  const key = \`seq:\${name}\`;
  const next = Number((await denis.get(key)) ?? 0) + 1;
  await denis.set(key, String(next), { persist: true });
  return next;
}

const id = await nextId("order");
await denis.execute(\`INSERT INTO orders (id, user_id, total) VALUES (\${id}, 42, 36.5)\`);`}
            />
          </TabsContent>
          <TabsContent value="cache">
            <CodeBlock
              language="typescript"
              code={`// memory-only keys (no persist) are a cache; keep the expiry inside the value
async function remember<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await denis.getJSON<{ until: number; value: T }>(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  await denis.set(key, { until: Date.now() + ttlMs, value });   // no persist: cache only
  return value;
}

const rates = await remember("fx:eur", 60_000, () => fetchRates());`}
            />
          </TabsContent>
        </Tabs>
        <p className="text-muted-foreground mt-3 text-[13px]">
          Complete example:{" "}
          <a href={`${REPO}/tree/master/examples/inventory`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            Stockroom
          </a>{" "}
          — accounts, sessions, products and stock movements, all in one database, with an end-to-end test.
        </p>
      </SectionRow>

      <SectionRow title="6. Assistants" description="The same database through MCP. A read-only key gives an assistant the read tools only.">
        <CodeBlock
          language="json"
          title="claude_desktop_config.json · .cursor/mcp.json"
          code={`{
  "mcpServers": {
    "denis-${database.slug}": {
      "url": "${base}/api/mcp",
      "headers": { "Authorization": "Bearer ${KEY}" }
    }
  }
}`}
        />
        <CodeBlock
          className="mt-2"
          language="bash"
          code={`claude mcp add --transport http denis-${database.slug} ${base}/api/mcp --header "Authorization: Bearer ${KEY}"`}
        />
      </SectionRow>

      <SectionRow
        title="7. Backups and usage from code"
        description="What the Settings tab does, as HTTP: download the whole database, restore it, read the quota."
      >
        <CodeBlock
          language="bash"
          code={`# usage against the limits
curl ${base}/api/v1/usage -H "Authorization: Bearer ${KEY}"

# the whole database as a zip (manifest.json, keys.json, tables/<name>.json)
curl -o ${database.slug}.zip ${base}/api/v1/databases/${database.id}/backup -H "Authorization: Bearer ${KEY}"

# restore it (owners and admins; mode = merge | replace)
curl -X POST ${base}/api/v1/databases/${database.id}/backup \\
  -H "Authorization: Bearer ${KEY}" -F file=@${database.slug}.zip -F mode=merge`}
        />
      </SectionRow>

      <SectionRow title="8. Errors and limits" description="Every error is one shape; quotas answer with a code you can act on.">
        <CodeBlock
          language="typescript"
          code={`import { DenisError } from "denis-client";

try {
  await denis.set("k", "v", { persist: true });
} catch (err) {
  if (err instanceof DenisError) {
    err.code;          // EAUTH (bad key) · ELIMIT (rate limit or daily budget) · ESERVER (the engine said no)
    err.reply?.code;   // e.g. "QUOTA" when the database is at its storage limit, "READ_ONLY" for a read key
    err.message;
  }
}

// REST: { "error": { "code": "QUOTA", "message": "..." } } with the matching HTTP status
// Free plan: ${env().PLAN_MAX_DATABASES} databases, ${Math.round(env().PLAN_DB_MAX_BYTES / 1024 / 1024)} MB and ${env().PLAN_DB_MAX_KEYS.toLocaleString("en-US")} keys each, ${env().PLAN_DB_OPS_PER_DAY.toLocaleString("en-US")} commands a day, ${env().PLAN_API_RATE_PER_MINUTE} requests a minute per key`}
        />
      </SectionRow>
    </div>
  );
}
