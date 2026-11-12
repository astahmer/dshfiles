import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/phone-access',
  // The edge contract phone-pairing (and any other claimer) imports; it imports no claimer.
  modules: { 'edge-api': 'src/edge-api.ts' },
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@nuintun/qrcode'] },
  build: { sourcemap: true, declarations: true, minify: false },
})
