"use strict";

/**
 * Electron smoke test with Playwright's _electron driver (no browser download
 * needed). Run: npm run test:electron
 *
 * Without a server it checks the window, the security model (no Node in the
 * renderer, CSP blocks inline code and remote requests, only the fixed bridge
 * is exposed) and the navigation.
 *
 * With DENIS_E2E_JAR=/path/denis.jar it also starts a Denis server on
 * DENIS_E2E_PORT (default 7103) in a temp directory, then drives the UI:
 * add a connection profile, connect, create a project, add a key, run SQL,
 * and open the dashboard. Screenshots go to DENIS_STUDIO_SHOTS if set.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { _electron: electron } = require("playwright");

const APP_DIR = path.join(__dirname, "..", "..");
const JAR = process.env.DENIS_E2E_JAR;
const PORT = Number(process.env.DENIS_E2E_PORT || 7103);
const SHOTS = process.env.DENIS_STUDIO_SHOTS;

let app;
let page;
let server;
const pageErrors = [];

function waitForPort(port, ms = 30000) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const once = () => {
      const s = net.createConnection({ host: "127.0.0.1", port });
      s.once("connect", () => {
        s.destroy();
        resolve();
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() > end) reject(new Error("server did not start"));
        else setTimeout(once, 200);
      });
    };
    once();
  });
}

async function shot(name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test.before(async () => {
  if (JAR) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "denis-studio-ui-"));
    server = spawn("java", ["-jar", JAR, "server"], {
      cwd: dir,
      env: { ...process.env, DENIS_BOOTSTRAP_GROUP: "studio", DENIS_BOOTSTRAP_GROUP_PASSWORD: "studio-pw", DENIS_DDB_PORT: String(PORT), DENIS_PASSWORD_ITERATIONS: "20000" },
      stdio: "ignore",
      windowsHide: true,
    });
    await waitForPort(PORT);
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "denis-studio-profile-"));
  app = await electron.launch({ args: [APP_DIR], cwd: APP_DIR, env: { ...process.env, DENIS_STUDIO_USER_DATA: userData } });
  page = await app.firstWindow();
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    // the CSP test provokes "Refused to ..." messages on purpose
    if (msg.type() === "error" && !/Content Security Policy|Refused to|ERR_BLOCKED_BY_CLIENT|net::ERR_/.test(msg.text())) pageErrors.push(msg.text());
  });
  await page.waitForSelector("#nav .nav-item");
});

test.after(async () => {
  if (app) await app.close();
  if (server) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
});

test("window opens with navigation and status bar", async () => {
  assert.match(await page.title(), /Denis Studio/);
  assert.equal(await page.locator("#nav .nav-item").count(), 8);
  assert.match(await page.locator("#statusbar").innerText(), /Not connected/);
  await shot("01-connections-empty");
});

test("renderer is isolated: no Node, fixed bridge only", async () => {
  const r = await page.evaluate(() => ({
    require: typeof window.require,
    process: typeof window.process,
    module: typeof window.module,
    bridgeGroups: Object.keys(window.studio || {}).sort(),
    hasIpc: "ipcRenderer" in (window.studio || {}),
    protocol: location.protocol,
  }));
  assert.equal(r.require, "undefined");
  assert.equal(r.process, "undefined");
  assert.equal(r.module, "undefined");
  assert.equal(r.hasIpc, false);
  assert.deepEqual(r.bridgeGroups, ["app", "conn", "console", "db", "dump", "history", "profiles", "result", "settings"]);
  assert.equal(r.protocol, "studio:");
});

test("CSP blocks inline code and remote requests", async () => {
  const r = await page.evaluate(async () => {
    const img = document.createElement("img");
    img.setAttribute("src", "data:,x");
    img.setAttribute("onerror", "window.__inline = 1");
    img.setAttribute("onload", "window.__inline = 1");
    document.body.append(img);
    const s = document.createElement("script");
    s.textContent = "window.__script = 1";
    document.body.append(s);
    let fetchResult = "blocked";
    try {
      await fetch("https://example.com/");
      fetchResult = "allowed";
    } catch {
      /* expected */
    }
    await new Promise((res) => setTimeout(res, 200));
    img.remove();
    s.remove();
    return { inline: window.__inline, script: window.__script, fetchResult };
  });
  assert.equal(r.inline, undefined, "inline event handler must not run");
  assert.equal(r.script, undefined, "inline script must not run");
  assert.equal(r.fetchResult, "blocked");
});

test("views without connection show a gate", async () => {
  await page.click('.nav-item[data-view="keys"]');
  await page.waitForSelector("text=Keys needs a connection");
  await page.click('.nav-item[data-view="settings"]');
  await page.waitForSelector("h1:has-text('Settings')");
  await page.click("text=Dark");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await shot("02-settings-dark");
  await page.click("text=System");
});

