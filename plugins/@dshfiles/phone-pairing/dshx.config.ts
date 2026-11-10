import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/phone-pairing',
  modules: { contract: 'src/contract.ts' },
  host: { dshxRuntime: 'snapshot', entry: 'src/index.ts' },
  client: {
    entry: 'src/client.tsx',
    dshxRuntime: 'shared',
    shared: '@dshfiles/shared-runtime',
    bundleDependencies: ['@nuintun/qrcode'],
    vite: { plugins: [pluginUiVite()] },
  },
  build: { sourcemap: true, declarations: true, minify: false },
})
