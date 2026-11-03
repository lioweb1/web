import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-lib and the Anthropic SDK run only in the API route; keep them out of the client bundle.
  serverExternalPackages: ["pdf-lib"],
};

export default nextConfig;
