// Extends Nest's default webpack build (nest-cli.json "webpack": true) with the CLI entry points, so they run with
// the same compiled decorators and DI metadata as the API. @wms/domain (../shared/wms-domain) is resolved through
// tsconfig "paths" and bundled; everything in node_modules stays external.

module.exports = (options) => ({
  ...options,
  entry: {
    main: options.entry,
    "cli/export-openapi": "./src/cli/export-openapi.ts",
    "cli/list-public-routes": "./src/cli/list-public-routes.ts",
  },
  output: { ...options.output, filename: "[name].js" },
});
