import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for the Docker image (see Dockerfile).
  output: "standalone",
  // The Node client lives in the monorepo (../clients/node) and is linked in
  // with `file:`; the root must include it for Turbopack and file tracing.
  turbopack: { root: path.join(__dirname, "..") },
  outputFileTracingRoot: path.join(__dirname, ".."),
  serverExternalPackages: ["denis-client", "postgres"],
};

export default nextConfig;
