import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-modules/client'
import type {} from '@dshfiles/input-trigger/client'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelMetadata, SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveSlotLabel, type PropsRenderSlots, type PropsRuntime, type TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient, hasHostCommandRegistry, runHostCommand } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import { ArchivedThreadDock } from './archived-thread-dock.js'
import { SettledThreadDock } from './settled-thread-dock.js'
import { SidebarRoot, type FooterSnapshot, type SidebarShellBaseProps } from './sidebar-shell.js'
import { ThreadAsideOpenProvider, ThreadSidebar } from './client.js'
import { ThreadListNavigationModel } from './thread-list-navigation.js'
import { HeaderThreadActions } from './header-actions.js'
import { SubagentCatalogAction, SubagentHeaderLineage, type SubagentCatalogInjected } from './subagent-provenance/SubagentHeaderLineage.js'
import { SubagentProvenanceToolRow } from './subagent-provenance/subagent-tool-row.js'
import { NS as SUBAGENT_LOCALE_NAMESPACE } from './subagent-provenance/locales.js'
import { subagentChatAddress } from './subagent-provenance/resource.js'
import { ThreadAsideConversation } from './thread-aside-panel.js'
import { THREAD_ASIDE_CONVERSATION_SLOT, THREAD_ASIDE_ID, THREAD_ASIDE_KIND, threadAsideAddress, threadAsideSessionId } from './thread-aside.js'
import { OPEN_THREAD_ASIDE_EVENT, readThreadAsideRequest } from './thread-aside-request.js'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sidebarChildren } from './sidebar-contract.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE, threadSidebarLocale } from './locales.js'
import { SidebarOrganization } from './organization.js'
import { NAVIGATION_EVENT } from './navigation-history.js'
import { PALETTE_EVENT } from '@dshfiles/command-palette/api'
import { SettingsTab } from './settings-tab.js'
import { ThreadNotificationAudioModel } from './thread-notification-audio.js'
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

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    threadSidebarArchivedView: unknown
    threadSidebarSkillAutocomplete: unknown
    threadSidebarNavigation: unknown
    /** One thread shown in its own right-sidebar tab (opened from the row menu). */
    threadSidebarAside: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    threadaside: SessionReference
  }
  interface SlotMap {
    /** The aside tab's embedded Conversation for the thread it holds. */
    'dshfiles.thread-sidebar.conversation': {
      kind: 'single'
      scope: 'session'
    }
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
    'sidebarRight',
    'sidebarRightTabs',
    'resources',
    'remote',
    'remote.workspace',
    'remote.sessionReferenceResolver',
    'remote.skills',
    'inputTriggers',
    'modules',
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

    // The revision each client bundle this page runs reports, compared against the Host's served graph to tell a
    // page that missed a rebuild from one that hot-reloaded it: the rows advance as reloads are applied.
    const readClientRevisionKey = (): string => JSON.stringify((ctx.modules.manifest.modules ?? []).map(row => [row.id, row.rev] as const))
    const subscribeClientRevisions = (listener: () => void): (() => void) => ctx.modules.entries.state.subscribe(listener)

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

    // One surface, in the Settings navigation: users look for thread preferences beside the other
    // sections, and the plugin's generated page cannot show these fields (they are hidden in the schema).
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          registrant: '@dshfiles/thread-sidebar',
          id: 'thread-sidebar',
          order: 40,
          label: () => ctx.locale.bind(THREAD_SIDEBAR_LOCALE_NAMESPACE)('threadSidebarSettingsTab'),
          locale: THREAD_SIDEBAR_LOCALE_NAMESPACE,
        },
        decorate(({ t }: { t: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE> }) => <SettingsTab t={t} hostShortcuts={ctx.shortcuts.catalog} />),
      ),
    )

    // Notification sounds fire in a background tab, where no gesture can resume an audio context:
    // unlock it on the first interaction so a later alert still rings.
    ctx.effect(() => {
      const unlockNotificationAudio = (): void => {
        void ThreadNotificationAudioModel.unlock()
      }
      window.addEventListener('pointerdown', unlockNotificationAudio, { capture: true, once: true })
      window.addEventListener('keydown', unlockNotificationAudio, { capture: true, once: true })
      return () => {
        window.removeEventListener('pointerdown', unlockNotificationAudio, { capture: true })
        window.removeEventListener('keydown', unlockNotificationAudio, { capture: true })
      }
    }, 'thread-sidebar: notification audio')

    ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', syncPanels), 'thread-sidebar: panel links')
    ctx.effect(() => ctx.locale.subscribe(syncPanels), 'thread-sidebar: panel labels')
    syncPanels()

    const ASK_SHORTCUT_ID = 'threadSidebar.openInSidePanel'
    /** One stable identity: a fresh arrow each render would defeat the memoized thread rows. */
    const openAside = (sessionId: string): void => {
      ctx.sidebarRight.openResource(threadAsideAddress(sessionId), { kind: THREAD_ASIDE_KIND })
    }

    // A main-tabs tab menu asks through this cancelable event. Declining leaves the request unanswered, which tells
    // the caller the panel is unavailable: without a thread on screen there is no side panel to open an aside into.
    ctx.effect(() => {
      const onOpenThreadAside = (event: Event): void => {
        const sessionId = readThreadAsideRequest(event)
        if (sessionId === undefined || ctx.sidebarRight.mounted.getSnapshot() === undefined) return
        event.preventDefault()
        openAside(sessionId)
      }
      window.addEventListener(OPEN_THREAD_ASIDE_EVENT, onOpenThreadAside)
      return () => window.removeEventListener(OPEN_THREAD_ASIDE_EVENT, onOpenThreadAside)
    }, 'thread-sidebar: open an aside for another plugin')
    /** The thread the main column shows, skipping blank drafts; undefined on a panel or the New thread screen. */
    const mainViewThread = (): SessionId | undefined => {
      const sessions = ctx.sessions.list.getSnapshot()
      return sessions.ids.find(id => (sessions.byId[id]?.retainedBy.mainView ?? 0) > 0 && sessions.byId[id]?.blank === false)
    }

    // No default binding on purpose: the command is listed and rebindable in Settings › Shortcuts, but it never
    // steals a chord until the user picks one.
    if (isShortcutCommandId(ASK_SHORTCUT_ID))
      ctx.effect(() => {
        try {
          return ctx.shortcuts.register({
            id: ASK_SHORTCUT_ID,
            label: () => translate('threadSidebarOpenInSidePanel'),
            aliases: ['open in side panel', 'side panel', 'aside'],
            defaults: {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => {
              const sessionId = mainViewThread()
              return sessionId === undefined ? { status: 'pass' } : { status: 'handled', run: () => openAside(sessionId) }
            },
          })
        } catch (error) {
          console.warn(`thread-sidebar: ${ASK_SHORTCUT_ID} could not be registered`, error)
          return () => undefined
        }
      }, 'thread-sidebar: open-aside shortcut')

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
    const runCommand = hasHostCommandRegistry(shortcuts) ? (commandId: string): void => void runHostCommand(shortcuts, commandId) : null

    const openThread = (sessionId: SessionSummary['id']): void => ctx.uiWorkspace.openSession(sessionId)

    const SidebarRootAdapter = (props: SidebarShellBaseProps): JSX.Element => (
      <SidebarRoot
        {...props}
        readFooterSnapshot={readFooterSnapshot}
        subscribeFooterSnapshot={subscribeFooterSnapshot}
        readClientRevisionKey={readClientRevisionKey}
        subscribeClientRevisions={subscribeClientRevisions}
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
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        { name: 'conversation.input.dock', id: 'thread-sidebar-settled-banner', order: 6, inject: sessionId => ({ sessionId }) },
        decorate((props: { readonly sessionId: SessionSummary['id'] }) => (
          <PluginQueryProvider>
            <SettledThreadDock sessionId={props.sessionId} workspaces={ctx.workspaces} blocks={ctx.conversation.blocks} t={translate} />
          </PluginQueryProvider>
        )),
      ),
    )

    const archiveSession = (sessionId: SessionSummary['id']) =>
      SidebarOrganization.archiveWithoutStopping((targetId, options) => ctx.workspaces.archiveSession(targetId, options), sessionId)
    const unarchiveSession = (sessionId: SessionSummary['id']) => ctx.workspaces.unarchiveSession(sessionId)
    const pinSession = async (sessionId: SessionSummary['id']) => {
      const result = await ctx.remote.workspace.pinSession({ sessionId })
      if (!result.ok) throw new Error(result.error.code)
    }
    const unpinSession = async (sessionId: SessionSummary['id']) => {
      const result = await ctx.remote.workspace.unpinSession({ sessionId })
      if (!result.ok) throw new Error(result.error.code)
    }
    const subagentCatalogActions = (_parentSessionId: SessionId): SubagentCatalogInjected => ({
      openChild(address: SubagentAddress) {
        ctx.uiWorkspace.openSession(address)
      },
      openChildAside(address: SubagentAddress) {
        ctx.sidebarRight.openResource(subagentChatAddress(address), {
          kind: 'subagentchat',
          preferNewPane: true,
        })
      },
      refreshProjection(parentSessionId: SessionId) {
        void ctx.sessions.refreshProjections(parentSessionId)
      },
    })
    ctx.slots.inject('conversation.session.header.lineage', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.lineage',
          registrant: '@dshfiles/thread-sidebar',
          priority: -1000,
          locale: SUBAGENT_LOCALE_NAMESPACE,
          inject: subagentCatalogActions,
        },
        decorate(SubagentHeaderLineage),
      ),
    )
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.actions',
          id: 'subagent-catalog',
          priority: -1000,
          order: -30,
          locale: SUBAGENT_LOCALE_NAMESPACE,
          inject: subagentCatalogActions,
        },
        decorate(SubagentCatalogAction),
      ),
    )
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        {
          name: 'tool.call.toolview',
          key: 'subagent',
          registrant: '@dshfiles/thread-sidebar',
          priority: -1000,
          locale: 'conversation',
        },
        decorate(SubagentProvenanceToolRow),
      ),
    )

    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'thread-sidebar-thread-actions',
          order: 100,
          label: () => ctx.locale.bind(THREAD_SIDEBAR_LOCALE_NAMESPACE)('threadSidebarThreadActions'),
          locale: THREAD_SIDEBAR_LOCALE_NAMESPACE,
          inject: () => ({ archiveSession, unarchiveSession, pinSession, unpinSession, openThread }),
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

    const ThreadSidebarWithHistoryLookahead = (props: Parameters<typeof ThreadSidebar>[0]): JSX.Element => {
      const [lookaheadSessionIds, setLookaheadSessionIds] = useState<readonly SessionSummary['id'][]>([])
      useEffect(
        () =>
          ThreadListNavigationModel.retainLookahead({
            sessionIds: lookaheadSessionIds,
            retain: (sessionId, signal) => ctx.sessions.retain(sessionId, { source: 'threadSidebarNavigation', signal }),
          }),
        [lookaheadSessionIds],
      )
      const updateLookaheadSessionIds = (sessionIds: readonly SessionSummary['id'][]): void => {
        setLookaheadSessionIds(current =>
          current.length === sessionIds.length && current.every((sessionId, index) => sessionId === sessionIds[index]) ? current : sessionIds,
        )
      }

      return (
        <PluginQueryProvider>
          <ThreadAsideOpenProvider value={openAside}>
            <ThreadSidebar {...props} onNavigationLookahead={updateLookaheadSessionIds} />
          </ThreadAsideOpenProvider>
        </PluginQueryProvider>
      )
    }

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
              SidebarOrganization.archiveWithoutStopping((targetId, options) => ctx.workspaces.archiveSession(targetId, options), sessionId),
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
            openRemoteThreads: () => ctx.layout.selectPanel('dshfiles-multi-host-thread' as MainPanelId),
          }),
        },
        decorate(ThreadSidebarWithHistoryLookahead),
      ),
    )

    // One thread in its own right-sidebar tab: the same embedded Conversation a subagent chat hosts, but for a
    // thread the user picked from the list, so closing the tab only releases the reference (nothing is archived).
    ctx.effect(
      () =>
        ctx.resources.register({
          protocol: THREAD_ASIDE_KIND,
          async *open(address, { signal }) {
            const requested = threadAsideSessionId(address)
            const listed = ctx.sessions.list.getSnapshot().ids.find(id => id === requested)
            if (listed === undefined) throw new Error(`thread-sidebar: no thread at "${address}"`)
            const reference = ctx.sessions.retain(listed, { source: 'threadSidebarAside', signal })
            try {
              yield { ok: true, value: reference }
              await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
            } finally {
              reference.release()
            }
          },
        }),
      'thread-sidebar: aside resources',
    )

    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: THREAD_ASIDE_ID,
          kind: THREAD_ASIDE_KIND,
          patterns: ['dsh-resource://threadaside/session/**'],
          canOpen: address => threadAsideSessionId(address) !== undefined,
          title: address => {
            const snapshot = ctx.sessions.list.getSnapshot()
            const listed = snapshot.ids.find(id => id === threadAsideSessionId(address))
            return (listed === undefined ? undefined : snapshot.byId[listed]?.displayTitle) ?? translate('threadSidebarThreadFallback')
          },
        }),
      'thread-sidebar: aside tab type',
    )

    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: THREAD_ASIDE_ID, children: { [THREAD_ASIDE_CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } } },
            (props: PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<typeof THREAD_ASIDE_CONVERSATION_SLOT>) => {
              const { tab } = props.useTabInfo()
              const resource = props.useResource(tab.contentId)
              return (
                <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0" data-dshfiles-thread-aside="">
                  {resource.value === undefined ? null : (
                    <props.SessionProvider session={resource.value}>{props.renderSlot(THREAD_ASIDE_CONVERSATION_SLOT, {})}</props.SessionProvider>
                  )}
                </div>
              )
            },
          ),
        ),
      'thread-sidebar: aside tab body',
    )

    ctx.effect(
      () => ctx.slots.inject(THREAD_ASIDE_CONVERSATION_SLOT, () => ctx.slots.register({ name: THREAD_ASIDE_CONVERSATION_SLOT }, ThreadAsideConversation)),
      'thread-sidebar: aside Conversation',
    )
  },
})
