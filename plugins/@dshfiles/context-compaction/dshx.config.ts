import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/context-compaction',
  host: { entry: 'src/host.ts' },

  build: {
    sourcemap: true,
    declarations: true,
  },
})
