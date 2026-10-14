import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // bench/ holds node scripts run against a scratch DSH or a synthetic corpus, not unit tests.
    // *.scale.test.ts asserts wall-clock budgets that only hold on an idle machine; `test:scale` runs them.
    exclude: [...configDefaults.exclude, 'bench/**', ...(process.env.MEMORY_SCALE_TESTS === '1' ? [] : ['src/**/*.scale.test.ts'])],
  },
})
