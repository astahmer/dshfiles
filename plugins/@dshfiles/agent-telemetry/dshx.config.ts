import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/agent-telemetry',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
