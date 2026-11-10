import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/context-compaction',
  modules: { 'compaction-api': 'src/compaction-api.ts' },
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts' },

  build: {
    sourcemap: true,
    declarations: true,
  },
})
