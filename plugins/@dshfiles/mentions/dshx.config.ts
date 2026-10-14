import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/mentions',
  profile: 'vanilla',
  client: { entry: 'src/client-entry.ts', shared: '@dshfiles/shared-runtime' },
  build: { sourcemap: true, declarations: true, minify: true },
})
