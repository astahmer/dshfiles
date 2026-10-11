import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/workspace-folder-picker',
  client: { entry: 'src/client.tsx', vite: { plugins: [pluginUiVite()] } },
  build: {
    sourcemap: true,
    declarations: true,
    minify: true,
  },
})
