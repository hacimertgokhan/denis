import { denis, nextId, q } from "./denis.js";

/**
 * Products and stock movements. A product's quantity is the running total;
 * every change is also written as a movement (in, out, adjust) so the
 * history explains the number.
 */
const KINDS = new Set(["in", "out", "adjust"]);

export async function listProducts({ search = "", category = "", lowOnly = false } = {}) {
  const where = [];
  if (search) where.push(`(name LIKE ${q("%" + search + "%")} OR sku LIKE ${q("%" + search + "%")})`);
  if (category) where.push(`category = ${q(category)}`);
  const rows = await denis.query(`SELECT * FROM inv_products${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY name ASC LIMIT 500`);
  return lowOnly ? rows.filter((p) => p.quantity <= p.min_quantity) : rows;
}

export async function getProduct(id) {
  const rows = await denis.query(`SELECT * FROM inv_products WHERE id = ${Number(id)} LIMIT 1`);
  return rows[0] ?? null;
}

export async function findBySku(sku) {
  const rows = await denis.query(`SELECT * FROM inv_products WHERE sku = ${q(sku)} LIMIT 1`);
  return rows[0] ?? null;
}

export async function createProduct({ sku, name, category, unit, quantity, minQuantity, price }, actor) {
  sku = String(sku).trim().toUpperCase();
  name = String(name).trim();
  if (!sku || !name) throw new Error("SKU and name are required");
  if (await findBySku(sku)) throw new Error(`SKU ${sku} already exists`);
  const id = await nextId("product");
  const qty = Math.max(0, Number(quantity) || 0);
  await denis.execute(
    `INSERT INTO inv_products (id, sku, name, category, unit, quantity, min_quantity, price, updated_at) VALUES (${id}, ${q(sku)}, ${q(name)}, ${q(category || "General")}, ${q(unit || "pcs")}, ${qty}, ${Math.max(0, Number(minQuantity) || 0)}, ${Number(price) || 0}, ${q(new Date().toISOString())})`,
  );
  if (qty > 0) await recordMovement({ productId: id, sku, kind: "in", quantity: qty, note: "opening stock" }, actor);
  return getProduct(id);
}

export async function updateProduct(id, { name, category, unit, minQuantity, price }) {
  const product = await getProduct(id);
  if (!product) throw new Error("Product not found");
  await denis.execute(
    `UPDATE inv_products SET name = ${q(String(name).trim() || product.name)}, category = ${q(category || product.category)}, unit = ${q(unit || product.unit)}, min_quantity = ${Math.max(0, Number(minQuantity) || 0)}, price = ${Number(price) || 0}, updated_at = ${q(new Date().toISOString())} WHERE id = ${Number(id)}`,
  );
  return getProduct(id);
}

export async function deleteProduct(id) {
  const product = await getProduct(id);
  if (!product) throw new Error("Product not found");
  await denis.execute(`DELETE FROM inv_movements WHERE product_id = ${Number(id)}`);
  await denis.execute(`DELETE FROM inv_products WHERE id = ${Number(id)}`);
  return product;
}

/** kind: in (+qty), out (-qty, never below zero), adjust (set to qty). */
export async function move(id, { kind, quantity, note }, actor) {
  if (!KINDS.has(kind)) throw new Error("kind must be in, out or adjust");
  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Quantity must be a whole number");
  const product = await getProduct(id);
  if (!product) throw new Error("Product not found");
  let next = product.quantity;
  if (kind === "in") next += amount;
  if (kind === "out") {
    if (amount > product.quantity) throw new Error(`Only ${product.quantity} ${product.unit} in stock`);
    next -= amount;
  }
  if (kind === "adjust") next = amount;
  await denis.execute(`UPDATE inv_products SET quantity = ${next}, updated_at = ${q(new Date().toISOString())} WHERE id = ${Number(id)}`);
  await recordMovement({ productId: product.id, sku: product.sku, kind, quantity: kind === "adjust" ? next - product.quantity : amount, note }, actor);
  return getProduct(id);
}

async function recordMovement({ productId, sku, kind, quantity, note }, actor) {
  const id = await nextId("movement");
  await denis.execute(
    `INSERT INTO inv_movements (id, product_id, sku, kind, quantity, note, actor, created_at) VALUES (${id}, ${Number(productId)}, ${q(sku)}, ${q(kind)}, ${Number(quantity)}, ${q(String(note || "").trim().slice(0, 200))}, ${q(actor)}, ${q(new Date().toISOString())})`,
  );
}

export async function listMovements({ productId = null, limit = 100 } = {}) {
  const where = productId ? ` WHERE product_id = ${Number(productId)}` : "";
  return denis.query(`SELECT * FROM inv_movements${where} ORDER BY id DESC LIMIT ${Math.min(500, Math.max(1, Number(limit)))}`);
}

/** The dashboard in one round trip: counts, every product for the totals, the latest movements. */
export async function overview() {
  const { data } = await denis.graph(`{
    products: count("inv_products")
    movements: count("inv_movements")
    stock: table("inv_products") { id sku name quantity min_quantity unit price }
    recent: table("inv_movements", order: "id desc", limit: 8) { id sku kind quantity note actor created_at }
  }`);
  const stock = data.stock ?? [];
  // the engine compares a column with a value, not with another column, so low stock is decided here
  const low = stock.filter((p) => Number(p.quantity) <= Number(p.min_quantity)).sort((a, b) => a.quantity - b.quantity).slice(0, 10);
  const value = stock.reduce((sum, p) => sum + Number(p.quantity) * Number(p.price), 0);
  return { products: data.products ?? 0, movements: data.movements ?? 0, low, recent: data.recent ?? [], value };
}

export async function categories() {
  const rows = await denis.query("SELECT category FROM inv_products LIMIT 500");
  return [...new Set(rows.map((r) => r.category))].sort();
}
