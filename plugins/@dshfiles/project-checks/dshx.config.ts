import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/project-checks',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  modules: { api: 'src/api.ts', 'completion-event': 'src/completion-event.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
