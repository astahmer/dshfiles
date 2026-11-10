import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// react-dom is installed for the shared UI kit only; the card tests borrow it through the same pnpm instance.
export default defineConfig({
  resolve: {
    alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../plugin-ui/testing/host-primitives.tsx', import.meta.url)) },
  },
  test: { environment: 'jsdom', setupFiles: ['./testing/dom-shims.ts'] },
})
