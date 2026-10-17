import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/workspace-folder-picker',
  modules: { 'directory-browser-api': 'src/directory-browser-api.ts' },
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', vite: { plugins: [pluginUiVite()] } },
  build: {
    sourcemap: true,
    declarations: true,
    minify: true,
  },
})
