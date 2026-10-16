import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnTailOwnerProps, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-session-log-export/client'
import { createApiClient, defineClient, useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArchiveIcon } from '@dshfiles/plugin-ui/icons'
import { hostDestination, multiHostApi, multiHostQueries, REMOTE_THREAD_PANEL, RemoteComposer } from '@dshfiles/multi-host/destination'
import { errorMessage, PluginQueryProvider, pluginQueryClient, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { createWorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { useCallback, useSyncExternalStore } from 'react'
import { startWorkspaceToggle, type DestinationBarServices } from './destination-bar.js'
import { createComposerWorkspaceNavigation, type ComposerReferenceHandoff } from './composer-workspace-navigation.js'
import { mainViewSessionId } from './main-view-session.js'
import { jjIntegrationApi } from './api.js'
import { HeroWorkspacePicker } from './hero-workspace-picker.js'
import { JJ_INTEGRATION_LOCALE_NAMESPACE, jjIntegrationLocale } from './locales.js'
import { ThreadWorkspacesPanel } from './panel.js'
import { prepareRemoteFolder } from './remote-destination.js'
import { createSessionLogDownloadPort, SessionLogDownloadFeedback, type SessionLogDownloadService } from './session-log-download.js'
import { ThreadWorkspaceControl } from './thread-workspace-control.js'
import { useToast } from './toast.js'
import { deferWorkspaceSubmit } from './workspace-submit.js'
import { jjIntegrationSettings } from './settings.js'
import './client.css'

const PANEL_ID = 'jj-integration'
const RIGHT_PANE_ID = '@dshfiles/jj-integration/thread-workspaces'
const RIGHT_PANE_KIND = 'dshfiles-jj-integration-thread-workspaces'
// The export plugin registers its header cell at the default priority; a lower one shadows it (see SlotCore.register).
const SESSION_LOG_SHADOW_PRIORITY = -1

const PanelGlyph = (props: { readonly size?: number | undefined }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M6 4v16M18 4v16M6 9h7a4 4 0 0 1 4 4v3" />
    <circle cx="6" cy="4" r="1.6" />
    <circle cx="18" cy="20" r="1.6" />
  </svg>
)

const useBookmark = (): string => useSettings(jjIntegrationSettings).value?.bookmark ?? 'main'

// The native project chip names a folder of this machine; while a remote host is chosen the remote folder chip replaces
// it. This rule lives outside client.css so the Tailwind sheet stays byte-identical to every other plugin's and is
// injected once.
const remoteDestinationSheet = `div:has(> [data-slot='conversation.hero.workspace'] [data-remote-destination]) > button:first-child{display:none}`

const isSessionId = (value: string): value is SessionSummary['id'] => value.length > 0

const composerSessionOf = (target: EventTarget | null): { readonly sessionId: SessionSummary['id']; readonly root: Element } | undefined => {
  if (!(target instanceof Element) || target.closest('[data-composer-card]') === null) return undefined
  const root = target.closest('[data-conversation-session]')
  const sessionId = root?.getAttribute('data-conversation-session') ?? ''
  return root !== null && root !== undefined && isSessionId(sessionId) ? { sessionId, root } : undefined
}

const isSendButton = (target: EventTarget | null): boolean => {
  const button = target instanceof Element ? target.closest('button') : null
  return button !== null && /(?:^|\s)\S*_primary(?:\s|$)/u.test(button.className)
}

export default defineClient({
  name: '@dshfiles/jj-integration',
  locales: [jjIntegrationLocale],
  inject: [
    'slots',
    'layout',
    'sessions',
    'workspaces',
    'uiWorkspace',
    'sidebarRight',
    'sidebarRightTabs',
    'conversation',
    'remote',
    'remote.directoryPicker',
    'remote.workspace',
  ],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(JJ_INTEGRATION_LOCALE_NAMESPACE)
    ctx.effect(() => {
      const sheet = document.createElement('style')
      sheet.dataset.dshfilesRemoteDestination = ''
      sheet.textContent = remoteDestinationSheet
      document.head.appendChild(sheet)
      return () => sheet.remove()
    })
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => translate('title'), locale: JJ_INTEGRATION_LOCALE_NAMESPACE },
        PanelGlyph,
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: JJ_INTEGRATION_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <ThreadWorkspacesPanel
              t={props.t}
              bookmark={useBookmark()}
              sessions={ctx.sessions}
              openSession={sessionId => ctx.uiWorkspace.openSession(sessionId)}
            />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: RIGHT_PANE_ID,
          kind: RIGHT_PANE_KIND,
          title: () => translate('title'),
          guide: [
            {
              id: 'thread-workspaces',
              order: 47,
              title: () => translate('title'),
              description: () => translate('sidePanelGuide'),
              icon: PanelGlyph,
            },
          ],
        }),
      'jj-integration: right pane tab type',
    )
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: RIGHT_PANE_ID, locale: JJ_INTEGRATION_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <ThreadWorkspacesPanel
              t={props.t}
              bookmark={useBookmark()}
              sessions={ctx.sessions}
              openSession={sessionId => ctx.uiWorkspace.openSession(sessionId)}
            />
          </PluginQueryProvider>
        )),
      ),
    )
    // SAFETY: The multi-host panel id is registered by @dshfiles/multi-host.
    const openRemoteThreadPanel = (): void => ctx.layout.selectPanel(REMOTE_THREAD_PANEL as MainPanelId)
    const RemoteComposerBar = (): JSX.Element | null => {
      const multiHost = useApi(multiHostApi)
      const destination = hostDestination.useValue()
      const directory = useQuery(multiHostQueries.directory(multiHost))
      if (destination.kind !== 'runtime') return null
      const runtime = directory.data?.runtimes.find(item => item.id === destination.runtimeId)
      return (
        <RemoteComposer
          api={multiHost}
          runtimeId={destination.runtimeId}
          hostName={directory.data?.hosts.find(host => host.id === runtime?.hostId)?.name ?? runtime?.name ?? 'Remote host'}
          cwd={destination.folder}
          prepareCwd={() => prepareRemoteFolder(multiHost, destination)}
          onStarted={openRemoteThreadPanel}
        />
      )
    }
    const composerNavigation = createComposerWorkspaceNavigation({
      selectedWorkspace: () => {
        const sessions = ctx.sessions.list.getSnapshot()
        const current = mainViewSessionId(sessions)
        return ctx.workspaces.list.getSnapshot().items.find(workspace => current !== undefined && workspace.sessionIds.includes(current))?.workspaceId
      },
      subscribe: listener => {
        const unsubscribeSessions = ctx.sessions.list.subscribe(listener)
        const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(listener)
        return () => {
          unsubscribeSessions()
          unsubscribeWorkspaces()
        }
      },
      captureReferences: () => captureComposerReferences(),
      restoreReferences: input => restoreComposerReferences(input),
    })
    const destinationServices: DestinationBarServices = {
      workspaces: ctx.workspaces,
      sessions: ctx.sessions,
      openWorkspace: composerNavigation.open,
      pickWorkspace: composerNavigation.pickWorkspace,
      bindWorkspacePicker: composerNavigation.bind,
      // A blank thread's composer would create a Session on this machine; while a remote host is chosen it sends there.
      takeOverComposer: () =>
        ctx.slots.register(
          { name: 'conversation.composer.bar', priority: -100 },
          decorate(() => (
            <PluginQueryProvider>
              <RemoteComposerBar />
            </PluginQueryProvider>
          )),
        ),
    }
    const jjThreads = createApiClient(ctx, jjIntegrationApi)
    // The notice is thread state, but this slot renders once per completed Turn: only the newest Turn's tail shows it.
    const ThreadRebaseNotice = (props: TurnTailOwnerProps & { readonly sessionId: SessionSummary['id']; readonly useChat: UseChat }): JSX.Element | null => {
      const isNewestTurn = props.useChat(state => {
        const turns = state.navigation.items()
        const newest = turns[turns.length - 1]
        return newest === undefined || newest.turn === props.turn.turn
      })
      const api = useApi(jjIntegrationApi)
      const session = ctx.sessions.list.getSnapshot().byId[props.sessionId]
      const path = session?.cwd
      const status = useQuery({
        queryKey: ['jj-integration', 'thread', path],
        enabled: path !== undefined,
        retry: false,
        queryFn: ({ signal }) =>
          path === undefined
            ? Promise.resolve({ thread: null })
            : runHostRequest({ signal, timeoutMs: 15_000, request: hostSignal => api.threadAt({ path }, { signal: hostSignal }) }).catch(() => ({
                thread: null,
              })),
      })
      const bookmark = useBookmark()
      const subscribeToSessions = useCallback((listener: () => void) => ctx.sessions.list.subscribe(listener), [])
      const sessionRunning = useSyncExternalStore(
        subscribeToSessions,
        () => ctx.sessions.list.getSnapshot().byId[props.sessionId]?.running === true,
        () => true,
      )
      const subscribeToWorkspaces = useCallback((listener: () => void) => ctx.workspaces.list.subscribe(listener), [])
      const archived = useSyncExternalStore(
        subscribeToWorkspaces,
        () => ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(props.sessionId),
        () => false,
      )
      const archiveToast = useToast()
      const archive = useMutation({
        mutationFn: () => ctx.workspaces.archiveSession(props.sessionId),
        onError: error => archiveToast.show({ text: errorMessage(error, translate('archiveFailed')), success: false }),
      })
      const rebasedAt = status.data?.thread?.rebasedAt
      if (rebasedAt === undefined || rebasedAt === null || !isNewestTurn) return archiveToast.element
      const rebasedTipChangeId = status.data?.thread?.rebasedTipChangeId
      const notice =
        rebasedTipChangeId === undefined
          ? translate('rebaseNotice', { bookmark })
          : translate('rebaseNoticeWithTip', { bookmark, revisionId: rebasedTipChangeId })
      return (
        <>
          <div
            data-testid="jj-thread-rebased-notice"
            className="dshx-root dshx:mx-auto dshx:my-3 dshx:flex dshx:max-w-3xl dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:bg-muted/40 dshx:px-3 dshx:py-2 dshx:text-sm dshx:text-muted-foreground"
          >
            <span className="dshx:min-w-0 dshx:flex-1">{notice}</span>
            <time className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums" dateTime={new Date(rebasedAt).toISOString()}>
              {new Date(rebasedAt).toLocaleString()}
            </time>
            {archived ? null : (
              <Button
                aria-label={translate('archiveRebasedThread')}
                disabled={sessionRunning || archive.isPending}
                onClick={() => archive.mutate()}
                size="sm"
                title={translate('archiveRebasedThread')}
                type="button"
                variant="outline"
              >
                {archive.isPending ? null : <ArchiveIcon aria-hidden="true" size={16} />}
                {archive.isPending ? translate('archivingThread') : translate('archiveThread')}
              </Button>
            )}
          </div>
          {archiveToast.element}
        </>
      )
    }
    // The notice describes the thread, not a turn: `conversation.chat.turnTail` would repeat
    // it after every turn, so it belongs in the dock, beside the other thread-level banners.
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'dshfiles-jj-integration-rebased-notice',
          order: 1,
          inject: sessionId => ({ sessionId: SessionId(sessionId) }),
        },
        decorate((props: TurnTailOwnerProps & { readonly sessionId: SessionSummary['id']; readonly useChat: UseChat }) => (
          <PluginQueryProvider>
            <ThreadRebaseNotice {...props} />
          </PluginQueryProvider>
        )),
      ),
    )
    const workspaceToggle = startWorkspaceToggle({
      provision: (input, options) => jjThreads.provision(input, options),
      services: destinationServices,
      t: translate,
      queryClient: pluginQueryClient(),
    })
    const pendingSubmissions = new Map<SessionSummary['id'], AbortController>()
    const workspaceComposerFor = (sessionId?: SessionSummary['id']) => {
      const sessions = ctx.sessions.list.getSnapshot()
      const currentId = mainViewSessionId(sessions)
      if (currentId === undefined || (sessionId !== undefined && currentId !== sessionId)) return undefined
      const session = sessions.byId[currentId]
      const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(currentId))
      const scoped = ctx.sessions.scope(currentId)
      if (session === undefined || workspace === undefined || scoped === undefined) return undefined
      return { sessionId: currentId, workspaceId: workspace.workspaceId, blank: session.blank, input: ctx.conversation.input.for(scoped) }
    }
    const captureComposerReferences = (): ComposerReferenceHandoff | undefined => {
      const composer = workspaceComposerFor()
      if (composer === undefined || !composer.blank) return undefined
      const state = composer.input.state.getSnapshot()
      if (state.occurrences.length === 0) return undefined
      return { draft: state.draft, occurrences: state.occurrences.map(occurrence => ({ ...occurrence })) }
    }
    const restoreComposerReferences = (input: {
      readonly workspaceId: string
      readonly handoff: ComposerReferenceHandoff
      readonly signal: AbortSignal
    }): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        if (input.signal.aborted) {
          reject(input.signal.reason)
          return
        }
        let unsubscribeSessions = (): void => undefined
        let unsubscribeWorkspaces = (): void => undefined
        let unsubscribeInput: (() => void) | undefined
        let subscribed = false
        let checking = false
        let settled = false
        const cleanup = (): void => {
          if (settled) return
          settled = true
          unsubscribeSessions()
          unsubscribeWorkspaces()
          unsubscribeInput?.()
          input.signal.removeEventListener('abort', abort)
        }
        const finish = (): void => {
          cleanup()
          resolve()
        }
        const abort = (): void => {
          cleanup()
          reject(input.signal.reason)
        }
        const changed = (): void => {
          if (!subscribed || checking || settled) return
          checking = true
          try {
            const composer = workspaceComposerFor()
            if (composer === undefined || !composer.blank || composer.workspaceId !== input.workspaceId) {
              unsubscribeInput?.()
              unsubscribeInput = undefined
              return
            }
            unsubscribeInput ??= composer.input.state.subscribe(changed)
            const snapshot = composer.input.state.getSnapshot()
            if (snapshot.draft === '') return
            if (snapshot.draft !== input.handoff.draft) {
              composer.input.notify('error', translate('workspaceReferenceRestoreFailed'))
              finish()
              return
            }
            for (const occurrence of input.handoff.occurrences.toReversed()) {
              const current = composer.input.state.getSnapshot()
              const alreadyPresent = current.occurrences.some(
                candidate =>
                  candidate.offset === occurrence.offset &&
                  candidate.source === occurrence.source &&
                  candidate.ref === occurrence.ref &&
                  candidate.clipboardText === occurrence.clipboardText,
              )
              if (alreadyPresent) continue
              const text = current.draft.slice(occurrence.offset, occurrence.offset + occurrence.length)
              if (text !== occurrence.clipboardText) {
                composer.input.notify('error', translate('workspaceReferenceRestoreFailed'))
                finish()
                return
              }
              // Clipboard offsets expand earlier chips; editor spans count each existing chip as one position.
              const collapsedPrefixLength = current.occurrences
                .filter(candidate => candidate.offset < occurrence.offset)
                .reduce((total, candidate) => total + candidate.length - 1, 0)
              const detectOffset = occurrence.offset - collapsedPrefixLength
              const reference =
                occurrence.appearance === undefined
                  ? {
                      source: occurrence.source,
                      ref: occurrence.ref,
                      label: occurrence.label,
                      clipboardText: occurrence.clipboardText,
                    }
                  : {
                      source: occurrence.source,
                      ref: occurrence.ref,
                      label: occurrence.label,
                      appearance: occurrence.appearance,
                      clipboardText: occurrence.clipboardText,
                    }
              const inserted = composer.input.insertReference(reference, {
                start: detectOffset,
                end: detectOffset + occurrence.length,
                draftRev: current.draftRev,
              })
              if (!inserted) {
                composer.input.notify('error', translate('workspaceReferenceRestoreFailed'))
                finish()
                return
              }
            }
            finish()
          } catch (error) {
            cleanup()
            reject(error)
          } finally {
            checking = false
          }
        }
        unsubscribeSessions = ctx.sessions.list.subscribe(changed)
        unsubscribeWorkspaces = ctx.workspaces.list.subscribe(changed)
        input.signal.addEventListener('abort', abort, { once: true })
        subscribed = true
        if (input.signal.aborted) abort()
        else changed()
      })
    const stopSubmit = (event: Event): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const deferSubmit = (event: Event, sessionId: SessionSummary['id'], submitSource: 'click' | 'enter'): void => {
      const existing = pendingSubmissions.get(sessionId)
      if (existing !== undefined) {
        stopSubmit(event)
        return
      }
      const toggleSnapshot = workspaceToggle.getSnapshot()
      if (toggleSnapshot.matches('idle')) return
      const source = workspaceComposerFor(sessionId)
      if (source === undefined || !source.blank) return
      const state = source.input.state.getSnapshot()
      if (state.phase !== 'plain' || (state.draft.trim() === '' && state.attachmentIds.length === 0)) return
      stopSubmit(event)
      const controller = new AbortController()
      pendingSubmissions.set(sessionId, controller)
      const name = toggleSnapshot.context.pending?.name ?? null
      const reason = name === null ? translate('switchingDestination') : translate('preparingWorkspace', { name })
      void deferWorkspaceSubmit({
        actor: workspaceToggle,
        source,
        submitSource,
        current: () => workspaceComposerFor(),
        blocks: ctx.conversation.blocks,
        reason,
        failureMessage: translate('workspaceSendFailed'),
        changedMessage: translate('workspaceSendChanged'),
        signal: controller.signal,
      })
        .catch(() => source.input.notify('error', translate('workspaceSendFailed')))
        .finally(() => {
          if (pendingSubmissions.get(sessionId) === controller) pendingSubmissions.delete(sessionId)
        })
    }
    const onSubmitKeyDown = (event: KeyboardEvent): void => {
      const target = composerSessionOf(event.target)
      if (target === undefined) return
      if (event.key === 'Escape') {
        const controller = pendingSubmissions.get(target.sessionId)
        if (controller === undefined) return
        stopSubmit(event)
        controller.abort()
        return
      }
      if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing) return
      if (target.root.querySelector('[role="listbox"]') !== null) return
      deferSubmit(event, target.sessionId, 'enter')
    }
    const onSubmitClick = (event: MouseEvent): void => {
      if (!isSendButton(event.target)) return
      const target = composerSessionOf(event.target)
      if (target === undefined) return
      deferSubmit(event, target.sessionId, 'click')
    }
    ctx.effect(() => {
      window.addEventListener('keydown', onSubmitKeyDown, true)
      window.addEventListener('click', onSubmitClick, true)
      return () => {
        window.removeEventListener('keydown', onSubmitKeyDown, true)
        window.removeEventListener('click', onSubmitClick, true)
        for (const controller of pendingSubmissions.values()) controller.abort()
        pendingSubmissions.clear()
      }
    }, 'jj-integration: defer send until workspace is ready')
    ctx.effect(() => () => workspaceToggle.stop(), 'jj-integration: workspace toggle')
    const pickerPorts = createWorkspacePickerPorts(ctx.remote)
    ctx.slots.inject('conversation.hero.workspace', () =>
      ctx.slots.register(
        { name: 'conversation.hero.workspace', priority: -1000 },
        decorate((props: EmptyWorkspaceOwnerProps) => (
          <PluginQueryProvider>
            <HeroWorkspacePicker {...props} ports={pickerPorts} services={destinationServices} toggle={workspaceToggle} t={translate} />
          </PluginQueryProvider>
        )),
      ),
    )
    // The export plugin draws its trigger and its progress modal in one header cell. A lower priority shadows that
    // cell, so this plugin owns the trigger (a row in the workspace menu) and keeps the feedback the modal carried.
    const sessionLog = createSessionLogDownloadPort()
    ctx.inject(['sessionLogDownload'], scoped => {
      const controller = scoped.sessionLogDownload
      sessionLog.current = controller
      scoped.effect(
        () =>
          scoped.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'session-log-download',
              priority: SESSION_LOG_SHADOW_PRIORITY,
              inject: sessionId => ({ sessionId, controller }),
            },
            (props: { readonly sessionId: SessionId; readonly controller: SessionLogDownloadService }) => (
              <SessionLogDownloadFeedback sessionId={props.sessionId} controller={props.controller} t={translate} />
            ),
          ),
        'jj-integration: session log export feedback replaces the native header cell',
      )
      scoped.effect(
        () => () => {
          sessionLog.current = undefined
        },
        'jj-integration: session log download port',
      )
    })
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'dshfiles-jj-integration-thread-workspace', order: 38, inject: sessionId => ({ sessionId }) },
        decorate((props: { readonly sessionId: Parameters<typeof ThreadWorkspaceControl>[0]['sessionId'] }) => (
          <PluginQueryProvider>
            <ThreadWorkspaceControl
              sessionId={props.sessionId}
              sessions={ctx.sessions}
              t={translate}
              bookmark={useBookmark()}
              sessionLog={sessionLog}
              openThreadWorkspaces={() => ctx.sidebarRight.openTab(RIGHT_PANE_KIND, { revealIfOpened: true })}
            />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
