import { ClientTools, defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/client/index.js'
import { SidepanelClientTools } from './sidepanel-client-tools.js'

export default defineClient({
  name: '@dshfiles/sidebar-right',
  inject,
  setup(ctx, _decorate, metadata) {
    apply(ctx)
    // The guide's pages and the panel's open-by-kind path, offered to Agents as client tools; a bridge plugin carries
    // the calls. Read through the services apply just provided, so the native fork's body stays untouched.
    for (const tool of SidepanelClientTools.create({
      pages: () => (ctx.get('sidebarRightTabs')?.guide() ?? []).map(box => ({ kind: box.kind, title: box.title(), description: box.description?.() })),
      onScreen: () => ctx.get('sidebarRight')?.mounted.getSnapshot(),
      open: kind => ctx.get('sidebarRight')?.openTab(kind, { revealIfOpened: true }),
    }))
      metadata?.plugin?.add(ClientTools, tool)
  },
})
