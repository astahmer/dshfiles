import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { InlineReferences } from '@dshfiles/chat/inline-references'
import { defineClient } from '@dshfiles/dshx/client'
import { EntityKinds, type EntityPreviewProps } from '@dshfiles/input-trigger/entity-registry'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { useCallback, useSyncExternalStore } from 'react'

import { MemoryPanel } from './memory-panel.tsx'
import { MemoryFocusModel } from './memory-focus.ts'
import { MemoryInlineReference } from './memory-reference-links.tsx'
import { MemoryReferenceModel } from './memory-reference.ts'
import { MemoryReferencePreview } from './memory-reference-preview.tsx'
import './client.css'

const PANEL_ID = 'dshfiles-memory-panel'

export default defineClient({
  name: '@dshfiles/memory',
  inject: ['slots', 'sessions', 'uiWorkspace', 'layout', 'workspaces', 'uiConversation'],
  setup(ctx, decorate, metadata) {
    metadata?.plugin?.add(InlineReferences, MemoryInlineReference.reference)
    ctx.effect(() => ctx.uiConversation.userText.register(MemoryInlineReference.userTextRule), 'memory: sent citations link')
    ctx.slots.inject('conversation.user.text.node', () =>
      ctx.slots.register({ name: 'conversation.user.text.node', key: 'memory', priority: 100 }, MemoryInlineReference.UserTextLink),
    )
    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (panelId: string): panelId is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === panelId)
    const openThread = (sessionId: string): void => {
      const session = Object.values(ctx.sessions.list.getSnapshot().byId).find(candidate => candidate.id === sessionId)
      if (session !== undefined) ctx.uiWorkspace.openSession(session.id)
    }
    const PanelView = (): JSX.Element => {
      const subscribe = useCallback((listener: () => void) => ctx.workspaces.list.subscribe(listener), [])
      const readWorkspaces = useCallback(() => ctx.workspaces.list.getSnapshot().items, [])
      const workspaces = useSyncExternalStore(subscribe, readWorkspaces, readWorkspaces)
      const projectPaths = EntityLabels.projectsOf(workspaces).map(workspace => workspace.path)
      return (
        <PluginQueryProvider>
          <MemoryPanel openThread={openThread} projectPaths={projectPaths} />
        </PluginQueryProvider>
      )
    }
    const ReferencePreview = (props: EntityPreviewProps): JSX.Element => (
      <PluginQueryProvider>
        <MemoryReferencePreview
          id={props.id}
          range={props.range}
          close={props.close}
          openThread={openThread}
          openInMemory={focus => {
            MemoryFocusModel.request(focus)
            if (isMainPanelId(PANEL_ID)) ctx.layout.selectPanel(PANEL_ID)
          }}
        />
      </PluginQueryProvider>
    )
    // Chat's inline references render `memory: n:3` citations as links; the entity registry draws their card in the one
    // shared reference preview.
    metadata?.plugin?.add(EntityKinds, {
      kind: MemoryReferenceModel.entityKind,
      label: 'Memory',
      order: 50,
      Preview: decorate(ReferencePreview),
      previewWidth: request => (request.range === undefined ? 'default' : 'wide'),
    })
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 4, label: 'Memory' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, decorate(PanelView)))
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
