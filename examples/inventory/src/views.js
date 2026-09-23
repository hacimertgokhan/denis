/**
 * Server-rendered pages: one layout, a few page functions, no client
 * framework. Every value is escaped on the way into the markup.
 */
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const money = (n) => Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

const CSS = `
:root{--ink:#000;--ash:#5c5959;--line:#d9d7d7;--bg:#fff;--soft:#f4f3f3;--red:#b42318}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
a{color:inherit}header{border-bottom:1px solid var(--line)}header .in{max-width:1100px;margin:0 auto;padding:0 20px;height:56px;display:flex;align-items:center;gap:20px}
header .brand{font-weight:600;text-decoration:none;display:flex;align-items:center;gap:10px}header .mark{width:22px;height:22px;border-radius:6px;background:var(--ink);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
header nav{display:flex;gap:4px}header nav a{padding:6px 10px;border-radius:6px;text-decoration:none;color:var(--ash)}header nav a.on,header nav a:hover{color:var(--ink);background:var(--soft)}header .me{margin-left:auto;color:var(--ash);font-size:13px;display:flex;gap:12px;align-items:center}
main{max-width:1100px;margin:0 auto;padding:28px 20px 60px}h1{font-size:24px;margin:0 0 4px;letter-spacing:-.01em}.lead{color:var(--ash);margin:0 0 24px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:28px}.stats>div{padding:16px 18px;border-right:1px solid var(--line)}.stats>div:last-child{border-right:0}.stats b{display:block;font-size:26px;font-weight:600;margin-top:2px}.stats span{color:var(--ash);font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}@media(max-width:800px){.grid{grid-template-columns:1fr}.stats>div{border-right:0;border-bottom:1px solid var(--line)}}
h2{font-size:15px;margin:0 0 10px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{color:var(--ash);font-weight:500;font-size:12.5px}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.card{border:1px solid var(--line);border-radius:10px;overflow:hidden}.card table th{background:var(--soft)}.card .empty{padding:28px;text-align:center;color:var(--ash)}
form.row{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:16px}label{display:grid;gap:4px;font-size:12.5px;color:var(--ash)}input,select,textarea{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;min-width:0}input:focus,select:focus{outline:2px solid #000;outline-offset:1px}
button,.btn{font:inherit;font-weight:500;padding:8px 14px;border-radius:6px;border:1px solid var(--ink);background:var(--ink);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}.btn.quiet,button.quiet{background:#fff;color:var(--ink)}button.danger{border-color:var(--red);background:var(--red)}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;border:1px solid var(--line)}.pill.low{border-color:var(--red);color:var(--red)}.pill.in{background:var(--soft)}
.flash{padding:10px 14px;border:1px solid var(--line);border-radius:8px;margin-bottom:18px;font-size:14px}.flash.error{border-color:var(--red);color:var(--red)}
.auth{max-width:380px;margin:60px auto}.auth form{display:grid;gap:12px}.auth .muted{color:var(--ash);font-size:13.5px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
footer{max-width:1100px;margin:0 auto;padding:0 20px 30px;color:var(--ash);font-size:12.5px}
`;

export function layout({ title, user, flash, active = "", body }) {
  const nav = user
    ? `<nav>${[
        ["/", "Overview", "overview"],
        ["/products", "Products", "products"],
        ["/movements", "Movements", "movements"],
      ]
        .map(([href, label, key]) => `<a href="${href}" class="${active === key ? "on" : ""}">${label}</a>`)
        .join("")}</nav>
      <div class="me"><span>${esc(user.name)} · ${esc(user.role)}</span><form method="post" action="/logout"><button class="quiet" type="submit">Sign out</button></form></div>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Stockroom</title><style>${CSS}</style></head>
<body><header><div class="in"><a class="brand" href="/"><span class="mark">S</span>Stockroom</a>${nav}</div></header>
<main>${flash ? `<div class="flash ${flash.type}">${esc(flash.text)}</div>` : ""}${body}</main>
<footer>Stockroom keeps everything — accounts, sessions, products, movements — in one Denis database through <span class="mono">denis-client</span>.</footer></body></html>`;
}

