import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/settings-models',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  client: {
    entry: 'src/client-entry.tsx',
    shared: '@dshfiles/shared-runtime',
    // Native non-roster utilities: inline them, never add a missing browser module.
    bundleDependencies: ['@deepseek-ai/dsh-util-values', '@deepseek-ai/schemastery'],
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
