import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { JJ_CONFIG: '' },
    testTimeout: 30_000,
  },
})