export function loginPage({ mode, next = "/", firstRun = false }) {
  const register = mode === "register";
  return `<div class="auth">
    <h1>${register ? (firstRun ? "Set up Stockroom" : "Create an account") : "Sign in"}</h1>
    <p class="muted">${register ? (firstRun ? "The first account becomes the owner." : "Ask the owner if you should have one.") : "Stock, movements and low-stock alerts."}</p>
    <form method="post" action="${register ? "/register" : "/login"}?next=${encodeURIComponent(next)}">
      ${register ? `<label>Name<input name="name" autocomplete="name" placeholder="Ada Lovelace"></label>` : ""}
      <label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
      <label>Password<input name="password" type="password" required minlength="8" autocomplete="${register ? "new-password" : "current-password"}"></label>
      <button type="submit">${register ? "Create account" : "Sign in"}</button>
    </form>
    <p class="muted">${register ? `Already have one? <a href="/login">Sign in</a>` : `New here? <a href="/register">Create an account</a>`}</p>
  </div>`;
}

export function overviewPage(o) {
  return `<h1>Overview</h1><p class="lead">What is on the shelves right now.</p>
  <div class="stats">
    <div><span>Products</span><b>${o.products}</b></div>
    <div><span>Stock value</span><b>${money(o.value)}</b></div>
    <div><span>Low on stock</span><b>${o.low.length}</b></div>
    <div><span>Movements</span><b>${o.movements}</b></div>
  </div>
  <div class="grid">
    <section><h2>Low stock</h2><div class="card">${
      o.low.length
        ? `<table><tr><th>SKU</th><th>Product</th><th class="num">Qty</th><th class="num">Min</th></tr>${o.low
            .map((p) => `<tr><td class="mono"><a href="/products/${p.id}">${esc(p.sku)}</a></td><td>${esc(p.name)}</td><td class="num">${p.quantity} ${esc(p.unit)}</td><td class="num">${p.min_quantity}</td></tr>`)
            .join("")}</table>`
        : `<div class="empty">Nothing below its minimum.</div>`
    }</div></section>
    <section><h2>Latest movements</h2><div class="card">${movementRows(o.recent)}</div></section>
  </div>`;
}

export function movementRows(rows, { withProduct = true } = {}) {
  if (!rows.length) return `<div class="empty">No movements yet.</div>`;
  return `<table><tr>${withProduct ? "<th>SKU</th>" : ""}<th>Kind</th><th class="num">Qty</th><th>Note</th><th>By</th><th>When</th></tr>${rows
    .map(
      (m) =>
        `<tr>${withProduct ? `<td class="mono"><a href="/products/${m.product_id ?? ""}">${esc(m.sku)}</a></td>` : ""}<td><span class="pill ${esc(m.kind)}">${esc(m.kind)}</span></td><td class="num">${m.quantity > 0 && m.kind !== "out" ? "+" : m.kind === "out" ? "−" : ""}${Math.abs(m.quantity)}</td><td>${esc(m.note)}</td><td>${esc(m.actor)}</td><td>${when(m.created_at)}</td></tr>`,
    )
    .join("")}</table>`;
}

export function productsPage({ products, categories, filters }) {
  const opts = categories.map((c) => `<option ${filters.category === c ? "selected" : ""}>${esc(c)}</option>`).join("");
  return `<h1>Products</h1><p class="lead">${products.length} shown. Quantities change through movements, never by editing.</p>
  <form class="row" method="get" action="/products">
    <label>Search<input name="q" value="${esc(filters.search)}" placeholder="name or SKU"></label>
    <label>Category<select name="category"><option value="">All</option>${opts}</select></label>
    <label><span>&nbsp;</span><span><input type="checkbox" name="low" value="1" ${filters.lowOnly ? "checked" : ""}> Low stock only</span></label>
    <button type="submit" class="quiet">Filter</button>
    <a class="btn" href="/products/new" style="margin-left:auto">New product</a>
  </form>
  <div class="card">${
    products.length
      ? `<table><tr><th>SKU</th><th>Product</th><th>Category</th><th class="num">Qty</th><th class="num">Min</th><th class="num">Price</th><th class="num">Value</th></tr>${products
          .map(
            (p) =>
              `<tr><td class="mono"><a href="/products/${p.id}">${esc(p.sku)}</a></td><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td class="num">${p.quantity <= p.min_quantity ? `<span class="pill low">${p.quantity}</span>` : p.quantity} ${esc(p.unit)}</td><td class="num">${p.min_quantity}</td><td class="num">${money(p.price)}</td><td class="num">${money(p.quantity * p.price)}</td></tr>`,
          )
          .join("")}</table>`
      : `<div class="empty">No products match. <a href="/products/new">Add the first one</a>.</div>`
  }</div>`;
}

