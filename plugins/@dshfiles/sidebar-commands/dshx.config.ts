import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/sidebar-commands',
  client: { entry: 'src/client.ts' },
  build: { sourcemap: true, declarations: true },
})
