import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/secret-catalog',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/credential-port'] },
  client: {
    entry: 'src/client.tsx',
    shared: '@dshfiles/shared-runtime',
    bundleDependencies: ['@dshfiles/credential-port'],
    vite: { plugins: [pluginUiVite()] },
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
