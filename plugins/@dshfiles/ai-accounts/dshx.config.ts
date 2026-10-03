import { defineConfig } from '@becomeopc/dshx'

export default defineConfig({
  name: '@dshfiles/ai-accounts',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx' },
  build: { sourcemap: true, declarations: true },
})
