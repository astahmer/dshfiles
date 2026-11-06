import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['support/scratch-host-lifecycle.test.ts', 'support/boot-executable.test.ts', 'support/boot-seed.test.ts', 'support/chromium-options.test.ts'],
    testTimeout: 30_000,
    // These specs mock the Host; the real orphan sweep a worker's first boot runs belongs to journeys, not to them.
    env: { DSHX_SCRATCH_SWEEP: '0' },
  },
})
