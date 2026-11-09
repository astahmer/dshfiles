import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/storage-domain',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  build: { sourcemap: true, minify: false },
})
