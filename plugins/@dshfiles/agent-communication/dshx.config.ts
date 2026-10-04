import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/agent-communication',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
