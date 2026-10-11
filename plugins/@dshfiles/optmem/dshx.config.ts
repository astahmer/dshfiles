import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/optmem',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/optmem-core', '@dshfiles/optmem-sqlite'] },
  client: { entry: 'src/client-entry.tsx', vite: { plugins: [pluginUiVite()] } },
  build: { sourcemap: true, declarations: false, minify: true },
})
