import { pluginUiVite } from '@dshfiles/plugin-ui/vite'
import { defineConfig } from '@dshfiles/dshx'

export default defineConfig({
  name: '@dshfiles/thread-sidebar',
  host: { dshxRuntime: 'snapshot', entry: 'src/host.ts', bundleDependencies: ['@dshfiles/vcs-provider-port'] },
  client: { entry: 'src/client-entry.tsx', dshxRuntime: 'shared', shared: '@dshfiles/shared-runtime', vite: { plugins: [pluginUiVite()] } },
  // Other plugins read the same attention records through this contract, ask the Host to settle a thread
  // through auto-settle-api, thread-listing plugins share the Host snapshot selectors, and thread-row-actions
  // lets other plugins add rows to a thread's context menu.
  modules: {
    'attention-api': 'src/attention-api.ts',
    'auto-settle-api': 'src/auto-settle-api.ts',
    'thread-actions-api': 'src/thread-actions-api.ts',
    'attention-client': 'src/attention-client.ts',
    'thread-views-api': 'src/thread-views-api.ts',
    snapshots: 'src/snapshots.ts',
    'thread-mention': 'src/thread-mention.ts',
    // The shell's rail destinations and the section registry plugins add their pages to (docs/ade-ux §4.2).
    destinations: 'src/destinations.ts',
    'thread-row-actions': 'src/thread-row-actions.ts',
    // Sections other plugins add to the thread header's ⋯ menu (b:ysaj: linked backlog items).
    'thread-menu-sections': 'src/thread-menu-sections.ts',
    // Updates other plugins know only a Host restart applies, shown in thread-sidebar's one restart status item.
    'restart-sources': 'src/restart-sources.ts',
    // A picker gesture in another plugin asks the sidebar's fan-out dialog to open with its models preselected.
    'fan-out-request': 'src/fan-out-request.ts',
    // Plugins that group by project resolve a thread workspace (custom threads directory included) to its project.
    'thread-directories': 'src/thread-directories.ts',
  },
  build: { sourcemap: true, declarations: true, minify: true },
})
