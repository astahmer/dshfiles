import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/bash-parallel',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})