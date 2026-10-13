import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // bench/ holds node:test fixtures and acceptance checks that run inside scratch benchmark projects, not here.
    exclude: [...configDefaults.exclude, 'bench/**'],
  },
})
