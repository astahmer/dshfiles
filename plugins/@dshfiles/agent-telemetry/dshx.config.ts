import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/agent-telemetry',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/ai-accounts'] },
  build: { sourcemap: true, declarations: true },
})
