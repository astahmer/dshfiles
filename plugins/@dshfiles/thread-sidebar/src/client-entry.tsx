import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelMetadata, SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { SidebarRoot, type FooterSnapshot, type SidebarShellBaseProps } from './sidebar-shell.js'
import { ThreadSidebar } from './client.js'
import { sidebarChildren } from './sidebar-contract.js'
import {
  THREAD_SIDEBAR_LOCALE_NAMESPACE,
  threadSidebarLocale,
} from './locales.js'
import { archiveWithoutStopping } from './organization.js'

export default defineClient({
  name: '@dshfiles/thread-sidebar',
  locales: [threadSidebarLocale],
  setup(ctx) {
    const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
    const syncPanels = (): void => {
      const next = ctx.slots.entriesOfSlot('sidebar.panellist').flatMap(({ options }) => {
        const id = options.id
        if (id === undefined) return []
        // SlotCore erases MainPanelId when exposing its heterogeneous entry ledger.
        const panelId = id as MainPanelId
        return {
          id: panelId,
          order: options.order ?? 0,
          label: resolveSlotLabel(options.label) ?? id,
        } satisfies SidebarPanelMetadata
      }).sort((left, right) => left.order - right.order)
      const previous = panels.getSnapshot()
      if (previous.length === next.length && previous.every((panel, index) => {
        const candidate = next[index]
        return panel.id === candidate?.id && panel.order === candidate.order && panel.label === candidate.label
      })) return
      panels.set(next)
    }

    const readFooterSnapshot = (): FooterSnapshot => {
      const settings = ctx.slots.entriesOfSlot('sidebar.settings')[0]
      return {
        settingsId: settings === undefined ? null : 'settings',
        actions: ctx.slots.entriesOfSlot('sidebar.footer.action').flatMap(({ options }) => {
          const id = options.id
          if (id === undefined) return []
          return [{
            id,
            order: options.order ?? 0,
            label: resolveSlotLabel(options.label) ?? id,
          }]
        }),
      }
    }
    const subscribeFooterSnapshot = (listener: () => void): (() => void) => {
      const unsubscribe = [
        ctx.slots.subscribe('sidebar.settings', listener),
        ctx.slots.subscribe('sidebar.footer.action', listener),
        ctx.locale.subscribe(listener),
      ]
      return () => unsubscribe.forEach(stop => stop())
    }

    ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', syncPanels), 'thread-sidebar: panel links')
    ctx.effect(() => ctx.locale.subscribe(syncPanels), 'thread-sidebar: panel labels')
    syncPanels()

    const rootProps = (): SidebarRootInjected => ({
      startSession: workspaceId => ctx.uiWorkspace.startSession(workspaceId),
      toggleSidebar: () => ctx.layout.toggleSidebar(),
      selectPanel: id => ctx.layout.selectPanel(id),
      hooks: {
        panels,
        shortcuts: ctx.shortcuts.catalog,
      },
    })

    const SidebarRootAdapter = (props: SidebarShellBaseProps): JSX.Element => (
      <SidebarRoot
        {...props}
        readFooterSnapshot={readFooterSnapshot}
        subscribeFooterSnapshot={subscribeFooterSnapshot}
      />
    )

    ctx.slots.inject('sidebar', () => ctx.slots.register(
      {
        name: 'sidebar',
        registrant: '@dshfiles/thread-sidebar',
        priority: -1000,
        locale: THREAD_SIDEBAR_LOCALE_NAMESPACE,
        children: sidebarChildren,
        inject: rootProps,
      },
      SidebarRootAdapter,
    ))

    ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
      {
        name: 'sidebar.workspaces',
        registrant: '@dshfiles/thread-sidebar',
        priority: -1000,
        locale: 'workspace',
        inject: () => ({
          tSidebar: ctx.locale.bind(THREAD_SIDEBAR_LOCALE_NAMESPACE),
          archiveSession: (sessionId: SessionSummary['id']) =>
            archiveWithoutStopping(
              (targetId, options) => ctx.workspaces.archiveSession(targetId, options),
              sessionId,
            ),
          unarchiveSession: (sessionId: SessionSummary['id']) => ctx.workspaces.unarchiveSession(sessionId),
          pinSession: (sessionId: SessionSummary['id']) => ctx.workspaces.pinSession(sessionId),
          unpinSession: (sessionId: SessionSummary['id']) => ctx.workspaces.unpinSession(sessionId),
          open: (sessionId: SessionSummary['id']) => ctx.uiWorkspace.openSession(sessionId),
        }),
      },
      ThreadSidebar,
    ))
  },
})
