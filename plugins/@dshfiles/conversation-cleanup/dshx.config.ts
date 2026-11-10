import { defineConfig } from '@dshfiles/dshx'
import { pluginUiVite } from '@dshfiles/plugin-ui/vite'

export default defineConfig({
  name: '@dshfiles/conversation-cleanup',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
