import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/multi-host',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client-entry.tsx', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true },
})
