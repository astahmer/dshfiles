import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/subprocess-local',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, minify: false },
})
