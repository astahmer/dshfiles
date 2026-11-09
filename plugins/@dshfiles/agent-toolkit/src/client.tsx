import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-host-plugin-inventory/remote'
import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { defineClient } from '@dshfiles/dshx/client'
import { LayersIcon, WrenchIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useSyncExternalStore } from 'react'
import { ContextFacet } from './context-facet.js'
import { AGENT_TOOLKIT_LOCALE_NAMESPACE, agentToolkitLocale, type AgentToolkitKey } from './locales.js'
import { sameThreadRows } from './thread-projection.js'
import { AgentToolkitPanel, type ToolkitThread } from './toolkit-panel.js'

const PANEL_ID = 'dshfiles-agent-toolkit'
const MEMORY_PANEL_ID = 'dshfiles-memory-panel'
const OPEN_SETTINGS_EVENT = 'dshfiles:open-settings'
const THREAD_OPTIONS = 30
/** The thread panel's Context facet: one page per thread. */
const CONTEXT_TAB_ID = '@dshfiles/agent-toolkit/context'
const CONTEXT_TAB_KIND = 'dshfiles-agent-toolkit-context'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'dshfiles-agent-toolkit-context': Record<string, never>
  }
}

const ContextGlyph = (props: { readonly size?: number | undefined }): JSX.Element => <LayersIcon aria-hidden size={props.size ?? 18} strokeWidth={1.6} />

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => <WrenchIcon aria-hidden size={props.size ?? 18} strokeWidth={1.6} />

export default defineClient({
  name: '@dshfiles/agent-toolkit',
  locales: [agentToolkitLocale],
  inject: ['slots', 'layout', 'sessions', 'remote', 'remote.pluginInventory', 'sidebarRight', 'sidebarRightTabs'],
  setup(ctx, decorate, metadata) {
    const t = (key: AgentToolkitKey, params?: Record<string, string | number>): string => ctx.locale.bind(AGENT_TOOLKIT_LOCALE_NAMESPACE)(key, params)

    // The page shows the thread it was opened about: the palette's thread, else the last one the main view showed.
    const focusedThread = createSnapshotStore<string | null>(null)
    ctx.effect(() => {
      const follow = (): void => {
        const snapshot = ctx.sessions.list.getSnapshot()
        const shown = snapshot.ids.find(id => {
          const row = snapshot.byId[id]
          return row !== undefined && !row.blank && (row.retainedBy.mainView ?? 0) > 0
        })
        if (shown !== undefined && shown !== focusedThread.getSnapshot()) focusedThread.set(shown)
      }
      follow()
      return ctx.sessions.list.subscribe(follow)
    }, 'agent-toolkit: follow the main view thread')

    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (panelId: string): panelId is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === panelId)
    const openPanel = (panelId: string): void => {
      if (isMainPanelId(panelId)) ctx.layout.selectPanel(panelId)
    }

    const Panel = decorate((props: PropsRuntime<'main'>) => {
      const threadId = useSyncExternalStore(focusedThread.subscribe, focusedThread.getSnapshot)
      const threads = props.useSessions(
        state =>
          state.ids
            .flatMap(id => state.byId[id] ?? [])
            .filter(session => !session.blank && !session.title?.startsWith('btw · '))
            .toSorted((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, THREAD_OPTIONS),
        sameThreadRows,
      )
      const options: readonly ToolkitThread[] = threads.map(session => ({ id: session.id, title: session.displayTitle, cwd: session.cwd || undefined }))
      return (
        <PluginQueryProvider>
          <AgentToolkitPanel
            threads={options}
            threadId={threadId}
            selectThread={focusedThread.set}
            t={t}
            listPlugins={async () => {
              const result = await ctx.remote.pluginInventory.list()
              if (!result.ok) throw new Error(result.error.message)
              return result.value.entries.map(entry => ({
                entryId: entry.entryId,
                moduleName: entry.moduleName,
                title: typeof entry.meta?.title === 'string' ? entry.meta.title : undefined,
                enabled: entry.enabled,
                fiberPhase: entry.fiberPhase,
              }))
            }}
            openSettings={entryId =>
              window.dispatchEvent(
                new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { setting: { entryId, fieldPath: [] }, section: 'plugins' }, cancelable: true }),
              )
            }
            openMemoryPanel={() => openPanel(MEMORY_PANEL_ID)}
          />
        </PluginQueryProvider>
      )
    })

    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => `Agent Toolkit: ${t('viewCapabilities')}` }, PanelGlyph),
    )
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))

    // The Context facet follows the thread the right pane shows, remembered from setup so a tab that mounts after a
    // switch still knows it (the same pattern pulls-review's Changes facet uses).
    const panelThread = createSnapshotStore<string | undefined>(ctx.sidebarRight.mounted.getSnapshot())
    ctx.effect(
      () =>
        ctx.sidebarRight.mounted.subscribe(() => {
          const next = ctx.sidebarRight.mounted.getSnapshot()
          if (next !== undefined && next !== panelThread.getSnapshot()) panelThread.set(next)
        }),
      'agent-toolkit follows the thread panel',
    )
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: CONTEXT_TAB_ID,
          kind: CONTEXT_TAB_KIND,
          title: () => 'Context',
          guide: [
            {
              id: 'context',
              order: 60,
              title: () => 'Context',
              description: () => 'See what this thread loads into its model context (instructions, skills, MCP, memory, references) and roughly what it costs.',
              icon: ContextGlyph,
            },
          ],
        }),
      'agent-toolkit registers the Context facet tab type',
    )
    const ContextTab = decorate((_props: { readonly useTabInfo: UseSidebarRightTabInfo }) => {
      const sessionId = useSyncExternalStore(panelThread.subscribe, panelThread.getSnapshot)
      const cwd = useSyncExternalStore(ctx.sessions.list.subscribe, () => {
        const row = sessionId === undefined ? undefined : Object.values(ctx.sessions.list.getSnapshot().byId).find(candidate => candidate.id === sessionId)
        return row?.cwd === undefined || row.cwd === '' ? undefined : row.cwd
      })
      return (
        <PluginQueryProvider>
          <ContextFacet sessionId={sessionId === undefined ? undefined : String(sessionId)} cwd={cwd} />
        </PluginQueryProvider>
      )
    })
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: CONTEXT_TAB_ID }, ContextTab))

    metadata?.plugin?.add(PaletteActions, {
      id: '@dshfiles/agent-toolkit/open',
      label: () => t('paletteOpen'),
      aliases: ['agent toolkit', 'tools', 'skills', 'mcp', 'plugins', 'capabilities'],
      icon: <WrenchIcon className="dshx:size-4" />,
      group: 'destination',
      run: context => {
        if (context.thread !== null) focusedThread.set(context.thread.id)
        openPanel(PANEL_ID)
      },
    })
  },
})
