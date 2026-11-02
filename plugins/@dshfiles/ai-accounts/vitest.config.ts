import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The characterization suites mount the whole Host on a real Cordis runtime, and several older tests import the
    // account store cold. Under parallel load those imports outlast the 5s default, which is a timeout, not a failure.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
