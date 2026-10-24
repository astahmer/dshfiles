import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/loopback-access',
  host: { entry: 'src/host.ts' },
  client: false,
  build: { sourcemap: true, declarations: true, minify: true },
})
