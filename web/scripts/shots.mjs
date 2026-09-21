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
// ONLY=db-access,dblogin node scripts/shots.mjs  -> capture a subset
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
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
        'SET user:1 {"name":"Ada","role":"admin"} -&save',
        'SET user:2 {"name":"Grace","role":"editor"} -&save',
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
  await fetch(`/api/v1/databases/${database.id}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "claude-desktop", scope: "read" }),
  });
  await fetch(`/api/v1/databases/${database.id}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "production", scope: "write" }),
  });
  return database.id;
});
await page.evaluate(async () => {
  await fetch("/api/v1/databases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "analytics" }) });
});
// a teammate (registered in a second context so the first session stays intact), a member row and two database accounts
const mate = await browser.newContext();
const matePage = await mate.newPage();
await matePage.goto(BASE + "/login");
const mateEmail = `mate-${Date.now()}@example.com`;
await matePage.evaluate(
  async ({ email }) => {
    await fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "shots-pass-123", name: "Grace Hopper" }),
    });
  },
  { email: mateEmail },
);
await mate.close();
await page.evaluate(
  async ({ dbId, mateEmail }) => {
    const post = (path, body) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await post(`/api/v1/databases/${dbId}/members`, { email: mateEmail, role: "editor" });
    await post(`/api/v1/databases/${dbId}/accounts`, { username: "ops", password: "ops-pass-123", role: "admin" });
    await post(`/api/v1/databases/${dbId}/accounts`, { username: "reporting", password: "report-pass-123", role: "viewer" });
  },
  { dbId, mateEmail },
);

// the admin pages need an administrator: sign in as the smoke admin (PLATFORM_ADMINS) in a separate context
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const adminPage = await adminCtx.newPage();
await adminPage.goto(BASE + "/login");
const adminOk = await adminPage.evaluate(async () => {
  const body = { email: "smoke-admin@example.com", password: "smoke-admin-123", name: "Smoke Admin" };
  let r = await fetch("/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status !== 200)
    r = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.status === 200;
});

const pages = [
  ["landing", "/"],
  ["login", "/login"],
  ["privacy", "/privacy"],
  ["security", "/security"],
  ["terms", "/terms"],
  ["register", "/register"],
  ["dashboard", "/dashboard"],
  ["databases", "/databases"],
  ["db-overview", `/databases/${dbId}`],
  ["db-console", `/databases/${dbId}/console`],
  ["db-tables", `/databases/${dbId}/tables`],
  ["db-keys", `/databases/${dbId}/keys`],
  ["db-history", `/databases/${dbId}/history`],
  ["db-access", `/databases/${dbId}/access`],
  ["db-connect", `/databases/${dbId}/connect`],
  ["db-settings", `/databases/${dbId}/settings`],
  ["usage", "/usage"],
  ["settings", "/settings"],
  ["admin", "/admin", "admin"],
  ["admin-users", "/admin/users", "admin"],
  ["admin-databases", "/admin/databases", "admin"],
  ["admin-accounts", "/admin/accounts", "admin"],
  ["admin-activity", "/admin/activity", "admin"],
  ["dblogin", `/db/${dbId}/login`],
  ["dbws-overview", `/db/${dbId}`],
  ["dbws-console", `/db/${dbId}/console`],
  ["dbws-history", `/db/${dbId}/history`],
];

for (const theme of ["light", "dark"]) {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await adminPage.addInitScript((t) => localStorage.setItem("theme", t), theme);
  for (const [name, path, who] of pages) {
    if (ONLY && !ONLY.includes(name)) continue;
    if (who === "admin") {
      if (!adminOk) continue;
      await adminPage.goto(BASE + path, { waitUntil: "networkidle" });
      await adminPage.waitForTimeout(500);
      await adminPage.screenshot({ path: `${OUT}/${name}-${theme}.png` });
      console.log("shot", name, theme);
      continue;
    }
    await page.goto(BASE + path, { waitUntil: name.startsWith("dbws") ? "load" : "networkidle" });
    if (name === "db-console") {
      await page.fill("textarea", "SELECT name, price FROM products WHERE price > 5 ORDER BY price DESC\nGET user:1\nKEYS user:*\nSHOW TABLES\nGET missing");
      await page.keyboard.press("Control+Enter");
      await page.waitForTimeout(800);
    }
    if (name === "dblogin") {
      // the login page redirects when a database session cookie is still around
      await page.evaluate((id) => fetch(`/api/db/${id}/logout`, { method: "POST" }), dbId);
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
      await page.fill("input[name=username]", "ops");
      await page.fill("input[name=password]", "ops-pass-123");
      await page.click("button[type=submit]");
      await page.waitForURL(`**/db/${dbId}`, { timeout: 10000 }).catch(() => {});
      console.log("shot", name, theme);
      continue;
    }
    if (name === "db-keys") {
      await page.click("text=user:1").catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(name === "landing" ? 2500 : 500);
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage: ["landing", "privacy", "security", "terms"].includes(name) });
    console.log("shot", name, theme);
  }
}
await browser.close();
