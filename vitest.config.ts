import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: {
    alias: { "@": resolve("apps/web/src"), "@game": resolve("game") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Database and game-balance suites are memory intensive on this machine.
    maxWorkers: 1,
  },
});
