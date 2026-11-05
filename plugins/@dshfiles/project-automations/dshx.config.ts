import { defineConfig } from '@dshfiles/dshx'
import { pluginUiVite } from '@dshfiles/plugin-ui/vite'

export default defineConfig({
  name: '@dshfiles/project-automations',
  // The contract other plugins import to create automations (the backlog's scheduled rules).
  modules: { api: 'src/automations-api.ts' },
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/session-controller', '@dshfiles/credential-port'] },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