export function productForm({ product = null, categories }) {
  const p = product ?? { sku: "", name: "", category: "", unit: "pcs", quantity: 0, min_quantity: 0, price: 0 };
  const list = categories.map((c) => `<option value="${esc(c)}">`).join("");
  return `<h1>${product ? `Edit ${esc(product.sku)}` : "New product"}</h1><p class="lead">${product ? "Quantity is changed on the product page through a movement." : "Opening stock is recorded as the first movement."}</p>
  <form method="post" action="${product ? `/products/${product.id}/edit` : "/products"}" class="row" style="max-width:720px">
    ${product ? "" : `<label>SKU<input name="sku" required value="${esc(p.sku)}" placeholder="PEN-001" class="mono"></label>`}
    <label>Name<input name="name" required value="${esc(p.name)}" style="min-width:260px"></label>
    <label>Category<input name="category" list="cats" value="${esc(p.category)}" placeholder="General"><datalist id="cats">${list}</datalist></label>
    <label>Unit<input name="unit" value="${esc(p.unit)}" size="6"></label>
    ${product ? "" : `<label>Opening qty<input name="quantity" type="number" min="0" value="${p.quantity}" size="8"></label>`}
    <label>Minimum<input name="minQuantity" type="number" min="0" value="${p.min_quantity}" size="8"></label>
    <label>Unit price<input name="price" type="number" min="0" step="0.01" value="${p.price}" size="10"></label>
    <button type="submit">${product ? "Save" : "Create"}</button>
    <a class="btn quiet" href="${product ? `/products/${product.id}` : "/products"}">Cancel</a>
  </form>`;
}

export function productPage({ product: p, movements, user }) {
  const low = p.quantity <= p.min_quantity;
  return `<h1>${esc(p.name)} <span class="mono" style="font-weight:400;color:var(--ash);font-size:16px">${esc(p.sku)}</span></h1>
  <p class="lead">${esc(p.category)} · ${money(p.price)} per ${esc(p.unit)} · updated ${when(p.updated_at)}</p>
  <div class="stats">
    <div><span>In stock</span><b>${low ? `<span style="color:var(--red)">${p.quantity}</span>` : p.quantity} ${esc(p.unit)}</b></div>
    <div><span>Minimum</span><b>${p.min_quantity}</b></div>
    <div><span>Value</span><b>${money(p.quantity * p.price)}</b></div>
  </div>
  <div class="grid">
    <section><h2>Record a movement</h2>
      <form method="post" action="/products/${p.id}/move" class="row">
        <label>Kind<select name="kind"><option value="in">Stock in (+)</option><option value="out">Stock out (−)</option><option value="adjust">Set count to</option></select></label>
        <label>Quantity<input name="quantity" type="number" min="0" required value="1" size="8"></label>
        <label>Note<input name="note" placeholder="delivery, sale, count…" style="min-width:200px"></label>
        <button type="submit">Record</button>
      </form>
      <p style="margin-top:20px"><a class="btn quiet" href="/products/${p.id}/edit">Edit details</a>
      ${
        user.role === "owner"
          ? `<form method="post" action="/products/${p.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(p.sku)} and its history?')"><button class="danger" type="submit">Delete</button></form>`
          : ""
      }</p>
    </section>
    <section><h2>History</h2><div class="card">${movementRows(movements, { withProduct: false })}</div></section>
  </div>`;
}

export function movementsPage({ movements }) {
  return `<h1>Movements</h1><p class="lead">Every change to every product, newest first.</p><div class="card">${movementRows(movements)}</div>`;
}
