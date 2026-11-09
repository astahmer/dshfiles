import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/memory',
  host: {
    dshxRuntime: 'snapshot',
    entry: 'src/host.ts',
    bundleDependencies: [
      '@dshfiles/optmem-core',
      '@dshfiles/ai-accounts',
      '@dshfiles/credential-port',
      '@dshfiles/usage',
      '@dshfiles/jev',
      '@dshfiles/sqlite-store',
    ],
  },
  client: { entry: 'src/client-entry.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  modules: { api: 'src/api.ts', 'workspace-scripts-api': 'src/workspace-scripts-api.ts' },
  build: { sourcemap: true, declarations: false, minify: true },
})
