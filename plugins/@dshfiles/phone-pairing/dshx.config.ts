import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/phone-pairing',
  host: { dshxRuntime: 'snapshot', entry: 'src/index.ts' },
  build: { sourcemap: true, declarations: true, minify: false },
})
