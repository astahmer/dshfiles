import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/optmem',
  host: { entry: 'src/host.ts', bundleDependencies: ['@dshfiles/optmem-core', '@dshfiles/optmem-sqlite'] },
  build: { sourcemap: true, declarations: false, minify: false },
})
