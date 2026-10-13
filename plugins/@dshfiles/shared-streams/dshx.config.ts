import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/shared-streams',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
