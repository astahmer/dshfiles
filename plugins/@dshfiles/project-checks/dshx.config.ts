import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/project-checks',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/session-log-window', '@dshfiles/sqlite-store'] },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  modules: { api: 'src/api.ts', 'completion-event': 'src/completion-event.ts', 'workspace-setup': 'src/workspace-setup.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
