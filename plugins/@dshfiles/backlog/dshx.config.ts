import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/backlog',
  modules: {
    api: 'src/api.ts',
    settings: 'src/settings.ts',
    'secret-link-reveal': 'src/secret-link-reveal.tsx',
    // The provider port other plugins serve (`backlog-provider` Host API) to add a sync source.
    'backlog-provider': 'src/provider-port.ts',
  },
  host: {
    entry: 'src/host.ts',
    bundleDependencies: [
      '@dshfiles/credential-port',
      '@dshfiles/sqlite-store',
      '@dshfiles/usage',
      '@dshfiles/tweet-context',
      '@dshfiles/vcs-provider-port',
      '@dshfiles/jev',
      '@dshfiles/jj-cli',
    ],
  },
  client: { entry: 'src/client-entry.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
