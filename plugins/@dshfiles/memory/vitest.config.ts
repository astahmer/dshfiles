import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests never read or write the live DSH home: every default path resolves under a scratch directory.
    env: { DSH_HOME: join(tmpdir(), 'dshfiles-memory-tests-home') },
    // bench/ holds node scripts run against a scratch DSH or a synthetic corpus, not unit tests.
    // *.scale.test.ts asserts wall-clock budgets that only hold on an idle machine; `test:scale` runs them.
    exclude: [...configDefaults.exclude, 'bench/**', ...(process.env.MEMORY_SCALE_TESTS === '1' ? [] : ['src/**/*.scale.test.ts'])],
  },
})
