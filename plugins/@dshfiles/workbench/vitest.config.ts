import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { dockviewCssVite } from './dockview-css-vite.ts'

export default defineConfig({
  plugins: [dockviewCssVite()],
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../plugin-ui/testing/host-primitives.tsx', import.meta.url)),
    },
  },
  test: { environment: 'jsdom' },
})
