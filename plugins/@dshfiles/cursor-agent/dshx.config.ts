import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/cursor-agent',
  host: { entry: 'src/host.ts' },
  build: {
    sourcemap: true,
    declarations: true,
  },
})
