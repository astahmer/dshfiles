import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/hmr-gate',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx', shared: '@dshfiles/shared-runtime' },
  build: { sourcemap: true, declarations: true, minify: true },
})
