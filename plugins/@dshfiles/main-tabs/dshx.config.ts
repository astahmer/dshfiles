import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/main-tabs',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  modules: { 'workbench-tabs': 'src/workbench-tabs.ts', 'tabs-contract': 'src/tabs-contract.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
