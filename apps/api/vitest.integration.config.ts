/**
 * Vitest configuration for integration tests using @cloudflare/vitest-pool-workers.
 *
 * These tests run inside the workerd runtime with real Cloudflare bindings.
 * Use `bun test:integration` to run these tests.
 */
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "path";

const apiRoot = resolve(__dirname);

export default defineWorkersConfig({
  test: {
    // Use the Cloudflare Workers pool
    pool: "@cloudflare/vitest-pool-workers",

    // Root directory for tests - relative to this config file
    root: apiRoot,

    // Only run vitest integration files (relative to root)
    // Uses .vitest.ts extension to avoid bun test picking them up
    include: ["src/**/*.vitest.ts"],

    poolOptions: {
      workers: {
        // Main worker entry point (relative to root)
        main: "./src/index.ts",

        // Isolated storage causes cleanup issues with DO SQLite
        // See: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage
        isolatedStorage: false,

        // Use wrangler.toml for bindings configuration (relative to root)
        wrangler: {
          configPath: "./wrangler.toml",
        },

        // Miniflare options for test environment
        miniflare: {
          // D1 migrations will be applied automatically
          // Additional configuration can go here
        },
      },
    },
  },
});
