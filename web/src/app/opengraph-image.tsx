import { ImageResponse } from "next/og";

export const alt = "Denis Cloud — a database you talk to one line at a time";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share card: the tagline on black, one line of the protocol underneath. */
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#000000",
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#969393" }}>
        <span>Denis Cloud</span>
        <span>denis.hacimertgokhan.com</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 84, fontWeight: 500, letterSpacing: -3, lineHeight: 1.02, maxWidth: 980 }}>A database you talk to one line at a time.</div>
        <div style={{ marginTop: 32, fontSize: 30, color: "#c9c7c7", maxWidth: 980, lineHeight: 1.4 }}>
          Keys and small tables in memory, journaled to disk. REST, Node.js and a hosted MCP endpoint for AI assistants. Free.
        </div>
      </div>
      <div style={{ display: "flex", gap: 24, fontSize: 26, fontFamily: "monospace", color: "#969393" }}>
        <span style={{ color: "#c9c7c7" }}>&gt;</span>
        <span>SET greeting hello world -&amp;save</span>
        <span style={{ color: "#5c5959" }}>{'{"ok":true}'}</span>
      </div>
    </div>,
    size,
  );
}
