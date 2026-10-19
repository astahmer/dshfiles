import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/frame-layout',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client-entry.tsx' },
  // The `shell.dock` seat's contract: a dock plugin registers into the frame's
  // right column through this module's SlotMap declaration.
  modules: { regions: 'src/regions.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
