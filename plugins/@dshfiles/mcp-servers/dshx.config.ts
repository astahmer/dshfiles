import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/mcp-servers',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/credential-port', '@dshfiles/plugin-ui'] },
  client: {
    entry: 'src/client.tsx',
    dshxRuntime: 'shared',
    shared: '@dshfiles/shared-runtime',
    bundleDependencies: ['@dshfiles/credential-port'],
    vite: { plugins: [pluginUiVite()] },
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
