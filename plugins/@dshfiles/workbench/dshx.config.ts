import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'
import { dockviewCssVite } from './dockview-css-vite.ts'

export default defineConfig({
  name: '@dshfiles/workbench',
  modules: { registry: 'src/registry.ts', tabs: 'src/tabs.ts', 'conversation-header': 'src/conversation-header.ts' },
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite(), dockviewCssVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
