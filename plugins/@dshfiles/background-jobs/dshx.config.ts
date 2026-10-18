import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/background-jobs',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/usage'] },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
