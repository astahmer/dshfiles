import { defineConfig } from '@becomeopc/dshx'

export default defineConfig({
  name: '@dshfiles/ai-accounts',
  host: { entry: 'src/host.ts' },
  build: { sourcemap: true, declarations: true },
})
