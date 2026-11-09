import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/web-fetch-readable',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
