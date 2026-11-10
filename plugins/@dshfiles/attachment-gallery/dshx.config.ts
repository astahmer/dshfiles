import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/attachment-gallery',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  client: { shared: '@dshfiles/shared-runtime', entry: 'src/client-entry.tsx', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
