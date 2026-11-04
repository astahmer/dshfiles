import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/pull-requests',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/jj-cli'] },
  build: { sourcemap: true, declarations: true },
})
