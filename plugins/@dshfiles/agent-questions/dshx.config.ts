import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/agent-questions',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
