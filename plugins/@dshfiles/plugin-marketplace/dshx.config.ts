import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', vite: { plugins: [pluginUiVite()] } },
  build: {
    sourcemap: true,
    declarations: true,
  },
})
