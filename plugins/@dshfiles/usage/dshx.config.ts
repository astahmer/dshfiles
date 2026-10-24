import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/usage',
  // The background-jobs board indexes the same session logs; this module is the one frame reader.
  modules: { api: 'src/api.ts', 'request-log': 'src/request-log.tsx', 'session-log': 'src/session-log.ts' },
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/ai-accounts', '@dshfiles/credential-port'] },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
