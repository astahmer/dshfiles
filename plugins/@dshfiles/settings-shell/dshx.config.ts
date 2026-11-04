import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/settings-shell',
  host: { entry: 'src/host.ts' },
  // The settings contract: backlog, memory and Secret Catalog read the one Jev key from this namespace.
  modules: { settings: 'src/settings.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
