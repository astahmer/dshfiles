import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/tweet-context',
  modules: { 'backlog-api': 'src/backlog-api.ts' },
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
