import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['support/scratch-host-lifecycle.test.ts'],
    testTimeout: 30_000,
  },
})
