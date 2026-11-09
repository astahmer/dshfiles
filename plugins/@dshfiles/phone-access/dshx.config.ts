import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/phone-access',
  host: { entry: 'src/index.ts', bundleDependencies: ['@nuintun/qrcode'] },
  build: { sourcemap: true, declarations: true, minify: false },
})
