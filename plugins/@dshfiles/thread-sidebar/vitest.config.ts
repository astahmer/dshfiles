import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// react-dom is installed for the shared UI kit only; the render test borrows it
// (same pnpm react@18.3.1 instance) instead of adding a dependency here.
export default defineConfig({
  test: {
    alias: {
      'react-dom/server': fileURLToPath(new URL('../plugin-ui/node_modules/react-dom/server.node.js', import.meta.url)),
    },
  },
})
