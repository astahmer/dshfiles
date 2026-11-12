import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/turn-summary',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/chat'] },
  client: { entry: 'src/client-entry.tsx', dshxRuntime: 'shared', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
