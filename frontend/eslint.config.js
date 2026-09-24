import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// Section 14: colours always come from tokens. Blocks raw hex values in class names and strings.
const RAW_HEX = "#[0-9a-fA-F]{3,8}\\b";
const HEX_MESSAGE = "Use a design token (e.g. bg-brand-500) instead of a raw hex colour.";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "playwright-report", "test-results", "public/mockServiceWorker.js"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=/${RAW_HEX}/]`, message: HEX_MESSAGE },
        { selector: `TemplateElement[value.raw=/${RAW_HEX}/]`, message: HEX_MESSAGE },
      ],
    },
  },
  {
    // Section 14: no default exports, except route pages.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/features/*/pages/**", "src/app/pages/**"],
    rules: {
      "no-restricted-exports": [
        "error",
        { restrictDefaultExports: { direct: true, named: true, defaultFrom: true, namedFrom: true } },
      ],
    },
  },
  {
    // Section 2.3: a feature must not reach into another feature's internals.
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/*"],
              message:
                "Don't import another feature's internals. Move shared code into components/, lib/ or types/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/**/pages/**", "src/app/**", "src/test/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // Fixtures, the demo seed and tests index into arrays they just built; non-null assertions are fine here.
    files: ["src/mocks/**", "src/demo-core/seed.ts", "src/**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["*.config.{js,ts}", "e2e/**"],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright fixtures use a `use()` callback that isn't a React hook.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
);
