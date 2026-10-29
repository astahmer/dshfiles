import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/backlog',
  modules: { api: 'src/api.ts', settings: 'src/settings.ts' },
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/credential-port', '@dshfiles/usage', '@dshfiles/tweet-context'] },
  client: { entry: 'src/client-entry.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
