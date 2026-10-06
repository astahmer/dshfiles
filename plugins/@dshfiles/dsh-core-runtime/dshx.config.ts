import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/dsh-core-runtime',
  host: { entry: 'src/host.ts' },
  profile: 'vanilla',
  build: { declarations: true },
})
