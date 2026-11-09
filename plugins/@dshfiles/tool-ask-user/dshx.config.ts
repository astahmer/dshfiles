import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/tool-ask-user',
  host: { dshxRuntime: 'snapshot', entry: 'src/native/index.ts' },
  build: { sourcemap: true, declarations: true, minify: false },
})
