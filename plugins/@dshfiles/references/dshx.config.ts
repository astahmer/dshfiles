import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/references',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
