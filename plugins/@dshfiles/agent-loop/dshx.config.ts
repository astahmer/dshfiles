import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/agent-loop',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, minify: false },
})
