import type { NextConfig } from "next";

// FixTrail is a live operations app: every page reads per-request data, so Cache Components stays off.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
