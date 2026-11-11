import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The native primitives package needs the browser bundle's dependencies; the kit's host stand-ins render the same roles.
export default defineConfig({
  resolve: {
    alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../plugin-ui/testing/host-primitives.tsx', import.meta.url)) },
  },
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
})
