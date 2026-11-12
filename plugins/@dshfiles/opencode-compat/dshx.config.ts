import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/opencode-compat',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
