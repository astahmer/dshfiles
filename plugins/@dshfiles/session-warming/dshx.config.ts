import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/session-warming',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
