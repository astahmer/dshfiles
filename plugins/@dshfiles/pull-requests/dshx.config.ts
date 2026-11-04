import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/pull-requests',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
