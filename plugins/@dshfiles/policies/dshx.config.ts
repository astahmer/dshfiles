import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/policies',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
