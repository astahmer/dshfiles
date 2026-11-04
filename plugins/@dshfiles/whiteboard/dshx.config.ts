import { defineConfig } from '@dshfiles/dshx'
import { pluginUiVite } from '@dshfiles/plugin-ui/vite'

export default defineConfig({
  name: '@dshfiles/whiteboard',
  modules: { api: 'src/api.ts' },
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/sqlite-store'] },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true },
})
