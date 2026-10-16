import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/thread-sidebar',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client-entry.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  // Other plugins read the same attention records through this contract.
  modules: { 'attention-api': 'src/attention-api.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
