import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/tool-search',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
