import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    testTimeout: 30_000,
  },
})
