import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelMetadata, SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { resolveSlotLabel, type TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { SidebarRoot, type FooterSnapshot, type SidebarShellBaseProps } from './sidebar-shell.js'
import { ThreadSidebar } from './client.js'
import { sidebarChildren } from './sidebar-contract.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE, threadSidebarLocale } from './locales.js'
import { archiveWithoutStopping } from './organization.js'
import { NAVIGATION_EVENT } from './navigation-history.js'
import { PALETTE_EVENT } from './palette.js'
import { SettingsTab } from './settings-tab.js'
import './client.css'

export default defineClient({
  name: '@dshfiles/thread-sidebar',
  locales: [threadSidebarLocale],
  // rootProps and the workspaces entry read these at render time, not from setup,
  // so the compiler cannot infer them. Declaring only slots lets the plugin
  // activate and then throw inside the slot, which blanks the sidebar instead of
  // failing the boot.
  inject: ['slots', 'shortcuts', 'layout', 'uiWorkspace', 'workspaces', 'sessions'],
  // Every registered component reads Settings, so each one goes through decorate.
  setup(ctx, decorate) {
    const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
    const syncPanels = (): void => {
      const next = ctx.slots
        .entriesOfSlot('sidebar.panellist')
        .flatMap(({ options }) => {
          const id = options.id
          if (id === undefined) return []
          // SlotCore erases MainPanelId when exposing its heterogeneous entry ledger.
          const panelId = id as MainPanelId
          return {
            id: panelId,
            order: options.order ?? 0,
            label: resolveSlotLabel(options.label) ?? id,
          } satisfies SidebarPanelMetadata
        })
        .sort((left, right) => left.order - right.order)
      const previous = panels.getSnapshot()
      if (
        previous.length === next.length &&
        previous.every((panel, index) => {
          const candidate = next[index]
          return panel.id === candidate?.id && panel.order === candidate.order && panel.label === candidate.label
        })
      )
        return
      panels.set(next)
    }

    const readFooterSnapshot = (): FooterSnapshot => {
      const settings = ctx.slots.entriesOfSlot('sidebar.settings')[0]
      return {
        settingsId: settings === undefined ? null : 'settings',
        actions: ctx.slots.entriesOfSlot('sidebar.footer.action').flatMap(({ options }) => {
          const id = options.id
          if (id === undefined) return []
          return [
            {
              id,
              order: options.order ?? 0,
              label: resolveSlotLabel(options.label) ?? id,
            },
          ]
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

    // The native browser stays registered beneath ours; its injected share holds the
    // store that Host `session.search` (⌥⌘K web, ⌘K desktop) bumps, so follow it.
    const watchNativeSearchRequests = (): (() => void) => {
      let release = (): void => undefined
      const bind = (): void => {
        release()
        release = () => undefined
        for (const entry of ctx.slots.entries('sidebar.workspaces')) {
          if (entry.options.priority === -1000 || entry.inject === undefined) continue
          const hooks: unknown = entry.inject().hooks
          const store: unknown = typeof hooks === 'object' && hooks !== null ? Reflect.get(hooks, 'workspaceShortcuts') : undefined
          const searchRequest = (): unknown => {
            const read: unknown = typeof store === 'object' && store !== null ? Reflect.get(store, 'getSnapshot') : undefined
            const snapshot: unknown = typeof read === 'function' ? Reflect.apply(read, store, []) : undefined
            return typeof snapshot === 'object' && snapshot !== null ? Reflect.get(snapshot, 'searchRequest') : undefined
          }
          const subscribe: unknown = typeof store === 'object' && store !== null ? Reflect.get(store, 'subscribe') : undefined
          if (typeof subscribe !== 'function') continue
          let handled = searchRequest()
          const unsubscribe: unknown = Reflect.apply(subscribe, store, [
            () => {
              const next = searchRequest()
              if (next === handled) return
              handled = next
              window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: { mode: 'threads' } }))
            },
          ])
          release = () => {
            if (typeof unsubscribe === 'function') Reflect.apply(unsubscribe, undefined, [])
          }
          return
        }
      }
      bind()
      const stopWatching = ctx.slots.subscribe('sidebar.workspaces', bind)
      return () => {
        stopWatching()
        release()
      }
    }
    ctx.effect(watchNativeSearchRequests, 'thread-sidebar: native session search')

    const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)
    const translate = ctx.locale.bind(THREAD_SIDEBAR_LOCALE_NAMESPACE)
    const navigationCommands = [
      { id: 'threadSidebar.navigateBack', code: 'BracketLeft', direction: -1, label: 'threadSidebarNavigateBack', aliases: ['back', 'previous thread'] },
      { id: 'threadSidebar.navigateForward', code: 'BracketRight', direction: 1, label: 'threadSidebarNavigateForward', aliases: ['forward', 'next thread'] },
    ] as const
    for (const command of navigationCommands) {
      const commandId = command.id
      if (!isShortcutCommandId(commandId)) continue
      const binding = { code: command.code, modifiers: ['primary'] } as const
      // The Host refuses ⌘[ / ⌘] as Web defaults (browser-reserved), so the web uses the sidebar's capture chords;
      // a user binding or another plugin may also own them, and the header buttons still work.
      ctx.effect(() => {
        try {
          return ctx.shortcuts.register({
            id: commandId,
            label: () => translate(command.label),
            aliases: [...command.aliases],
            defaults: {
              'desktop:macos': binding,
              'desktop:windows': binding,
              'desktop:linux': binding,
            },
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({
              status: 'handled',
              run: () => window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT, { detail: { direction: command.direction } })),
            }),
          })
        } catch (error) {
          console.warn(`thread-sidebar: the ${commandId} shortcut could not be registered`, error)
          return () => undefined
        }
      }, `thread-sidebar: ${commandId} shortcut`)
    }

    const paletteCommandId = 'threadSidebar.commandPalette'
    if (isShortcutCommandId(paletteCommandId)) {
      const paletteBinding = { code: 'KeyP', modifiers: ['primary', 'shift'] } as const
      // A user binding or another plugin may already own the default; the palette
      // still opens from its button and capture chords, so a refusal must not abort setup.
      ctx.effect(() => {
        try {
          return ctx.shortcuts.register({
            id: paletteCommandId,
            label: () => translate('threadSidebarCommandPalette'),
            aliases: ['command palette', 'go to', 'search threads'],
            defaults: {
              'desktop:macos': paletteBinding,
              'desktop:windows': paletteBinding,
              'desktop:linux': paletteBinding,
              'web:macos': paletteBinding,
              'web:windows': paletteBinding,
            },
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({
              status: 'handled',
              run: () => window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: { mode: 'all' } })),
            }),
          })
        } catch (error) {
          console.warn('thread-sidebar: the command palette shortcut could not be registered', error)
          return () => undefined
        }
      }, 'thread-sidebar: command palette shortcut')
    }

    ctx.slots.inject('settings.plugins.tab', () =>
      ctx.slots.register(
        {
          name: 'settings.plugins.tab',
          registrant: '@dshfiles/thread-sidebar',
          id: 'thread-sidebar',
          order: 30,
          label: () => ctx.locale.bind(THREAD_SIDEBAR_LOCALE_NAMESPACE)('threadSidebarSettingsTab'),
          locale: THREAD_SIDEBAR_LOCALE_NAMESPACE,
        },
        decorate(({ t }: { t: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE> }) => <SettingsTab t={t} hostShortcuts={ctx.shortcuts.catalog} />),
      ),
    )

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

    // The public Shortcuts service lists commands but only runs them from a key press; its registry's `invoke` is what
    // the Desktop menu uses. Read it defensively so a Host without it simply leaves Host commands out of the palette.
    const hostRegistry: unknown = Reflect.get(ctx.shortcuts, 'registry')
    const hostInvoke: unknown = typeof hostRegistry === 'object' && hostRegistry !== null ? Reflect.get(hostRegistry, 'invoke') : undefined
    const runCommand =
      typeof hostInvoke === 'function'
        ? (commandId: string): void => {
            try {
              Reflect.apply(hostInvoke, hostRegistry, [commandId, { region: 'page', modal: null, target: document.activeElement }])
            } catch (error) {
              console.warn(`thread-sidebar: the ${commandId} command failed`, error)
            }
          }
        : null

    const SidebarRootAdapter = (props: SidebarShellBaseProps): JSX.Element => (
      <SidebarRoot
        {...props}
        readFooterSnapshot={readFooterSnapshot}
        subscribeFooterSnapshot={subscribeFooterSnapshot}
        openSession={sessionId => ctx.uiWorkspace.openSession(sessionId)}
        runCommand={runCommand}
      />
    )

    ctx.slots.inject('sidebar', () =>
      ctx.slots.register(
        {
          name: 'sidebar',
          registrant: '@dshfiles/thread-sidebar',
          priority: -1000,
          locale: THREAD_SIDEBAR_LOCALE_NAMESPACE,
          children: sidebarChildren,
          inject: rootProps,
        },
        decorate(SidebarRootAdapter),
      ),
    )

    ctx.slots.inject('sidebar.workspaces', () =>
      ctx.slots.register(
        {
          name: 'sidebar.workspaces',
          registrant: '@dshfiles/thread-sidebar',
          priority: -1000,
          locale: 'workspace',
          inject: () => ({
            tSidebar: ctx.locale.bind(THREAD_SIDEBAR_LOCALE_NAMESPACE),
            archiveSession: (sessionId: SessionSummary['id']) =>
              archiveWithoutStopping((targetId, options) => ctx.workspaces.archiveSession(targetId, options), sessionId),
            unarchiveSession: (sessionId: SessionSummary['id']) => ctx.workspaces.unarchiveSession(sessionId),
            pinSession: (sessionId: SessionSummary['id']) => ctx.workspaces.pinSession(sessionId),
            unpinSession: (sessionId: SessionSummary['id']) => ctx.workspaces.unpinSession(sessionId),
            markRead: async (sessionId: SessionSummary['id']) =>
              (
                await ctx.sessions.updateAttention({
                  sessionId,
                  action: { type: 'mark-read' },
                })
              ).ok,
            setSnoozed: async (sessionId: SessionSummary['id'], snoozed: boolean) =>
              (
                await ctx.sessions.updateAttention({
                  sessionId,
                  action: { type: 'set-snoozed', snoozed },
                })
              ).ok,
            open: (sessionId: SessionSummary['id']) => ctx.uiWorkspace.openSession(sessionId),
            searchContent:
              typeof ctx.sessions.search === 'function'
                ? async (query: string, signal: AbortSignal) => {
                    const result = await ctx.sessions.search(query, signal)
                    if (!result.ok) throw new Error('Session content search failed.')
                    return result.value.items.map(item => ({ sessionId: item.sessionId, snippet: item.snippet }))
                  }
                : null,
          }),
        },
        decorate(ThreadSidebar),
      ),
    )
  },
})
