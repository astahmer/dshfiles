import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'
import { monacoSingleChunk } from './monaco-vite.ts'

export default defineConfig({
  name: '@dshfiles/editor',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  modules: { 'artifacts-api': 'src/artifacts-api.ts' },
  client: {
    entry: 'src/client-entry.tsx',
    dshxRuntime: 'shared',
    shared: '@dshfiles/shared-runtime',
    vite: { plugins: [pluginUiVite(), monacoSingleChunk()] },
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
