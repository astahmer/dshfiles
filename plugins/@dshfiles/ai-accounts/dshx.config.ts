import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/ai-accounts',
  profile: 'vanilla',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx' },
  build: { sourcemap: true, declarations: true },
})
