import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/goal-tool',
  host: { entry: 'src/native/index.ts', bundleDependencies: ['zod'] },
  build: { sourcemap: true, declarations: true, minify: false },
})
