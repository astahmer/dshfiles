import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/tool-search',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
