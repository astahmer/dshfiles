import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // This suite drives real `jj` processes: a single test can add workspaces,
    // commit, submit and run a full integration twice. The 5s default is a
    // timeout, not a failure signal, and it fires under parallel load.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
