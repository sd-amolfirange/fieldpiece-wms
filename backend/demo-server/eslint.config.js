import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "data", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ["**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The server never reaches into the frontend.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/frontend/**"],
              message: "The server must not import from frontend/.",
            },
          ],
        },
      ],
    },
  },
  {
    // Seed data and tests index into arrays they just built.
    files: ["src/core/seed.ts", "**/*.test.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