test("full flow against a real server", { skip: !JAR && "set DENIS_E2E_JAR to run" }, async () => {
  await page.click('.nav-item[data-view="connections"]');
  await page.click("button:has-text('New connection')");
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Name").fill("Local e2e");
  await dialog.getByLabel("Host").fill("127.0.0.1");
  await dialog.getByLabel("Port").fill(String(PORT));
  await dialog.getByLabel("Group").fill("studio");
  await dialog.getByLabel("Password", { exact: true }).fill("studio-pw");
  await dialog.locator("button:has-text('Test connection')").click();
  await page.waitForSelector(".toast-success:has-text('Connection OK')");
  await dialog.locator("button:has-text('Save connection')").click();
  await page.waitForSelector(".profile-card:has-text('Local e2e')");
  await shot("03-connections");

  const card = page.locator(".profile-card:has-text('Local e2e')");
  if (await card.locator("text=asks for password").count()) {
    await card.locator("button:has-text('Connect')").click();
    await page.locator("dialog[open] input[type=password]").fill("studio-pw");
    await page.locator("dialog[open] button:has-text('Connect')").click();
  } else {
    await card.locator("button:has-text('Connect')").click();
  }
  await page.waitForSelector("#statusbar[data-state='connected']");
  assert.match(await page.locator("#statusbar").innerText(), /admin/);

  // no default project -> projects page
  await page.waitForSelector("h1:has-text('Projects')");
  await page.click("button:has-text('New project')");
  await page.locator("dialog[open] button:has-text('Use this project')").click();
  await page.waitForSelector(".badge:has-text('current')");
  await shot("04-projects");

  await page.click('.nav-item[data-view="keys"]');
  await page.waitForSelector("h1:has-text('Keys')");
  await page.click("button:has-text('New key')");
  const nk = page.locator("dialog[open]");
  await nk.getByLabel("Key").fill("user:1");
  await nk.getByLabel("Value").fill('{"name":"Ada","langs":["en","tr"]}');
  await nk.locator("button:has-text('Create')").click();
  await page.waitForSelector(".detail-key:has-text('user:1')");
  const editorText = await page.locator(".value-editor").inputValue();
  assert.match(editorText, /\n {2}"name": "Ada"/, "JSON is pretty printed");
  // multi-line raw value is refused with a clear message and can be stored as a JSON string
  await page.click("button:has-text('New key')");
  await page.locator("dialog[open]").getByLabel("Key").fill("note");
  await page.locator("dialog[open]").getByLabel("Value").fill("line one\nline two");
  await page.locator("dialog[open] button:has-text('Create')").click();
  await page.waitForSelector("dialog[open] .field-error:has-text('line breaks')");
  await page.locator("dialog[open] label:has-text('Store as JSON string')").click();
  await page.locator("dialog[open] button:has-text('Create')").click();
  await page.waitForSelector(".detail-key:has-text('note')");
  await shot("05-keys");

  await page.click('.nav-item[data-view="sql"]');
  await page.waitForSelector("h1:has-text('SQL')");
  await page.fill(".sql-editor", "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO people (name) VALUES ('Ada'); INSERT INTO people (name) VALUES (NULL)");
  await page.click("button:has-text('Run')");
  await page.waitForSelector(".tables-list :text('people')");
  await page.fill(".sql-editor", "SELECT * FROM people WHERE id > ?");
  await page.fill("input[placeholder*='JSON array']", "[0]");
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".grid td .null");
  assert.equal(await page.locator(".grid tbody tr").count(), 2);
  await page.click(".grid th button:has-text('name')");
  await shot("06-sql");

  await page.click('.nav-item[data-view="dashboard"]');
  await page.waitForSelector(".tile:has-text('Ops / s')");
  await page.waitForTimeout(2500);
  await shot("07-dashboard");

  // native file dialogs are stubbed in the main process
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "denis-studio-files-"));
  const csvPath = path.join(outDir, "result.csv");
  const exportPath = path.join(outDir, "project.denis.json");
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async (win, opts) => ({ canceled: false, filePath: /CSV/.test(opts.title) ? p.csv : p.dump });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p.dump] });
  }, { csv: csvPath, dump: exportPath });

  await page.click('.nav-item[data-view="sql"]');
  await page.fill(".sql-editor", "SELECT * FROM people ORDER BY id");
  await page.click("button:has-text('Run')");
  await page.click(".result-meta button:has-text('CSV')");
  await page.waitForSelector(".toast-success:has-text('Saved 2 rows')");
  assert.equal(fs.readFileSync(csvPath, "utf8"), "﻿id,name\r\n1,Ada\r\n2,\r\n");

  await page.click('.nav-item[data-view="backup"]');
  await page.waitForSelector("text=Server backups");
  await page.click("button:has-text('BACKUP now')");
  await page.waitForSelector(".toast-success:has-text('Backup created')");
  await page.click("button:has-text('Export project')");
  await page.waitForSelector(".callout-success:has-text('Exported.')");
  const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  assert.equal(exported.kind, "denis-studio-export");
  assert.equal(exported.summary.tables, 1);
  await page.click("button:has-text('Choose file')");
  await page.waitForSelector(".preview .badge:has-text('exists')");
  await page.waitForSelector(".callout-warning:has-text('already exist')");
  await page.locator("label:has-text('Replace existing tables')").click();
  await shot("08-backup");
  await page.click(".preview button:has-text('Import')");
  await page.locator("dialog[open] button:has-text('Import')").click();
  await page.waitForSelector(".callout-success:has-text('Imported.')");

  await page.click('.nav-item[data-view="console"]');
  await page.fill(".console-input", "DBSIZE");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".console-json:has-text('\"keys\"')");
  await page.fill(".console-input", "MODE text");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".console-refused");
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.locator(".console-input").inputValue(), "MODE text");
  await shot("09-console");
});

test("no uncaught errors in the renderer", () => {
  assert.deepEqual(pageErrors, []);
});

// last: a blocked navigation leaves Playwright waiting for it, so nothing may follow
test("window.open and navigation are blocked", async () => {
  const before = page.url();
  const opened = await page.evaluate(() => window.open("https://example.com") === null);
  assert.equal(opened, true);
  await page.evaluate(() => {
    location.href = "https://example.com";
  });
  await page.waitForTimeout(300);
  assert.equal(page.url(), before);
  assert.equal(app.windows().length, 1);
});
