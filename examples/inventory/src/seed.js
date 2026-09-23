import { denis, migrate } from "./denis.js";
import * as stock from "./stock.js";

/** A handful of products so the pages have something to show. Safe to run twice: existing SKUs are skipped. */
const SAMPLE = [
  ["PEN-001", "Ballpoint pen, black", "Office", "pcs", 240, 50, 0.45],
  ["PEN-002", "Ballpoint pen, blue", "Office", "pcs", 12, 50, 0.45],
  ["PAP-A4", "Copy paper A4, 500 sheets", "Office", "ream", 36, 10, 4.9],
  ["MUG-01", "Ceramic mug 300 ml", "Kitchen", "pcs", 8, 12, 3.2],
  ["CBL-USBC", "USB-C cable 1 m", "Electronics", "pcs", 0, 5, 6.5],
  ["BAG-TOTE", "Cotton tote bag", "Merch", "pcs", 75, 20, 2.1],
];

await migrate();
for (const [sku, name, category, unit, quantity, minQuantity, price] of SAMPLE) {
  if (await stock.findBySku(sku)) {
    console.log("skip", sku);
    continue;
  }
  await stock.createProduct({ sku, name, category, unit, quantity, minQuantity, price }, "seed");
  console.log("added", sku);
}
await denis.close();
