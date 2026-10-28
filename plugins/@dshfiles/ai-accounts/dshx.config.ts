import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/ai-accounts',
  profile: 'vanilla',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/session-controller'] },
  modules: {
    'account-login-api': 'src/account-login-api.ts',
    'account-session-api': 'src/account-session-api.ts',
    'model-fallback-api': 'src/model-fallback-api.ts',
    'model-fast-mode-api': 'src/model-fast-mode-api.ts',
    'thread-account-api': 'src/thread-account-api.ts',
  },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
