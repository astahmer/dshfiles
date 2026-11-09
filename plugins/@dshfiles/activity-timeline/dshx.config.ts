import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/activity-timeline',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  modules: { 'attention-api': 'src/attention-api.ts', 'attention-openers': 'src/attention-openers.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
