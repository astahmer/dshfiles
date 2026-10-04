import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    maxWorkers: 4,
    // Scaffold and toolchain tests run real builds against real package trees and
    // need 10-15s each. At 20s they flake whenever the suite runs in parallel.
    testTimeout: 90_000,
  },
})
