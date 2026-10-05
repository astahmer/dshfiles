import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/prompt-stash',
  profile: 'vanilla',
  client: { entry: 'src/client-entry.tsx' },
  build: { sourcemap: true, declarations: true },
})
