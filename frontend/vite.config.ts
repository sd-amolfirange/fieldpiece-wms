/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const vendorChunks: [string, string[]][] = [
  ["react", ["react", "react-dom", "react-router", "react-router-dom", "scheduler"]],
  ["query", ["@tanstack/react-query", "@tanstack/react-table", "axios", "zustand"]],
  ["radix", ["@radix-ui/*"]],
  ["forms", ["react-hook-form", "@hookform/resolvers", "zod", "react-dropzone"]],
  ["i18n", ["i18next", "react-i18next", "date-fns"]],
  ["charts", ["recharts", "d3-*", "victory-vendor"]],
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173 },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks so app deploys don't bust the whole cache.
        manualChunks: (id: string) => {
          const pkg = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)?.[1]?.replace("\\", "/");
          if (!pkg) return undefined;
          return vendorChunks.find(([, pkgs]) =>
            pkgs.some((p) => (p.endsWith("*") ? pkg.startsWith(p.slice(0, -1)) : pkg === p)),
          )?.[0];
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/mocks/**", "src/test/**", "src/**/*.test.{ts,tsx}"],
      // Section 13: 90% on transitions, warranty maths and formatters.
      thresholds: {
        "src/features/claims/transitions.ts": { lines: 90, functions: 90, branches: 90 },
        "src/lib/warranty.ts": { lines: 90, functions: 90, branches: 90 },
        "src/lib/format.ts": { lines: 90, functions: 90, branches: 90 },
      },
    },
  },
});
