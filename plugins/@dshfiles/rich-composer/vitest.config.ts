import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The Host serves its primitives as a platform module whose runtime dependencies are dev-only, so tests that
  // render a chip read the same props against the shared double instead.
  resolve: { alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../plugin-ui/testing/host-primitives.tsx', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'] },
})
