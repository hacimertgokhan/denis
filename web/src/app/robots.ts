import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://denis.hacimertgokhan.com";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/databases", "/usage", "/settings", "/admin", "/db/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
