import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The Host serves dsh-client-ui-primitives to the page; tests use the kit's stand-in instead of its full icon barrel.
export default defineConfig({
  test: {
    alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../plugin-ui/testing/host-primitives.tsx', import.meta.url)) },
  },
})
