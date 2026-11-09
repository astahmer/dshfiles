import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/settings-web-search',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client-entry.tsx', shared: '@dshfiles/shared-runtime' },
  build: { sourcemap: true, declarations: true, minify: true },
})
