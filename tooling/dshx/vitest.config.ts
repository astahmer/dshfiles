import { defineConfig } from 'vitest/config'

// Mirror packages/dshx/vitest.config.ts so running vitest from this root —
// which does not discover the package config — keeps the negotiated timeouts
// and worker budget instead of falling back to 5s defaults.
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    maxWorkers: 4,
    testTimeout: 90_000,
  },
})
