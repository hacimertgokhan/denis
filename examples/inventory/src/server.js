import express from "express";
import { attachUser, clearSessionCookie, countUsers, createSession, createUser, destroySession, requireUser, setSessionCookie, verifyUser } from "./auth.js";
import { denis, migrate } from "./denis.js";
import * as stock from "./stock.js";
import { layout, loginPage, movementsPage, overviewPage, productForm, productPage, productsPage } from "./views.js";

/**
 * Stockroom: a small stock-keeping app. Express serves HTML; every piece
 * of state — accounts, sessions, products, movements, counters — is in
 * Denis through denis-client (see denis.js for the TCP / Cloud switch).
 */
const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(attachUser());

// one-shot messages after a redirect, kept in a short-lived cookie
app.use((req, res, next) => {
  const raw = (req.headers.cookie ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith("inv_flash="));
  if (raw) {
    try {
      req.flash = JSON.parse(decodeURIComponent(raw.slice("inv_flash=".length)));
    } catch {
      req.flash = null;
    }
    res.clearCookie("inv_flash", { path: "/" });
  }
  res.flash = (type, text) => res.cookie("inv_flash", JSON.stringify({ type, text }), { httpOnly: true, sameSite: "lax", maxAge: 10_000, path: "/" });
  next();
});

const page = (req, res, opts) => res.send(layout({ user: req.user, flash: req.flash, ...opts }));
const safeNext = (v) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/");

// ------------------------------------------------------------------- auth

app.get("/login", async (req, res) => {
  if (req.user) return res.redirect("/");
  if ((await countUsers()) === 0) return res.redirect("/register");
  page(req, res, { title: "Sign in", body: loginPage({ mode: "login", next: safeNext(req.query.next) }) });
});

app.post("/login", async (req, res) => {
  const user = await verifyUser(String(req.body.email ?? ""), String(req.body.password ?? ""));
  if (!user) {
    res.flash("error", "Wrong email or password");
    return res.redirect("/login");
  }
  const { token, expiresAt } = await createSession(user.email);
  setSessionCookie(res, token, expiresAt);
  res.redirect(safeNext(req.query.next));
});

app.get("/register", async (req, res) => {
  if (req.user) return res.redirect("/");
  page(req, res, { title: "Create an account", body: loginPage({ mode: "register", next: safeNext(req.query.next), firstRun: (await countUsers()) === 0 }) });
});

app.post("/register", async (req, res) => {
  try {
    // the first account owns the place; later ones are staff
    const role = (await countUsers()) === 0 ? "owner" : "staff";
    const user = await createUser({ email: String(req.body.email ?? ""), name: String(req.body.name ?? ""), password: String(req.body.password ?? ""), role });
    const { token, expiresAt } = await createSession(user.email);
    setSessionCookie(res, token, expiresAt);
    res.redirect(safeNext(req.query.next));
  } catch (err) {
    res.flash("error", err.message);
    res.redirect("/register");
  }
});

app.post("/logout", async (req, res) => {
  await destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.redirect("/login");
});

// ------------------------------------------------------------------ pages

app.get("/", requireUser, async (req, res) => {
  page(req, res, { title: "Overview", active: "overview", body: overviewPage(await stock.overview()) });
});

app.get("/products", requireUser, async (req, res) => {
  const filters = { search: String(req.query.q ?? "").trim(), category: String(req.query.category ?? ""), lowOnly: req.query.low === "1" };
  const [products, categories] = await Promise.all([stock.listProducts(filters), stock.categories()]);
  page(req, res, { title: "Products", active: "products", body: productsPage({ products, categories, filters }) });
});

app.get("/products/new", requireUser, async (req, res) => {
  page(req, res, { title: "New product", active: "products", body: productForm({ categories: await stock.categories() }) });
});

app.post("/products", requireUser, async (req, res) => {
  try {
    const product = await stock.createProduct(req.body, req.user.email);
    res.flash("ok", `Created ${product.sku}`);
    res.redirect(`/products/${product.id}`);
  } catch (err) {
    res.flash("error", err.message);
    res.redirect("/products/new");
  }
});

app.get("/products/:id", requireUser, async (req, res) => {
  const product = await stock.getProduct(req.params.id);
  if (!product) return res.status(404).send(layout({ title: "Not found", user: req.user, body: "<h1>No such product</h1>" }));
  const movements = await stock.listMovements({ productId: product.id, limit: 50 });
  page(req, res, { title: product.name, active: "products", body: productPage({ product, movements, user: req.user }) });
});

app.get("/products/:id/edit", requireUser, async (req, res) => {
  const product = await stock.getProduct(req.params.id);
  if (!product) return res.redirect("/products");
  page(req, res, { title: `Edit ${product.sku}`, active: "products", body: productForm({ product, categories: await stock.categories() }) });
});

app.post("/products/:id/edit", requireUser, async (req, res) => {
  try {
    await stock.updateProduct(req.params.id, req.body);
    res.flash("ok", "Saved");
  } catch (err) {
    res.flash("error", err.message);
  }
  res.redirect(`/products/${req.params.id}`);
});

app.post("/products/:id/move", requireUser, async (req, res) => {
  try {
    const product = await stock.move(req.params.id, req.body, req.user.email);
    res.flash("ok", `${product.sku}: now ${product.quantity} ${product.unit}`);
  } catch (err) {
    res.flash("error", err.message);
  }
  res.redirect(`/products/${req.params.id}`);
});

app.post("/products/:id/delete", requireUser, async (req, res) => {
  if (req.user.role !== "owner") {
    res.flash("error", "Only the owner can delete products");
    return res.redirect(`/products/${req.params.id}`);
  }
  try {
    const product = await stock.deleteProduct(req.params.id);
    res.flash("ok", `Deleted ${product.sku}`);
    res.redirect("/products");
  } catch (err) {
    res.flash("error", err.message);
    res.redirect("/products");
  }
});

app.get("/movements", requireUser, async (req, res) => {
  page(req, res, { title: "Movements", active: "movements", body: movementsPage({ movements: await stock.listMovements({ limit: 200 }) }) });
});

app.get("/health", async (_req, res) => {
  res.json({ ok: await denis.ping().catch(() => false) });
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).send(layout({ title: "Error", user: req.user, body: `<h1>Something went wrong</h1><p class="lead">${err.message}</p>` }));
});

// ------------------------------------------------------------------- start

export async function start(port = Number(process.env.PORT || 4100)) {
  await migrate();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`Stockroom on http://localhost:${port} (${process.env.DENIS_API_KEY ? "Denis Cloud" : "Denis over TCP"})`);
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  start();
}

export { app };
