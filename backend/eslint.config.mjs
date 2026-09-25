import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";
import tseslint from "typescript-eslint";

// Section 15: type-checked rules, module boundaries, no floating promises, no $queryRawUnsafe, no console.

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "node_modules", "prisma/migrations", "eslint.config.mjs", "jest.config.js"],
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
        { type: "common", pattern: "src/common", mode: "folder" },
        { type: "infra", pattern: "src/infra", mode: "folder" },
        { type: "config", pattern: "src/config", mode: "folder" },
        { type: "worker", pattern: "src/worker", mode: "folder" },
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
          message:
            "Use the tagged $queryRaw / $executeRaw templates. Unsafe raw SQL is banned (Section 11.2).",
        },
      ],
      // Section 3.2: layers only depend downwards; modules talk to each other through their index.ts.
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "config", allow: ["config", "common"] },
            { from: "common", allow: ["common", "config", "infra"] },
            { from: "infra", allow: ["infra", "common", "config"] },
            { from: "module", allow: ["module", "common", "infra", "config"] },
            { from: "worker", allow: ["worker", "module", "common", "infra", "config"] },
            { from: "app", allow: ["app", "module", "common", "infra", "config", "worker"] },
            { from: "cli", allow: ["app", "common", "config"] },
          ],
        },
      ],
      "boundaries/entry-point": [
        "error",
        {
          default: "disallow",
          rules: [
            { target: ["common", "infra", "config", "worker", "app", "cli"], allow: "**" },
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
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
