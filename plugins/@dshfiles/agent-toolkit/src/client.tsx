import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-host-plugin-inventory/remote'
import { registerPaletteAction } from '@dshfiles/command-palette/api'
import { defineClient } from '@dshfiles/dshx/client'
import { WrenchIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useSyncExternalStore } from 'react'
import { AGENT_TOOLKIT_LOCALE_NAMESPACE, agentToolkitLocale, type AgentToolkitKey } from './locales.js'
import { AgentToolkitPanel, type ToolkitThread } from './toolkit-panel.js'

const PANEL_ID = 'dshfiles-agent-toolkit'
const MEMORY_PANEL_ID = 'dshfiles-memory-panel'
const OPEN_SETTINGS_EVENT = 'dshfiles:open-settings'
const THREAD_OPTIONS = 30

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => <WrenchIcon aria-hidden size={props.size ?? 18} strokeWidth={1.6} />

export default defineClient({
  name: '@dshfiles/agent-toolkit',
  locales: [agentToolkitLocale],
  inject: ['slots', 'layout', 'sessions', 'remote', 'remote.pluginInventory'],
  setup(ctx, decorate) {
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
      const threads = props.useSessions(state =>
        state.ids
          .flatMap(id => state.byId[id] ?? [])
          .filter(session => !session.blank && !session.title?.startsWith('btw · '))
          .toSorted((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, THREAD_OPTIONS),
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

    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => t('title') }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))

    ctx.effect(
      () =>
        registerPaletteAction({
          id: '@dshfiles/agent-toolkit/open',
          label: () => t('paletteOpen'),
          aliases: ['agent toolkit', 'tools', 'skills', 'mcp', 'plugins', 'capabilities'],
          icon: <WrenchIcon className="dshx:size-4" />,
          group: 'destination',
          run: context => {
            if (context.thread !== null) focusedThread.set(context.thread.id)
            openPanel(PANEL_ID)
          },
        }),
      'agent-toolkit: command palette action',
    )
  },
})
