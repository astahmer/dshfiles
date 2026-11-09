import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/references',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },
  // The Host API contract, so another plugin reads attached references without restating its schemas.
  modules: { api: 'src/api.ts' },
  build: { sourcemap: true, declarations: true },
})
