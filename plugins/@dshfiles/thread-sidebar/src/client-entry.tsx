import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelMetadata, SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveSlotLabel, type TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef } from 'react'
import { ArchivedThreadDock } from './archived-thread-dock.js'
import { archivedViewMachine } from './archived-view-machine.js'
import { SidebarRoot, type FooterSnapshot, type SidebarShellBaseProps } from './sidebar-shell.js'
import { ThreadSidebar } from './client.js'
import { HeaderThreadActions } from './header-actions.js'
import { sidebarChildren } from './sidebar-contract.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE, threadSidebarLocale } from './locales.js'
import { archiveWithoutStopping } from './organization.js'
import { NAVIGATION_EVENT } from './navigation-history.js'
import { PALETTE_EVENT } from '@dshfiles/command-palette/api'
import { SettingsTab } from './settings-tab.js'
import { createSkillMentionSource } from './skill-mention.js'
import {
  buildThreadReferenceInsert,
  classifyThreadMentionFailure,
  decodeThreadMentionSessionId,
  summarizeThreadMentionFailure,
  threadMentionFailureCodeSchema,
  THREAD_MENTION_CAPTURE_EVENT,
  THREAD_MENTION_INSERT_EVENT,
  type ThreadMentionFailureDiagnosticInput,
} from './thread-mention.js'
import './client.css'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    threadSidebarArchivedView: unknown
    threadSidebarSkillAutocomplete: unknown
  }
}

// Slot entries expose the native browser's injected hooks as `unknown`, and the Shortcuts service's registry is not in its
// public type; these guards establish the members this plugin calls.
interface WorkspaceShortcutsStore {
  readonly getSnapshot: () => { readonly searchRequest: number }
  readonly subscribe: (listener: () => void) => () => void
}

const hasWorkspaceShortcuts = (hooks: unknown): hooks is { readonly workspaceShortcuts: WorkspaceShortcutsStore } =>
  typeof hooks === 'object' &&
  hooks !== null &&
  'workspaceShortcuts' in hooks &&
  typeof hooks.workspaceShortcuts === 'object' &&
  hooks.workspaceShortcuts !== null &&
  'getSnapshot' in hooks.workspaceShortcuts &&
  typeof hooks.workspaceShortcuts.getSnapshot === 'function' &&
  'subscribe' in hooks.workspaceShortcuts &&
  typeof hooks.workspaceShortcuts.subscribe === 'function'

interface ShortcutRegistry {
  readonly invoke: (commandId: string, scope: { readonly region: 'page'; readonly modal: null; readonly target: Element | null }) => void
}

const hasShortcutRegistry = <Shortcuts,>(shortcuts: Shortcuts): shortcuts is Shortcuts & { readonly registry: ShortcutRegistry } =>
  typeof shortcuts === 'object' &&
  shortcuts !== null &&
  'registry' in shortcuts &&
  typeof shortcuts.registry === 'object' &&
  shortcuts.registry !== null &&
  'invoke' in shortcuts.registry &&
  typeof shortcuts.registry.invoke === 'function'

