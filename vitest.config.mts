import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The "@/…" imports of tsconfig.json.
      "@": at("./src"),
      // "server-only" refuses to load outside Next: the tests swap it for nothing.
      "server-only": at("./test/server-only.ts"),
    },
  },
});
