import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@megan/core": resolve(import.meta.dirname, "./packages/core/src"),
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/**/src/**/*.test.ts", "workers/**/src/**/*.test.ts", "mobile/src/**/*.test.ts"],
  },
});