export default defineClient({
  name: '@dshfiles/thread-sidebar',
  locales: [threadSidebarLocale],
  // rootProps and the workspaces entry read these at render time, not from setup,
  // so the compiler cannot infer them. Declaring only slots lets the plugin
  // activate and then throw inside the slot, which blanks the sidebar instead of
  // failing the boot.
  inject: [
    'slots',
    'shortcuts',
    'layout',
    'uiWorkspace',
    'workspaces',
    'sessions',
    'conversation',
    'remote',
    'remote.workspace',
    'remote.sessionReferenceResolver',
    'remote.skills',
    'inputTriggers',
  ],
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
          if (!hasWorkspaceShortcuts(hooks)) continue
          const store = hooks.workspaceShortcuts
          let handled = store.getSnapshot().searchRequest
          release = store.subscribe(() => {
            const next = store.getSnapshot().searchRequest
            if (next === handled) return
            handled = next
            window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: { mode: 'threads' } }))
          })
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
    const skillMentions = createSkillMentionSource({
      isSubagent: sessionId => ctx.sessions.subagentAddress(sessionId) !== undefined,
      rank: rankByName,
      list: async (sessionId, signal) => {
        const result = await ctx.remote.skills.list({ sessionId }, signal)
        signal.throwIfAborted()
        if (!result.ok) throw new Error('Skill catalog is unavailable.')
        return result.value.skills
      },
      section: translate('threadSidebarSkillSource'),
      userOnlyLabel: translate('threadSidebarSkillUserOnly'),
    })
    ctx.remote.$on('agent-preset/selected', skillMentions.invalidate)
    ctx.on('connection/reset', skillMentions.clear)
    ctx.effect(() => {
      const unregister = ctx.inputTriggers.registerSource(skillMentions.source)
      return () => {
        unregister()
        skillMentions.clear()
      }
    }, 'thread-sidebar: @ skill source')

    const ThreadMentionInput = (props: { readonly inputActions: InputActions; readonly sessionId: SessionSummary['id'] }): null => {
      const insertion = useRef<ReturnType<InputActions['captureInsertion']> | null>(null)
      const pending = useRef(new Set<AbortController>())

      useEffect(() => {
        const sessionContext = ctx.sessions.scope(props.sessionId)
        if (sessionContext === undefined) return
        const input = ctx.conversation.input.for(sessionContext)
        const capture = (): void => {
          insertion.current = props.inputActions.captureInsertion()
        }
        const insert = (event: Event): void => {
          const targetSessionId = event instanceof CustomEvent ? decodeThreadMentionSessionId(event.detail) : null
          if (targetSessionId === null) return
          const span = insertion.current ?? props.inputActions.captureInsertion()
          insertion.current = null
          const controller = new AbortController()
          pending.current.add(controller)
          void (async () => {
            let failurePhase: ThreadMentionFailureDiagnosticInput['phase'] = 'resolver-exception'
            try {
              const result = await ctx.remote.sessionReferenceResolver.candidates(props.sessionId, targetSessionId, controller.signal)
              if (controller.signal.aborted) return
              if (!result.ok) {
                console.warn(
                  'thread-sidebar: mention resolution failed',
                  summarizeThreadMentionFailure({
                    phase: 'remote-result',
                    errorName: result.error.name,
                    errorCode: result.error.code,
                  }),
                )
                input.notify('error', translate('threadSidebarMentionFailure'))
                return
              }
              failurePhase = 'candidate-processing-exception'
              const candidate = result.value.find(item => item.sessionId === targetSessionId)
              if (candidate === undefined) {
                input.notify('info', translate('threadSidebarMentionUnavailable'))
                return
              }
              failurePhase = 'insertion-exception'
              if (!input.insertReference(buildThreadReferenceInsert(candidate), span)) {
                input.notify('info', translate('threadSidebarMentionDraftChanged'))
              }
            } catch (failure) {
              if (!controller.signal.aborted) {
                const parsedFailure = threadMentionFailureCodeSchema.safeParse(failure)
                const diagnostic: ThreadMentionFailureDiagnosticInput = {
                  phase: failurePhase,
                  errorName: failure instanceof Error ? failure.name : 'unknown',
                }
                if (parsedFailure.success) diagnostic.errorCode = parsedFailure.data.code
                diagnostic.failureKind = classifyThreadMentionFailure(failure)
                console.warn('thread-sidebar: mention resolution failed', summarizeThreadMentionFailure(diagnostic))
                input.notify('error', translate('threadSidebarMentionFailure'))
              }
            } finally {
              pending.current.delete(controller)
            }
          })()
        }

        window.addEventListener(THREAD_MENTION_CAPTURE_EVENT, capture)
        window.addEventListener(THREAD_MENTION_INSERT_EVENT, insert)
        return () => {
          window.removeEventListener(THREAD_MENTION_CAPTURE_EVENT, capture)
          window.removeEventListener(THREAD_MENTION_INSERT_EVENT, insert)
          for (const controller of pending.current) controller.abort()
          pending.current.clear()
        }
      }, [props.inputActions, props.sessionId, translate])

      return null
    }
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

    const currentWorkspaceId = (): WorkspaceView['workspaceId'] | undefined => {
      const sessions = ctx.sessions.list.getSnapshot()
      const current = sessions.ids.find(id => (sessions.byId[id]?.retainedBy.mainView ?? 0) > 0)
      return current === undefined ? undefined : ctx.workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(current))?.workspaceId
    }
    const rootProps = (): SidebarRootInjected => ({
      // The composer opens at once; jj-integration's destination bar then moves the blank thread to its own jj
      // workspace (or the project checkout) in the background, so New thread never waits on jj.
      startSession: workspaceId => {
        const target = workspaceId ?? currentWorkspaceId()
        if (target === undefined) return ctx.uiWorkspace.startSession()
        ctx.uiWorkspace.startSession(target)
      },
      toggleSidebar: () => ctx.layout.toggleSidebar(),
      selectPanel: id => ctx.layout.selectPanel(id),
      hooks: {
        panels,
        shortcuts: ctx.shortcuts.catalog,
      },
    })

    // The public Shortcuts service lists commands but only runs them from a key press; its registry's `invoke` is what
    // the Desktop menu uses. Read it defensively so a Host without it simply leaves Host commands out of the palette.
    const shortcuts = ctx.shortcuts
    const runCommand = hasShortcutRegistry(shortcuts)
      ? (commandId: string): void => {
          try {
            shortcuts.registry.invoke(commandId, { region: 'page', modal: null, target: document.activeElement })
          } catch (error) {
            console.warn(`thread-sidebar: the ${commandId} command failed`, error)
          }
        }
      : null

    const archivedView = createActor(archivedViewMachine, {
      input: {
        client: {
          open: sessionId => ctx.uiWorkspace.openSession(sessionId),
          ready: async (sessionId, signal) => {
            const reference = ctx.sessions.retain(sessionId, { source: 'threadSidebarArchivedView' })
            const aborted = new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
            try {
              await Promise.race([reference.ready, aborted])
            } finally {
              reference.release()
            }
          },
          now: () => Date.now(),
        },
      },
    })
    ctx.effect(() => {
      archivedView.start()
      let selected: string | null = null
      const followSelection = (): void => {
        const sessions = ctx.sessions.list.getSnapshot()
        const next = sessions.ids.find(id => (sessions.byId[id]?.retainedBy.mainView ?? 0) > 0) ?? null
        if (next === selected) return
        selected = next
        archivedView.send({ type: 'selection.changed', sessionId: next })
      }
      const unsubscribe = ctx.sessions.list.subscribe(followSelection)
      return () => {
        unsubscribe()
        archivedView.stop()
      }
    }, 'thread-sidebar: archived thread view')
    const openThread = (sessionId: SessionSummary['id']): void => {
      const archived = ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)
      archivedView.send({ type: 'open', sessionId, archived })
      if (!archived) ctx.uiWorkspace.openSession(sessionId)
    }

    const SidebarRootAdapter = (props: SidebarShellBaseProps): JSX.Element => (
      <SidebarRoot
        {...props}
        readFooterSnapshot={readFooterSnapshot}
        subscribeFooterSnapshot={subscribeFooterSnapshot}
        openSession={openThread}
        runCommand={runCommand}
      />
    )

    ctx.slots.inject('conversation.input.overlay', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.overlay',
          id: 'thread-sidebar-mention-input',
        },
        decorate(ThreadMentionInput),
      ),
    )
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        { name: 'conversation.input.dock', id: 'thread-sidebar-archived-banner', order: 5, inject: sessionId => ({ sessionId }) },
        decorate((props: { readonly sessionId: SessionSummary['id'] }) => (
          <PluginQueryProvider>
            <ArchivedThreadDock sessionId={props.sessionId} workspaces={ctx.workspaces} blocks={ctx.conversation.blocks} t={translate} />
          </PluginQueryProvider>
        )),
      ),
    )

    const archiveSession = (sessionId: SessionSummary['id']) =>
      archiveWithoutStopping((targetId, options) => ctx.workspaces.archiveSession(targetId, options), sessionId)
    const unarchiveSession = (sessionId: SessionSummary['id']) => ctx.workspaces.unarchiveSession(sessionId)
    const pinSession = async (sessionId: SessionSummary['id']) => {
      const result = await ctx.remote.workspace.pinSession({ sessionId })
      if (!result.ok) throw new Error(result.error.code)
    }
    const unpinSession = async (sessionId: SessionSummary['id']) => {
      const result = await ctx.remote.workspace.unpinSession({ sessionId })
      if (!result.ok) throw new Error(result.error.code)
    }
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'thread-sidebar-thread-actions',
          order: 100,
          label: () => ctx.locale.bind(THREAD_SIDEBAR_LOCALE_NAMESPACE)('threadSidebarThreadActions'),
          locale: THREAD_SIDEBAR_LOCALE_NAMESPACE,
          inject: () => ({ archiveSession, unarchiveSession, pinSession, unpinSession }),
        },
        decorate(HeaderThreadActions),
      ),
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
            pinSession: async (sessionId: SessionSummary['id']) => {
              const result = await ctx.remote.workspace.pinSession({ sessionId })
              if (!result.ok) throw new Error(result.error.code)
            },
            unpinSession: async (sessionId: SessionSummary['id']) => {
              const result = await ctx.remote.workspace.unpinSession({ sessionId })
              if (!result.ok) throw new Error(result.error.code)
            },
            open: openThread,
            archivedView,
            openRemoteThreads: () => ctx.layout.selectPanel('dshfiles-multi-host-thread' as MainPanelId),
          }),
        },
        decorate(ThreadSidebar),
      ),
    )
  },
})
