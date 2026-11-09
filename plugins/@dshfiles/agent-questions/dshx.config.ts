import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/agent-questions',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.ts', shared: '@dshfiles/shared-runtime' },
  build: { sourcemap: true, declarations: true, minify: true },
})
