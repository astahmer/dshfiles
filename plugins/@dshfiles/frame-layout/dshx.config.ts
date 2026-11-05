import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/frame-layout',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client-entry.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  // Public frame seats (including shell.main's authorized keyed renderer):
  // occupants import the SlotMap, owner props and observable mode contract here.
  // The status strip registry (plans/ade-ux §4.1 R5): plugins add at most one item each.
  modules: { regions: 'src/regions.ts', 'status-strip': 'src/status-strip.ts' },
  build: { sourcemap: true, declarations: true, minify: true },
})
