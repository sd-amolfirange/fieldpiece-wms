/** @type {import('jest').Config} */
const swc = [
  "@swc/jest",
  {
    jsc: {
      parser: { syntax: "typescript", decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: "es2022",
    },
  },
];

module.exports = {
  projects: [
    {
      displayName: "unit",
      testEnvironment: "node",
      roots: ["<rootDir>/src"],
      testMatch: ["**/*.spec.ts"],
      transform: { "^.+\\.ts$": swc },
    },
    {
      displayName: "e2e",
      testEnvironment: "node",
      roots: ["<rootDir>/test"],
      testMatch: ["**/*.e2e-spec.ts"],
      transform: { "^.+\\.ts$": swc },
      globalSetup: "<rootDir>/test/setup/global-setup.ts",
    },
  ],
  testTimeout: 30000,
  // Section 13.1: >= 90% lines on engines and state machines.
  collectCoverageFrom: [
    "src/**/*.engine.ts",
    "src/**/*state-machine.ts",
    "src/common/time/**/*.ts",
    "src/common/auth/scope.ts",
  ],
  coverageThreshold: { global: { lines: 90, branches: 85, functions: 90 } },
};
