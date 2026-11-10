import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/tool-meta',
  // What another plugin adds under a tool card (one way: background-jobs depends on tool-meta).
  modules: { 'tool-call-sections': 'src/tool-call-sections.ts' },
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
