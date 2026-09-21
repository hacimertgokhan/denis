#!/usr/bin/env node
/**
 * Screenshots of every page for design review:
 *   node scripts/shots.mjs [baseUrl] [outDir]
 * Registers a throwaway user, seeds one database, then captures each page
 * at 1440x900 in light and dark mode into outDir (default ./shots).
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:3100";
const OUT = process.argv[3] || "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();

// account + data through the API (same origin, so cookies land in the context)
const email = `shots-${Date.now()}@example.com`;
await page.goto(BASE + "/login");
const signup = await page.evaluate(
  async ({ email }) => {
    const r = await fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "shots-pass-123", name: "Ada Lovelace" }),
    });
    return r.status;
  },
  { email },
);
if (signup !== 200) throw new Error("sign-up failed: " + signup);
const dbId = await page.evaluate(async () => {
  const r = await fetch("/api/v1/databases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "shop" }) });
  const { database } = await r.json();
  await fetch(`/api/v1/databases/${database.id}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        "SET greeting hello world -&save",
        "SET user:1 {\"name\":\"Ada\",\"role\":\"admin\"} -&save",
        "SET user:2 {\"name\":\"Grace\",\"role\":\"editor\"} -&save",
        "SET session:abc 2026-09-21T13:00:00Z",
        "CREATE TABLE products (id INT, name TEXT, price REAL, category TEXT)",
        "INSERT INTO products (id, name, price, category) VALUES (1, 'Pen', 2.5, 'office'), (2, 'Book', 12, 'books'), (3, 'Bag', 40, 'travel'), (4, 'Lamp', 25.5, 'home'), (5, 'Mug', 6, 'kitchen')",
        "CREATE TABLE orders (id INT, product_id INT, qty INT, total REAL)",
        "INSERT INTO orders (id, product_id, qty, total) VALUES (1, 2, 3, 36), (2, 3, 1, 40), (3, 1, 10, 25)",
        "SELECT * FROM products WHERE price > 5 ORDER BY price DESC",
        "GET greeting",
        "GET missing",
      ],
    }),
  });
  await fetch(`/api/v1/databases/${database.id}/keys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "claude-desktop", scope: "read" }) });
  await fetch(`/api/v1/databases/${database.id}/keys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "production", scope: "write" }) });
  return database.id;
});
await page.evaluate(async () => {
  await fetch("/api/v1/databases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "analytics" }) });
});

const pages = [
  ["landing", "/"],
  ["login", "/login"],
  ["register", "/register"],
  ["dashboard", "/dashboard"],
  ["databases", "/databases"],
  ["db-overview", `/databases/${dbId}`],
  ["db-console", `/databases/${dbId}/console`],
  ["db-tables", `/databases/${dbId}/tables`],
  ["db-keys", `/databases/${dbId}/keys`],
  ["db-connect", `/databases/${dbId}/connect`],
  ["db-settings", `/databases/${dbId}/settings`],
  ["usage", "/usage"],
  ["settings", "/settings"],
];

for (const theme of ["light", "dark"]) {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  for (const [name, path] of pages) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    if (name === "db-console") {
      await page.fill("textarea", "SELECT name, price FROM products WHERE price > 5 ORDER BY price DESC\nGET user:1\nKEYS user:*\nSHOW TABLES\nGET missing");
      await page.keyboard.press("Control+Enter");
      await page.waitForTimeout(800);
    }
    if (name === "db-keys") {
      await page.click("text=user:1").catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(name === "landing" ? 2500 : 500);
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage: name === "landing" });
    console.log("shot", name, theme);
  }
}
await browser.close();
