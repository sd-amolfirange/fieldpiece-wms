import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";
import tseslint from "typescript-eslint";

// Type-checked rules, module boundaries, no floating promises, no unsafe raw SQL, no console.

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "node_modules",
      "var",
      "test-results",
      "prisma/migrations",
      // Separate package with its own lint config (the mock server the frontend's unit tests use).
      "demo-server",
      // Playwright config run from ../frontend (checked by Playwright itself).
      "test/ui",
      "eslint.config.mjs",
      "jest.config.js",
      "webpack.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { boundaries },
    settings: {
      "boundaries/include": ["src/**/*.ts"],
      "boundaries/elements": [
        { type: "module", pattern: "src/modules/*", mode: "folder", capture: ["name"] },
        { type: "domain", pattern: "src/domain", mode: "folder" },
        { type: "common", pattern: "src/common", mode: "folder" },
        { type: "infra", pattern: "src/infra", mode: "folder" },
        { type: "config", pattern: "src/config", mode: "folder" },
        { type: "app", pattern: "src/*.ts", mode: "file" },
        { type: "cli", pattern: "src/cli", mode: "folder" },
      ],
      "import/resolver": { typescript: { alwaysTryTypes: true }, node: true },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Nest decorators and DI need classes whose methods don't use `this`; that's fine.
      "@typescript-eslint/no-extraneous-class": "off",
      // Allow `void promise` for fire-and-forget on Fastify replies.
      "no-void": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]",
          message: "Use the tagged $queryRaw / $executeRaw templates. Unsafe raw SQL is banned.",
        },
      ],
      // Layers only depend downwards; modules talk to each other through their index.ts.
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "config", allow: ["config", "common"] },
            { from: "common", allow: ["common", "config", "infra"] },
            { from: "infra", allow: ["infra", "common", "config"] },
            { from: "domain", allow: ["domain", "common"] },
            { from: "module", allow: ["module", "domain", "common", "infra", "config"] },
            { from: "app", allow: ["app", "module", "common", "infra", "config"] },
            { from: "cli", allow: ["app", "common", "config"] },
          ],
        },
      ],
      "boundaries/entry-point": [
        "error",
        {
          default: "disallow",
          rules: [
            { target: ["common", "domain", "infra", "config", "app", "cli"], allow: "**" },
            { target: ["module"], allow: "index.ts" },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.spec.ts", "**/__tests__/**", "test/**", "prisma/**"],
    rules: {
      "boundaries/entry-point": "off",
      "boundaries/element-types": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
