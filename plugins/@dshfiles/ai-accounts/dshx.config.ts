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
    'usage-overview-model': 'src/usage-overview-model.ts',
    'thread-account-api': 'src/thread-account-api.ts',
    'account-usage-view': 'src/account-usage-view.tsx',
    'codex-credential': 'src/codex-credential.ts',
    // Usage › Quota: the quota views ai-accounts provides and the navigation usage provides (one way: usage → ai-accounts).
    'quota-views': 'src/quota-views.tsx',
  },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
