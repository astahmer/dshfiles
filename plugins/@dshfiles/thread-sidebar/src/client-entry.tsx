import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-modules/client'
import type {} from '@dshfiles/input-trigger/client'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@dshfiles/session-controller/draft-client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelMetadata, SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import { LayoutGridIcon } from '@dshfiles/plugin-ui/icons'
import { resolveSlotLabel, type PropsRenderSlots, type PropsRuntime, type TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createApiClient, defineClient, hasHostCommandRegistry, runHostCommand } from '@dshfiles/dshx/client'
import { threadActionsApi } from './thread-actions-api.js'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArchivedThreadDock } from './archived-thread-dock.js'
import { SettledThreadDock } from './settled-thread-dock.js'
import { SidebarRoot, type FooterSnapshot, type SidebarShellBaseProps } from './sidebar-shell.js'
import { SidebarStateProvider } from './sidebar-state.js'
import { ThreadAsideOpenProvider, ThreadSidebar, type ThreadSidebarStandardProps } from './client.js'
import { ThreadListNavigationModel } from './thread-list-navigation.js'
import { HeaderThreadActions } from './header-actions.js'
import { SubagentCatalogAction, SubagentHeaderLineage, type SubagentCatalogInjected } from './subagent-provenance/SubagentHeaderLineage.js'
import { SubagentProvenanceToolRow } from './subagent-provenance/subagent-tool-row.js'
import { NS as SUBAGENT_LOCALE_NAMESPACE } from './subagent-provenance/locales.js'
import { subagentChatAddress } from './subagent-provenance/resource.js'
import { ThreadAsideConversation } from './thread-aside-panel.js'
import { THREAD_ASIDE_CONVERSATION_SLOT, THREAD_ASIDE_ID, THREAD_ASIDE_KIND, threadAsideAddress, threadAsideSessionId } from './thread-aside.js'
import { OPEN_THREAD_ASIDE_EVENT, readThreadAsideRequest } from './thread-aside-request.js'
import { requestThreadMainTab } from './main-tab-request.js'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { HoverPrefetch } from './hover-prefetch.js'
import { sidebarChildren } from './sidebar-contract.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE, threadSidebarLocale } from './locales.js'
import { SidebarOrganization } from './organization.js'
import { NAVIGATION_EVENT } from './navigation-history.js'
import { PaletteBridge } from './palette-bridge.js'
import './client.css'
import { SettingsTab } from './settings-tab.js'
import { ThreadNotificationAudioModel } from './thread-notification-audio.js'
import { createSkillMentionSource } from './skill-mention.js'
import { followUpPrompt } from './follow-up.js'
import {
  buildThreadReferenceInsert,
  classifyThreadMentionFailure,
  decodeThreadMentionInsertRequest,
  summarizeThreadMentionFailure,
  ThreadMentionDrag,
  threadMentionFailureCodeSchema,
  THREAD_MENTION_CAPTURE_EVENT,
  THREAD_MENTION_INSERT_EVENT,
  THREAD_MENTION_TARGET_ATTRIBUTE,
  type ThreadMentionFailureDiagnosticInput,
} from './thread-mention.js'

