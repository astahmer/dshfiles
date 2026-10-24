import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/traces',
  // The thread-sidebar attention contract is bundled so a profile without that plugin still loads; calls then report owner-missing.
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/thread-sidebar'] },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: true, minify: true },
})
