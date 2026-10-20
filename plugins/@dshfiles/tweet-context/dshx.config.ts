import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/tweet-context',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
