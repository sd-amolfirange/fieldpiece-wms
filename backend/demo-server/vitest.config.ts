import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // src/seed-parity.test.ts imports the backend's seed, whose `@wms/domain` import only resolves through the
  // backend's tsconfig paths: point it at the same shared package.
  resolve: {
    alias: {
      "@wms/domain": fileURLToPath(new URL("../../shared/wms-domain/src/index.ts", import.meta.url)),
    },
  },
  test: { globals: true, include: ["src/**/*.test.ts"] },
});
