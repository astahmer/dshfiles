import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/model-selection',
  host: { entry: 'src/host.ts' },
  client: {
    entry: 'src/client-entry.tsx',
    // Native non-roster utility: inline it, never add a missing browser module.
    bundleDependencies: ['@deepseek-ai/dsh-util-values'],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
