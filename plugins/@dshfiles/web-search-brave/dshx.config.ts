import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/web-search-brave',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/credential-port'] },
  build: { sourcemap: true, declarations: true },
})
