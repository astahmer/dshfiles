import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/settings-search',
  client: { entry: 'src/client.tsx' },
  build: { sourcemap: true, declarations: true },
})
