import test from "node:test";
import assert from "node:assert/strict";

/**
 * End-to-end against a running Denis (TCP: DENIS_HOST/PORT/GROUP/PASSWORD,
 * or Cloud: DENIS_API_KEY). Skipped without either, like the client's own
 * integration tests.
 */
const configured = Boolean(process.env.DENIS_API_KEY || (process.env.DENIS_GROUP && process.env.DENIS_PASSWORD));

test("register, sign in, create a product, move stock, read the overview", { skip: !configured && "set DENIS_* to run" }, async () => {
  const { start } = await import("../src/server.js");
  const { denis } = await import("../src/denis.js");
  const server = await start(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const call = async (path, body, redirectOk = true) => {
    const res = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? new URLSearchParams(body).toString() : undefined,
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const [name] = pair.split("=");
      cookie = cookie.split("; ").filter((x) => x && !x.startsWith(name + "=")).concat(pair.endsWith("=") ? [] : [pair]).join("; ");
    }
    if (redirectOk && res.status >= 300 && res.status < 400) return { status: res.status, location: res.headers.get("location"), text: "" };
    return { status: res.status, location: null, text: await res.text() };
  };

  try {
    const email = `t${Date.now()}@example.com`;
    // anonymous -> login
    let r = await call("/products");
    assert.equal(r.status, 302);
    // register + session cookie
    r = await call("/register", { email, name: "Test", password: "test-pass-123" });
    assert.equal(r.status, 302);
    assert.ok(cookie.includes("inv_session="));
    // wrong password is refused
    const saved = cookie;
    cookie = "";
    r = await call("/login", { email, password: "nope-nope-nope" });
    assert.equal(r.location, "/login");
    cookie = saved;
    // product
    const sku = `T-${Date.now().toString(36).toUpperCase()}`;
    r = await call("/products", { sku, name: "Test widget", category: "Test", unit: "pcs", quantity: "10", minQuantity: "3", price: "2.5" });
    assert.match(r.location, /^\/products\/\d+$/);
    const id = r.location.split("/").pop();
    r = await call(`/products/${id}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /10 pcs/);
    // out 8 -> 2, which is below the minimum
    r = await call(`/products/${id}/move`, { kind: "out", quantity: "8", note: "sold" });
    r = await call(`/products/${id}`);
    assert.match(r.text, /color:var\(--red\)">2<\/span>/);
    // out more than in stock is refused
    r = await call(`/products/${id}/move`, { kind: "out", quantity: "5" });
    r = await call(`/products/${id}`);
    assert.match(r.text, /Only 2 pcs in stock/);
    // overview lists it under low stock, one QUERY round trip
    r = await call("/");
    assert.match(r.text, new RegExp(sku));
    // the data really is in Denis
    assert.equal(await denis.exists(`user:${email}`), true);
    const rows = await denis.query(`SELECT quantity FROM products WHERE sku = '${sku}'`);
    assert.equal(rows[0].quantity, 2);
    // clean up
    r = await call(`/products/${id}/delete`, {});
    assert.equal(r.location, "/products");
    await denis.del(`user:${email}`);
  } finally {
    server.close();
    await denis.close();
  }
});
