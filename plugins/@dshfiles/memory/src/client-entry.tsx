import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'

import { MemoryPanel } from './memory-panel.tsx'
import { MemoryFocusModel } from './memory-focus.ts'
import { installMemoryReferenceLinks } from './memory-reference-links.ts'
import { MemoryReferenceOverlay } from './memory-reference-overlay.tsx'
import './client.css'

const PANEL_ID = 'dshfiles-memory-panel'

export default defineClient({
  name: '@dshfiles/memory',
  inject: ['slots', 'sessions', 'uiWorkspace', 'layout'],
  setup(ctx, decorate) {
    ctx.effect(() => installMemoryReferenceLinks(), 'memory reference links')
    const PanelView = (): JSX.Element => (
      <PluginQueryProvider>
        <MemoryPanel
          openThread={sessionId => {
            const session = Object.values(ctx.sessions.list.getSnapshot().byId).find(candidate => candidate.id === sessionId)
            if (session !== undefined) ctx.uiWorkspace.openSession(session.id)
          }}
        />
      </PluginQueryProvider>
    )
    const ReferenceOverlay = (): JSX.Element => (
      <PluginQueryProvider>
        <MemoryReferenceOverlay
          openInMemory={focus => {
            MemoryFocusModel.request(focus)
            ctx.layout.selectPanel(PANEL_ID as MainPanelId)
          }}
        />
      </PluginQueryProvider>
    )
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 4, label: 'Memory' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, decorate(PanelView)))
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'dshfiles-memory-reference-preview', order: 120 }, decorate(ReferenceOverlay)),
    )
  },
})

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M8 9h8M8 12.5h5M8 16h6" />
  </svg>
)
