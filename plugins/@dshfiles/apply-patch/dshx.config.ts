import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/apply-patch',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
