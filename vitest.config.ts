import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    // `npm run test:live` runs only the real Gemma integration test; `npm test` never needs credentials.
    include: process.env.LIVE ? ["tests/**/*.live.ts"] : ["tests/**/*.test.ts"],
  },
});