/** The board page's id: its `main` slot key and its row in the sidebar's panel list. */
const BOARD_PANEL_ID = 'dshfiles-thread-board'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    threadSidebarFollowUp: unknown
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
    'sessionDrafts',
    'conversation',
    'sidebarRight',
    'sidebarRightTabs',
    'resources',
    'remote',
    'remote.session',
    'remote.workspace',
    'remote.sessionReferenceResolver',
    'remote.skills',
    'inputTriggers',
    'modules',
  ],
  // Every registered component reads Settings, so each one goes through decorate.
  setup(ctx, decorate, metadata) {
    const plugin = metadata?.plugin
    if (plugin !== undefined) ctx.effect(() => PaletteBridge.connect(plugin), 'thread-sidebar: palette bridge')
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
            PaletteBridge.open('threads')
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
    ctx.effect(
      () =>
        HoverPrefetch.install({
          root: document,
          rowIdOf: event =>
            event.target instanceof Element
              ? (event.target.closest('[data-thread-main-action][data-thread-id]')?.getAttribute('data-thread-id') ?? null)
              : null,
          warm: threadId => {
            // Only a thread this Host lists: remote-host rows carry ids the local session controller does not own.
            const session = Object.values(ctx.sessions.list.getSnapshot().byId).find(candidate => candidate?.id === threadId)
            if (session === undefined) return
            void ctx.remote.session.page({ address: { kind: 'session', sessionId: session.id }, throughSeq: -1, maxMessages: 1 }).catch(() => undefined)
          },
        }),
      'thread-sidebar: warm a hovered thread',
    )

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

    const ThreadMentionInput = (props: { readonly inputActions: InputActions; readonly sessionId: SessionSummary['id'] }) => {
      const insertion = useRef<ReturnType<InputActions['captureInsertion']> | null>(null)
      const pending = useRef(new Set<AbortController>())
      const marker = useRef<HTMLSpanElement | null>(null)
      const targetSeat = useRef<HTMLElement | null>(null)
      const [dropHint, setDropHint] = useState<{ readonly top: number; readonly left: number } | null>(null)

      useEffect(() => {
        const pendingControllers = pending.current
        const sessionContext = ctx.sessions.scope(props.sessionId)
        if (sessionContext === undefined) return
        const input = ctx.conversation.input.for(sessionContext)
        const clearDropTarget = (): void => {
          targetSeat.current?.removeAttribute(THREAD_MENTION_TARGET_ATTRIBUTE)
          targetSeat.current = null
          setDropHint(null)
        }
        const markDropTarget = (seat: HTMLElement | null): void => {
          if (targetSeat.current === seat) return
          clearDropTarget()
          if (seat === null) return
          targetSeat.current = seat
          seat.setAttribute(THREAD_MENTION_TARGET_ATTRIBUTE, '')
          const box = seat.getBoundingClientRect()
          setDropHint({ top: box.top + 10, left: box.left + 10 })
        }
        /** The seat this mounted composer owns, so a thread dropped on an aside's composer never reaches the main one. */
        const ownSeat = (event: Event): HTMLElement | null => {
          const target = event.target instanceof Element ? event.target : null
          const seat = target?.closest<HTMLElement>('[data-composer-seat]') ?? null
          return seat !== null && marker.current?.closest('[data-composer-seat]') === seat ? seat : null
        }
        const insertMention = (targetSessionId: string, span: ReturnType<InputActions['captureInsertion']>, focusAfterInsert = false): void => {
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
                return
              }
              if (focusAfterInsert) input.focus()
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
        const capture = (): void => {
          insertion.current = props.inputActions.captureInsertion()
        }
        const insert = (event: Event): void => {
          const request = event instanceof CustomEvent ? decodeThreadMentionInsertRequest(event.detail) : null
          if (request === null) return
          if (request.hostSessionId !== undefined && request.hostSessionId !== props.sessionId) return
          const span = insertion.current ?? props.inputActions.captureInsertion()
          insertion.current = null
          insertMention(request.sessionId, span)
        }
        const onDragOver = (event: DragEvent): void => {
          if (!ThreadMentionDrag.has(event.dataTransfer)) return
          const seat = ownSeat(event)
          if (seat === null) {
            clearDropTarget()
            return
          }
          event.preventDefault()
          if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
          markDropTarget(seat)
        }
        const onDragLeave = (event: DragEvent): void => {
          if (!ThreadMentionDrag.has(event.dataTransfer) || targetSeat.current === null) return
          const seat = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-composer-seat]') : null
          if (seat !== targetSeat.current) return
          const next = event.relatedTarget instanceof Node ? event.relatedTarget : null
          if (next !== null && targetSeat.current.contains(next)) return
          clearDropTarget()
        }
        const onDrop = (event: DragEvent): void => {
          if (!ThreadMentionDrag.has(event.dataTransfer)) return
          const seat = ownSeat(event)
          if (seat === null) return
          event.preventDefault()
          event.stopPropagation()
          const targetSessionId = ThreadMentionDrag.read(event.dataTransfer)
          clearDropTarget()
          if (targetSessionId === null) return
          insertMention(targetSessionId, props.inputActions.captureInsertion(), true)
        }

        window.addEventListener(THREAD_MENTION_CAPTURE_EVENT, capture)
        window.addEventListener(THREAD_MENTION_INSERT_EVENT, insert)
        window.addEventListener('dragend', clearDropTarget, true)
        document.addEventListener('dragover', onDragOver, true)
        document.addEventListener('dragleave', onDragLeave, true)
        document.addEventListener('drop', onDrop, true)
        return () => {
          window.removeEventListener(THREAD_MENTION_CAPTURE_EVENT, capture)
          window.removeEventListener(THREAD_MENTION_INSERT_EVENT, insert)
          window.removeEventListener('dragend', clearDropTarget, true)
          document.removeEventListener('dragover', onDragOver, true)
          document.removeEventListener('dragleave', onDragLeave, true)
          document.removeEventListener('drop', onDrop, true)
          clearDropTarget()
          for (const controller of pendingControllers) controller.abort()
          pendingControllers.clear()
        }
      }, [props.inputActions, props.sessionId])

      return (
        <>
          <span ref={marker} hidden data-thread-sidebar-mention-input="" />
          {dropHint === null
            ? null
            : createPortal(
                <span aria-hidden className="dshfiles-thread-mention-hint" style={{ top: dropHint.top, left: dropHint.left }}>
                  {translate('threadSidebarDropToMention')}
                </span>,
                document.body,
              )}
        </>
      )
    }

    ctx.effect(() => {
      const onDragStart = (event: DragEvent): void => {
        const row = event.target instanceof Element ? event.target.closest('[data-thread-main-action][data-thread-id]') : null
        const sessionId = row?.getAttribute('data-thread-id') ?? ''
        if (sessionId === '' || event.dataTransfer === null) return
        ThreadMentionDrag.write(event.dataTransfer, sessionId)
      }
      document.addEventListener('dragstart', onDragStart, true)
      return () => document.removeEventListener('dragstart', onDragStart, true)
    }, 'thread-sidebar: drag a thread row into the composer')
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
    // The composer opens at once; jj-integration's destination bar then moves the blank thread to its own jj
    // workspace (or the project checkout) in the background, so New thread never waits on jj.
    const startSession: SidebarRootInjected['startSession'] = workspaceId => {
      const target = workspaceId ?? currentWorkspaceId()
      if (target === undefined) return ctx.uiWorkspace.startSession()
      ctx.uiWorkspace.startSession(target)
    }
    const rootProps = (): SidebarRootInjected => ({
      startSession,
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
    const runCommand = hasHostCommandRegistry(shortcuts) ? (commandId: string): boolean => runHostCommand(shortcuts, commandId) : null

    const openThread = (sessionId: SessionSummary['id']): void => ctx.uiWorkspace.openSession(sessionId)

    /**
     * Navigation history can point at a thread archived since the visit. Restore it before opening:
     * native navigation clears an archived main Session right after it opens, releasing the reference.
     */
    const openSessionRestoringArchived = (sessionId: SessionSummary['id']): void => {
      if (!ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) {
        openThread(sessionId)
        return
      }
      void ctx.workspaces.unarchiveSession(sessionId).then(
        () => openThread(sessionId),
        () => undefined,
      )
    }

    const SidebarRootAdapter = (props: SidebarShellBaseProps): JSX.Element => (
      <SidebarRoot
        {...props}
        readFooterSnapshot={readFooterSnapshot}
        subscribeFooterSnapshot={subscribeFooterSnapshot}
        readClientRevisionKey={readClientRevisionKey}
        subscribeClientRevisions={subscribeClientRevisions}
        openSession={openSessionRestoringArchived}
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
    const renameSession = async (sessionId: SessionSummary['id'], title: string) => {
      const result = await ctx.remote.session.rename({ sessionId, title })
      if (!result.ok) throw new Error(result.error.message)
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

    const continueInProject = async (sessionId: SessionSummary['id'], projectId: string) => {
      const continued = await createApiClient(ctx, threadActionsApi).continueIn({ sessionId, projectId })
      return { continuedSessionId: SessionId(continued.continuedSessionId), settled: continued.settled }
    }

    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'thread-sidebar-thread-actions',
          order: 100,
          label: () => ctx.locale.bind(THREAD_SIDEBAR_LOCALE_NAMESPACE)('threadSidebarThreadActions'),
          locale: THREAD_SIDEBAR_LOCALE_NAMESPACE,
          inject: () => ({
            archiveSession,
            unarchiveSession,
            pinSession,
            unpinSession,
            openThread,
            continueInProject: async (sessionId: SessionSummary['id'], projectId: string) => (await continueInProject(sessionId, projectId)).continuedSessionId,
          }),
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

    const startFollowUp = (sessionId: SessionSummary['id'], workspaceId: string | undefined): void => {
      if (workspaceId === undefined) return
      const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      if (workspace === undefined) return
      void (async () => {
        try {
          const followUpSessionId = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
          const reference = ctx.sessions.retain(followUpSessionId, { source: 'threadSidebarFollowUp' })
          try {
            await reference.ready
            ctx.conversation.input.requestDraftInitialization(reference.binding, { prompt: followUpPrompt(sessionId), clearPreviousDraft: true })
          } catch (cause) {
            console.warn(`thread-sidebar: follow-up thread ${followUpSessionId} opened without its draft: ${String(cause)}`)
          } finally {
            reference.release()
          }
          ctx.uiWorkspace.openSession(followUpSessionId)
        } catch (cause) {
          console.warn(`thread-sidebar: could not start a follow-up thread: ${String(cause)}`)
        }
      })()
    }

    /** The Host verbs both thread-list surfaces drive: the sidebar list and the full-page board. */
    const threadSidebarActions = () => ({
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
      renameSession,
      startFollowUp,
      drafts: ctx.get('sessionDrafts')?.list,
      startProjectSession: (projectId: string) => {
        // Recheck at the click: deleted or remote projects must never fall back to the current project.
        const project = SidebarOrganization.projectWorkspaces(ctx.workspaces.list.getSnapshot().items).find(item => item.workspaceId === projectId)
        // Every New chat gets its own identity; unfinished drafts are reopened from their rows.
        if (project !== undefined) ctx.uiWorkspace.startSession(project.workspaceId)
      },
      continueInProject,
      open: openThread,
      openLinkedSession: (sessionId: SessionSummary['id']) => {
        const activePanelId = ctx.layout.panelInfo.getSnapshot().activePanelId
        openThread(sessionId)
        if (activePanelId !== null) ctx.layout.selectPanel(activePanelId)
      },
      openRemoteThreads: () => ctx.layout.selectPanel('dshfiles-multi-host-thread' as MainPanelId),
      openRemoteSession: (sessionId: string) => openThread(SessionId(sessionId)),
    })

    ctx.slots.inject('sidebar.workspaces', () =>
      ctx.slots.register(
        {
          name: 'sidebar.workspaces',
          registrant: '@dshfiles/thread-sidebar',
          priority: -1000,
          locale: 'workspace',
          inject: threadSidebarActions,
        },
        decorate(ThreadSidebarWithHistoryLookahead),
      ),
    )

    // The board is a page of its own: the sidebar keeps the list, and this mount reads the same preferences and Host
    // state through the slot runtime's selector hooks while it renders the sections as columns.
    const ThreadBoardPanel = (props: ThreadSidebarStandardProps & ReturnType<typeof threadSidebarActions>): JSX.Element => (
      <SidebarStateProvider>
        <ThreadAsideOpenProvider value={openAside}>
          <ThreadSidebar {...props} surface="board" wide />
        </ThreadAsideOpenProvider>
      </SidebarStateProvider>
    )
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: BOARD_PANEL_ID, inject: threadSidebarActions }, decorate(ThreadBoardPanel)))
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: BOARD_PANEL_ID, order: 2, label: () => translate('threadSidebarBoardTitle'), locale: THREAD_SIDEBAR_LOCALE_NAMESPACE },
        BoardPanelGlyph,
      ),
    )
    ctx.effect(
      () =>
        PaletteBridge.addActions([
          {
            id: '@dshfiles/thread-sidebar/open-board',
            label: () => translate('threadSidebarBoardTitle'),
            aliases: ['thread board', 'board', 'kanban', 'columns'],
            icon: <LayoutGridIcon className="dshx:size-4" />,
            group: 'destination',
            run: () => ctx.layout.selectPanel(BOARD_PANEL_ID as MainPanelId),
          },
        ]),
      'thread-sidebar: open the thread board',
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

    // The aside hands its thread back to the main view. The menu seat belongs to the native right sidebar, so the row
    // is a plain menuitem. The aside closes first: opening the main tab navigates to that thread's Session, and the
    // side panel controller then acts on the Session that just came on screen. A request nobody took puts the aside
    // back, so a profile without @dshfiles/main-tabs keeps the thread where it was.
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.tab.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.right.tab.menu.item', id: 'move-to-main-area', order: 10 },
            (props: PropsRuntime<'sidebar.right.tab.menu.item'>) => {
              const sessionId = threadAsideSessionId(props.tab.contentId)
              if (sessionId === undefined) return null
              return (
                <button
                  type="button"
                  role="menuitem"
                  data-thread-sidebar-move-to-main=""
                  className="dshx:flex dshx:w-full dshx:cursor-pointer dshx:items-center dshx:rounded-(--dsw-radius-md) dshx:border-none dshx:bg-transparent dshx:px-[7px] dshx:py-1 dshx:text-left dshx:text-[length:calc(var(--dsh-content-font-size-secondary,13px)-1px)] dshx:text-(--dsw-alias-label-primary) dshx:hover:bg-(--dsw-alias-interactive-bg-hover)"
                  onClick={() => {
                    props.dismiss()
                    ctx.sidebarRight.close(props.tab.id)
                    if (requestThreadMainTab(sessionId)) return
                    ctx.sidebarRight.openResource(threadAsideAddress(sessionId), { kind: THREAD_ASIDE_KIND })
                  }}
                >
                  {translate('threadSidebarMoveToMainArea')}
                </button>
              )
            },
          ),
        ),
      'thread-sidebar: move an aside to the main view',
    )

    ctx.effect(
      () => ctx.slots.inject(THREAD_ASIDE_CONVERSATION_SLOT, () => ctx.slots.register({ name: THREAD_ASIDE_CONVERSATION_SLOT }, ThreadAsideConversation)),
      'thread-sidebar: aside Conversation',
    )
  },
})

/** Columns of a board: the panel list's glyph for the thread board page. */
const BoardPanelGlyph = (props: { readonly size?: number }): JSX.Element => (
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
    <rect x="3.5" y="4" width="5" height="16" rx="1.5" />
    <rect x="10" y="4" width="5" height="11" rx="1.5" />
    <rect x="16.5" y="4" width="4" height="7" rx="1.5" />
  </svg>
)
