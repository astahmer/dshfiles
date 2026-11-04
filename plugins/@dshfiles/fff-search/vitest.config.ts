import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The Host suite mounts a real Host and spawns the index worker; a second resident fork on a small CI runner makes
    // vitest report "Worker exited unexpectedly". One fork, one file at a time, is the lowest-memory shape.
    fileParallelism: false,
    maxWorkers: 1,
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
