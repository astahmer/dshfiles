import { defineConfig } from '@dshfiles/dshx'
import { pluginUiVite } from '@dshfiles/plugin-ui/vite'

export default defineConfig({
  profile: 'vanilla',
  modules: { 'model-handoff-api': 'src/model-handoff-api.ts', 'brand-mark': 'src/brand-mark.tsx' },
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', dshxRuntime: 'shared', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: {
    sourcemap: true,
    declarations: true,
    minify: true,
  },
})
