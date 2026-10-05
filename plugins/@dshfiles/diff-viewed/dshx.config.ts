import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/diff-viewed',
  client: { entry: 'src/client.tsx' },
  build: { sourcemap: true, declarations: true },
})
