import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['support/scratch-host-lifecycle.test.ts', 'support/boot-executable.test.ts', 'support/chromium-options.test.ts'],
    testTimeout: 30_000,
  },
})
