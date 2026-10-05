import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/project-checks',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client.tsx' },
  build: { sourcemap: true, declarations: true },
})
