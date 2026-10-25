import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/goal-tool',
  host: { entry: 'src/host.ts', bundleDependencies: ['zod'] },
  build: { sourcemap: true, declarations: true, minify: false },
})
