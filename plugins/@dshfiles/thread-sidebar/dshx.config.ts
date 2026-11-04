import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/thread-sidebar',
  host: { entry: 'src/host.ts' },
  client: { entry: 'src/client-entry.tsx', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  // Other plugins read the same attention records through this contract, ask the Host to settle a thread
  // through auto-settle-api, and thread-listing plugins share the Host snapshot selectors.
  modules: {
    'attention-api': 'src/attention-api.ts',
    'auto-settle-api': 'src/auto-settle-api.ts',
    'thread-actions-api': 'src/thread-actions-api.ts',
    'attention-client': 'src/attention-client.ts',
    'thread-views-api': 'src/thread-views-api.ts',
    snapshots: 'src/snapshots.ts',
    'thread-mention': 'src/thread-mention.ts',
    // The shell's rail destinations and the section registry plugins add their pages to (plans/ade-ux §4.2).
    destinations: 'src/destinations.ts',
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
