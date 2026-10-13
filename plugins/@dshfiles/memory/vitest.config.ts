import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // bench/ holds node scripts run against a scratch DSH or a synthetic corpus, not unit tests.
    exclude: [...configDefaults.exclude, 'bench/**'],
  },
})
