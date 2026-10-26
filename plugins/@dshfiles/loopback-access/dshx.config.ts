import { defineConfig } from '@dshfiles/dshx'
import { pluginUiVite } from '@dshfiles/plugin-ui/vite'

export default defineConfig({
  name: '@dshfiles/loopback-access',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  modules: { startup: 'src/startup.ts', 'terminal-output': 'src/terminal-output.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
