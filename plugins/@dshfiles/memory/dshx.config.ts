import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/memory',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/optmem-core', '@dshfiles/ai-accounts', '@dshfiles/credential-port', '@dshfiles/usage'] },
  client: { entry: 'src/client-entry.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: false, minify: true },
})
