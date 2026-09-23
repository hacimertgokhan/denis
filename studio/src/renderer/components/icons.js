/**
 * Inline SVG icons (24x24, stroke based). Decorative: aria-hidden.
 */
import { svg } from "../util/dom.js";

const PATHS = {
  plug: ["M9 2v6", "M15 2v6", "M6 8h12v3a6 6 0 0 1-12 0z", "M12 17v5"],
  gauge: ["M12 14l4-4", "M3.5 18a9 9 0 1 1 17 0", "M12 14m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"],
  folder: ["M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  key: ["M14 10m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "M11 13l-8 8", "M5 19l2 2", "M7 17l2 2"],
  table: ["M3 5h18v14H3z", "M3 10h18", "M3 15h18", "M9 5v14"],
  archive: ["M3 4h18v4H3z", "M5 8v11h14V8", "M10 12h4"],
  terminal: ["M4 5h16v14H4z", "M7 9l3 3-3 3", "M12 15h5"],
  gear: ["M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M12 2v3", "M12 19v3", "M2 12h3", "M19 12h3", "M4.9 4.9l2.1 2.1", "M17 17l2.1 2.1", "M4.9 19.1L7 17", "M17 7l2.1-2.1"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  refresh: ["M20 11a8 8 0 0 0-14.6-4.5L4 8", "M4 4v4h4", "M4 13a8 8 0 0 0 14.6 4.5L20 16", "M20 20v-4h-4"],
  plus: ["M12 5v14", "M5 12h14"],
  play: ["M7 4l13 8-13 8z"],
  download: ["M12 3v12", "M7 10l5 5 5-5", "M4 19h16"],
  upload: ["M12 21V9", "M7 14l5-5 5 5", "M4 5h16"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  check: ["M5 12l5 5 9-10"],
  edit: ["M4 20h4L19 9l-4-4L4 16z", "M13 7l4 4"],
  clock: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 7v5l3 2"],
  search: ["M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M21 21l-5-5"],
  save: ["M5 3h11l3 3v15H5z", "M8 3v5h8V3", "M8 21v-7h8v7"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  unlink: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7", "M3 3l18 18"],
  bolt: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  shield: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"],
  window: ["M3 5h18v14H3z", "M3 9h18"],
  info: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 11v6", "M12 7.5v.5"],
  alert: ["M12 3l10 18H2z", "M12 10v5", "M12 18v.5"],
  history: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5", "M12 7v5l3 2"],
  explain: ["M4 6h16", "M4 12h10", "M4 18h6", "M17 15l3 3-3 3"],
};

export function icon(name, { size = 18, label } = {}) {
  const paths = PATHS[name] || PATHS.info;
  const el = svg(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.8,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "icon",
      "aria-hidden": label ? undefined : "true",
      role: label ? "img" : undefined,
      "aria-label": label,
      focusable: "false",
    },
    ...paths.map((d) => svg("path", { d })),
  );
  return el;
}
