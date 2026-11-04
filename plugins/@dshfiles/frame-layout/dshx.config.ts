import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/frame-layout',
  host: { entry: 'src/native/index.ts' },
  client: { entry: 'src/client-entry.tsx' },
  // Public frame seats (including shell.main's authorized keyed renderer):
  // occupants import the SlotMap, owner props and observable mode contract here.
  // The status strip registry (plans/ade-ux §4.1 R5): plugins add at most one item each.
  modules: { regions: 'src/regions.ts', 'status-strip': 'src/status-strip.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
