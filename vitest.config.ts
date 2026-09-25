import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve "@/..." to the repo root so app-style imports work in tests.
const rootDir = fileURLToPath(new URL("./", import.meta.url)).replace(/[\\/]$/, "");

export default defineConfig({
  test: {
    // Pure logic tests need no DOM; use the fast node environment.
    environment: "node",
    include: ["**/*.test.ts"],
    // apps/worker has its own (node:test) suites and must not be run here.
    exclude: ["**/node_modules/**", "apps/worker/**", "dist/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});
