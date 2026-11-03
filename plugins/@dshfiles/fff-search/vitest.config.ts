import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The Host suite mounts a real Host and spawns the index worker; running it beside the unit file doubles peak
    // memory and the CI runner (4 GB) kills the worker when both are resident.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
