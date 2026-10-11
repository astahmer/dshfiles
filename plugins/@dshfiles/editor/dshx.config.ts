import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'
import { monacoSingleChunk } from './monaco-vite.ts'

export default defineConfig({
  name: '@dshfiles/editor',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client-entry.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite(), monacoSingleChunk()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
