import { defineConfig } from '@dshfiles/dshx'
import { pluginUiVite } from '@dshfiles/plugin-ui/vite'

export default defineConfig({
  name: '@dshfiles/resource-packs',
  modules: { api: 'src/api.ts', model: 'src/model.ts' },
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true },
})
