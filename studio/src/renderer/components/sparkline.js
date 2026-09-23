/**
 * Inline SVG sparkline (no chart library). Keeps the last N samples.
 */
import { svg, h } from "../util/dom.js";

export class Sparkline {
  /**
   * @param {{label: string, capacity?: number, width?: number, height?: number, format?: (v:number)=>string, min?: number}} o
   */
  constructor(o) {
    this.o = { capacity: 60, width: 240, height: 48, format: (v) => String(v), ...o };
    this.values = [];
    this.path = svg("path", { class: "spark-line", fill: "none" });
    this.area = svg("path", { class: "spark-area" });
    this.svg = svg(
      "svg",
      { viewBox: `0 0 ${this.o.width} ${this.o.height}`, preserveAspectRatio: "none", class: "sparkline", role: "img", "aria-label": this.o.label },
      this.area,
      this.path,
    );
    this.caption = h("div", { class: "spark-caption" });
    this.el = h("figure", { class: "spark" }, this.svg, this.caption);
  }

  push(value) {
    const v = Number(value);
    this.values.push(Number.isFinite(v) ? v : 0);
    if (this.values.length > this.o.capacity) this.values.shift();
    this.render();
  }

  reset() {
    this.values = [];
    this.render();
  }

  render() {
    const { width, height, capacity } = this.o;
    const vals = this.values;
    const last = vals[vals.length - 1];
    if (vals.length < 2) {
      this.path.setAttribute("d", "");
      this.area.setAttribute("d", "");
      this.caption.textContent = vals.length ? `${this.o.label}: now ${this.o.format(last)} (collecting…)` : "";
      return;
    }
    const max = Math.max(...vals);
    const min = this.o.min !== undefined ? Math.min(this.o.min, ...vals) : Math.min(...vals);
    // a flat series is drawn in the middle instead of on the floor
    const flat = max === min;
    const span = flat ? 1 : max - min;
    const step = width / Math.max(1, capacity - 1);
    const offset = (capacity - vals.length) * step;
    const pad = 3;
    const pts = vals.map((v, i) => [offset + i * step, flat ? height / 2 : pad + (height - 2 * pad) * (1 - (v - min) / span)]);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    this.path.setAttribute("d", line);
    this.area.setAttribute("d", `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`);
    this.caption.textContent = `${this.o.label}: now ${this.o.format(last)} · min ${this.o.format(Math.min(...vals))} · max ${this.o.format(max)}`;
    this.svg.setAttribute("aria-label", this.caption.textContent);
  }
}
