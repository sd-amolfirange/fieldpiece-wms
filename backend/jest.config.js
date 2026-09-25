/** @type {import('jest').Config} */
const swc = [
  "@swc/jest",
  {
    jsc: {
      parser: { syntax: "typescript", decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: "es2022",
    },
    module: { type: "commonjs" },
  },
];

// shared/wms-domain is TypeScript source (ESM syntax); map it and let swc compile it like our own files. Its own
// imports (date-fns) resolve from this package's node_modules, even when shared/ has none installed.
const moduleNameMapper = {
  "^@wms/domain$": "<rootDir>/../shared/wms-domain/src/index.ts",
  "^date-fns$": "<rootDir>/node_modules/date-fns/index.cjs",
};
const transform = { "^.+\\.ts$": swc };

module.exports = {
  projects: [
    {
      displayName: "unit",
      testEnvironment: "node",
      roots: ["<rootDir>/src"],
      testMatch: ["**/*.spec.ts"],
      moduleNameMapper,
      transform,
    },
    {
      displayName: "e2e",
      testEnvironment: "node",
      roots: ["<rootDir>/test"],
      testMatch: ["**/*.e2e-spec.ts"],
      moduleNameMapper,
      transform,
      globalSetup: "<rootDir>/test/setup/global-setup.ts",
    },
  ],
  testTimeout: 30000,
  collectCoverageFrom: ["src/domain/**/*.ts", "src/common/**/*.ts", "src/modules/**/*.ts", "!src/**/index.ts"],
};
