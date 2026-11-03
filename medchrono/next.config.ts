import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile).
  output: "standalone",
  // pdf-lib and the Anthropic SDK run only in the API route; keep them out of the client bundle.
  serverExternalPackages: ["pdf-lib"],
  turbopack: { root: path.resolve(import.meta.dirname) },
};

export default nextConfig;
