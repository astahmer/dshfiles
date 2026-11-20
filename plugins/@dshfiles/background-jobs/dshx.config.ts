import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/background-jobs',
  // Observe › Processes: the tab registry worktree-memory and preview add to (one way: they depend on background-jobs).
  // running-threads: which threads own a running job, for a thread list to read.
  modules: { 'process-views': 'src/process-views.ts', 'running-threads': 'src/running-threads.ts' },
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/usage'] },
  client: { entry: 'src/client.tsx', dshxRuntime: 'shared', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
