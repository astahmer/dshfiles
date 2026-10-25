import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { EmptyWorkspaceOwnerProps, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-session-log-export/client'
import { createApiClient, defineClient, useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ArchiveIcon, CircleCheckIcon, ClockIcon, GitMergeIcon, Undo2Icon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, PluginQueryProvider, pluginQueryClient, useIsMutating, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { createWorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { startWorkspaceToggle, type DestinationBarServices } from './destination-bar.js'
import { createComposerWorkspaceNavigation, type ComposerReferenceHandoff } from './composer-workspace-navigation.js'
import { mainViewSessionId, mainViewSessionVisitId } from './main-view-session.js'
import { jjIntegrationApi, threadWorkspaceName } from './api.js'
import { workspaceHasOtherSession } from './thread-session-ownership.js'
import { HeroWorkspacePicker } from './hero-workspace-picker.js'
import { IntegrationTimeline, type IntegrationRecord } from './integration-timeline.js'
import { InlineIntegrateOffer } from './inline-integrate.js'
import { IntegrationRecovery } from './integration-recovery.js'
import { announceRepositoryChange, describeLandResult } from './land-feedback.js'
import { JJ_INTEGRATION_LOCALE_NAMESPACE, jjIntegrationLocale } from './locales.js'
import { ThreadWorkspacesPanel, threadQueryKeys, threadRebaseMutationKey } from './panel.js'
import { revisionGraphQueryKey } from './revision-graph-hover-card.js'
import { createSessionLogDownloadPort, SessionLogDownloadFeedback, type SessionLogDownloadService } from './session-log-download.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'
import { ThreadNotices, ThreadNoticeToast } from './thread-notices.js'
import { ThreadPreparation, ThreadWarmup } from './thread-warmup.js'
import { ThreadRebaseEligibilityModel } from './thread-rebase-eligibility.js'
import { ThreadWorkspaceControl } from './thread-workspace-control.js'
import { useToast } from './toast.js'
import { DraftAttachmentCarry } from './draft-attachment-carry.js'
import { deferWorkspaceSubmit, deliverFirstSend } from './workspace-submit.js'
import { defersIsolationToSend, ownsIsolatedThreadWorkspace, WorkspaceToggle, type DeferredMove, type ToggleRequest } from './workspace-toggle-machine.js'
import { defaultJjIntegrationSettings, IntegratedNoticeActions, jjIntegrationSettings } from './settings.js'
import { requestThreadSettle } from './settle-request.js'
import { requestReplaceThreadTab } from './main-tab-replacement.js'
import { TurnEndStatusRefresh } from './turn-end-status-refresh.js'

const PANEL_ID = 'jj-integration'
const RIGHT_PANE_ID = '@dshfiles/jj-integration/thread-workspaces'
const RIGHT_PANE_KIND = 'dshfiles-jj-integration-thread-workspaces'
/** `@dshfiles/main-tabs` asks this for the panel's right-pane view when its main tab is dropped there. */
const PANEL_ASIDE_EVENT = 'dshfiles:move-panel-aside'
const panelAsideRequestSchema = z.object({ panelId: z.string().min(1) }).strict()
// The export plugin registers its header cell at the default priority; a lower one shadows it (see SlotCore.register).
const SESSION_LOG_SHADOW_PRIORITY = -1

/** A Host that validates a request against an older schema rejects it as `contract`, never as a transport failure. */
const contractRejectionSchema = z.looseObject({ kind: z.literal('contract') })
const isContractRejection = (error: unknown): boolean => contractRejectionSchema.safeParse(error).success

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
    // One panel with two homes: a main tab and a right-pane tab. Moving between them is this plugin's business, so it
    // answers the strip's request and offers the reverse row on its own right-pane tab.
    const isMainPanel = (id: string): id is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)
    ctx.effect(() => {
      const onMovePanelAside = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return
        const request = panelAsideRequestSchema.safeParse(event.detail)
        if (!request.success || request.data.panelId !== PANEL_ID || ctx.sidebarRight.mounted.getSnapshot() === undefined) return
        event.preventDefault()
        ctx.sidebarRight.openTab(RIGHT_PANE_KIND, { revealIfOpened: true })
      }
      window.addEventListener(PANEL_ASIDE_EVENT, onMovePanelAside)
      return () => window.removeEventListener(PANEL_ASIDE_EVENT, onMovePanelAside)
    }, 'jj-integration: move the panel into the side panel')
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.tab.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.right.tab.menu.item', id: 'jj-integration-move-to-main', order: 10 },
            (props: PropsRuntime<'sidebar.right.tab.menu.item'>) => {
              if (props.tab.kind !== RIGHT_PANE_KIND) return null
              return (
                <button
                  type="button"
                  role="menuitem"
                  className="dshx:flex dshx:w-full dshx:cursor-pointer dshx:items-center dshx:rounded-(--dsw-radius-md) dshx:border-none dshx:bg-transparent dshx:px-[7px] dshx:py-1 dshx:text-left dshx:text-[length:calc(var(--dsh-content-font-size-secondary,13px)-1px)] dshx:text-(--dsw-alias-label-primary) dshx:hover:bg-(--dsw-alias-interactive-bg-hover)"
                  onClick={() => {
                    props.dismiss()
                    if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) ctx.sidebarRight.close(props.tab.id)
                    if (isMainPanel(PANEL_ID)) ctx.layout.selectPanel(PANEL_ID)
                  }}
                >
                  {translate('moveToMainArea')}
                </button>
              )
            },
          ),
        ),
      'jj-integration: move the side-panel view to the main area',
    )
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
      openSession: sessionId => ctx.uiWorkspace.openSession(SessionId(sessionId)),
    }
    const jjThreads = createApiClient(ctx, jjIntegrationApi)
    const integrationTimeline = new IntegrationTimeline()
    const TURN_END_STATUS_REFRESH_WINDOW_MS = 30_000
    const ThreadIntegrationMarkers = (props: { readonly turn: TurnLocation; readonly sessionId: SessionSummary['id'] }): JSX.Element | null => {
      const api = useApi(jjIntegrationApi)
      const turnStartedAt = props.turn.start?.time ?? props.turn.end?.time
      useLayoutEffect(() => {
        if (turnStartedAt !== undefined) integrationTimeline.publishTurnStart({ sessionId: props.sessionId, turn: props.turn.turn, startedAt: turnStartedAt })
      }, [props.sessionId, props.turn.turn, turnStartedAt])
      const nextTurnStartedAt = useSyncExternalStore(
        integrationTimeline.subscribe,
        () => integrationTimeline.nextTurnStartedAt({ sessionId: props.sessionId, turn: props.turn.turn }),
        () => undefined,
      )
      const newestTurnHasEnded = props.turn.end?.time !== undefined && nextTurnStartedAt === undefined
      const subscribeToSessions = useCallback((listener: () => void) => ctx.sessions.list.subscribe(listener), [])
      const path = ctx.sessions.list.getSnapshot().byId[props.sessionId]?.cwd
      const statusQueryKey = useMemo(() => threadQueryKeys.threadAt(path ?? '', props.sessionId), [path, props.sessionId])
      // Every Turn tail of a Session shares this query key, so one jj read serves the whole conversation.
      const status = useQuery({
        queryKey: statusQueryKey,
        enabled: path !== undefined,
        retry: false,
        queryFn: ({ signal }) => {
          if (path === undefined) return Promise.resolve({ thread: null })
          const read = (input: { readonly path: string; readonly sessionId?: string }) =>
            runHostRequest({ signal, timeoutMs: 15_000, request: hostSignal => api.threadAt(input, { signal: hostSignal }) })
          return read({ path, sessionId: props.sessionId }).catch(error => {
            // A Host from before per-conversation land attribution rejects the extra field; its workspace-wide view still works.
            if (!isContractRejection(error)) return { thread: null }
            return read({ path }).catch(() => ({ thread: null }))
          })
        },
        // Refresh briefly after the newest turn so a status read racing its final JJ write cannot hide the offer.
        refetchInterval: query => {
          const thread = query.state.data?.thread
          if (thread?.integrationQueuedAt !== undefined) return 2_000
          if (
            !newestTurnHasEnded ||
            turnStartedAt === undefined ||
            thread === null ||
            thread === undefined ||
            thread.unlanded.length > 0 ||
            props.turn.end?.time === undefined ||
            Date.now() >= props.turn.end.time + TURN_END_STATUS_REFRESH_WINDOW_MS
          )
            return false
          const integrations = thread.integrations ?? (thread.rebasedAt === undefined ? [] : [{ at: thread.rebasedAt }])
          if (integrations.some(integration => integration.at >= turnStartedAt)) return false
          return 5_000
        },
      })
      // Refresh immediately when the newest Turn ends: the query was read while it ran, so its cached status still
      // says "nothing to integrate" and the offer would wait for the fallback poll.
      const queryClient = useQueryClient()
      const statusRefresh = useRef<TurnEndStatusRefresh | null>(null)
      statusRefresh.current ??= new TurnEndStatusRefresh(props.turn.end?.time)
      const [statusRefreshBaseline, setStatusRefreshBaseline] = useState<number | null>(null)
      useLayoutEffect(() => {
        if (!statusRefresh.current?.take({ newestTurnHasEnded, endedAt: props.turn.end?.time })) return
        setStatusRefreshBaseline(status.dataUpdatedAt)
        void queryClient.invalidateQueries({ queryKey: statusQueryKey, exact: true })
      }, [newestTurnHasEnded, props.turn.end?.time, queryClient, status.dataUpdatedAt, statusQueryKey])
      const turnEndRefreshPending = statusRefreshBaseline !== null && status.dataUpdatedAt <= statusRefreshBaseline
      const bookmark = useBookmark()
      const thread = status.data?.thread
      const threadPath = thread?.path ?? path
      const threadSessionIds = useMemo(
        () => thread?.sessionIds ?? (path === undefined ? [] : [String(props.sessionId)]),
        [thread?.sessionIds, path, props.sessionId],
      )
      const sessionRunning = useSyncExternalStore(
        subscribeToSessions,
        () => ctx.sessions.list.getSnapshot().byId[props.sessionId]?.running === true,
        () => true,
      )
      // The workspace's activity, not just this Session's: a sibling thread writing in the same workspace blocks
      // integration here exactly as it blocks the header control.
      const readWorkspaceRunning = useCallback(
        (): boolean =>
          Object.values(ctx.sessions.list.getSnapshot().byId).some(
            session => session.running && (threadSessionIds.includes(String(session.id)) || (threadPath !== undefined && session.cwd === threadPath)),
          ),
        [threadSessionIds, threadPath],
      )
      const readWorkspaceQuestion = useCallback((): boolean => {
        const sessions = ctx.sessions.list.getSnapshot().byId
        const asks = (session: SessionSummary | undefined): boolean => ThreadRebaseEligibilityModel.hasPendingUserQuestion(session?.projectionValues) === true
        return (
          threadSessionIds.some(sessionId => asks(sessions[SessionId(sessionId)])) ||
          (threadPath !== undefined && Object.values(sessions).some(session => session.cwd === threadPath && asks(session)))
        )
      }, [threadSessionIds, threadPath])
      const readClientCanRebase = useCallback(
        (): boolean | undefined =>
          ThreadRebaseEligibilityModel.canRebase(threadSessionIds, sessionId => {
            const session = ctx.sessions.list.getSnapshot().byId[SessionId(sessionId)]
            return session === undefined
              ? undefined
              : { running: session.running, pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(session.projectionValues) }
          }),
        [threadSessionIds],
      )
      const workspaceRunning = useSyncExternalStore(subscribeToSessions, readWorkspaceRunning, () => true)
      const workspaceWaitingForInput = useSyncExternalStore(subscribeToSessions, readWorkspaceQuestion, () => true)
      const clientCanRebase = useSyncExternalStore(subscribeToSessions, readClientCanRebase, () => false)
      const canRebase = ThreadRebaseEligibilityModel.fromClientSnapshot({
        threadSessionsEligible: clientCanRebase,
        sessionRunning: workspaceRunning,
        questionPending: workspaceWaitingForInput,
      })
      const assessment =
        thread === null || thread === undefined
          ? undefined
          : ThreadIntegrationModel.assess({ thread, running: workspaceRunning, waitingForInput: workspaceWaitingForInput, integrationAllowed: canRebase })
      const landing = useIsMutating({ mutationKey: threadRebaseMutationKey }) > 0
      const subscribeToWorkspaces = useCallback((listener: () => void) => ctx.workspaces.list.subscribe(listener), [])
      const archived = useSyncExternalStore(
        subscribeToWorkspaces,
        () => ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(props.sessionId),
        () => false,
      )
      const noticeToast = useToast()
      const archive = useMutation({
        mutationFn: () => ctx.workspaces.archiveSession(props.sessionId),
        onError: error => noticeToast.show({ text: errorMessage(error, translate('archiveFailed')), success: false }),
      })
      const settings = useSettings(jjIntegrationSettings).value ?? defaultJjIntegrationSettings
      const noticeActions = IntegratedNoticeActions.forSettings(settings)
      const [settledHere, setSettledHere] = useState(false)
      const settle = (): void => {
        if (!requestThreadSettle(props.sessionId)) {
          noticeToast.show({ text: translate('settleUnavailable'), success: false })
          return
        }
        setSettledHere(true)
      }
      const cancelQueue = useMutation({
        mutationFn: () => {
          if (thread === null || thread === undefined) throw new Error(translate('unknownWorkspace'))
          return runHostRequest({ timeoutMs: 30_000, request: signal => api.cancelQueuedLand({ path: thread.path }, { signal }) })
        },
        onSuccess: async result => {
          announceRepositoryChange()
          await pluginQueryClient().invalidateQueries({ queryKey: ['jj-integration', 'thread', path] })
          if (result.status === 'integrating') noticeToast.show({ text: translate('queuedIntegrationAlreadyRunning'), success: false })
        },
        onError: error => noticeToast.show({ text: errorMessage(error, translate('loadFailed')), success: false }),
      })
      const land = useMutation({
        mutationKey: threadRebaseMutationKey,
        mutationFn: (landedPath: string) =>
          runHostRequest({ timeoutMs: 300_000, request: signal => api.land({ path: landedPath, sessionId: props.sessionId }, { signal }) }),
        onError: (error, landedPath) => {
          if (IntegrationRecovery.isQueued(error)) {
            noticeToast.show({ text: translate('integrationQueuedHint', { bookmark }), success: true })
            void pluginQueryClient().invalidateQueries({ queryKey: threadQueryKeys.threadAt(landedPath) })
            return
          }
          noticeToast.show({ text: errorMessage(error, translate('loadFailed')), success: false })
        },
        onSettled: async (result, _error, landedPath) => {
          announceRepositoryChange()
          await pluginQueryClient().invalidateQueries({ queryKey: threadQueryKeys.threadAt(landedPath) })
          await pluginQueryClient().invalidateQueries({ queryKey: revisionGraphQueryKey(landedPath) })
          if (result !== undefined && result !== null) noticeToast.show({ text: describeLandResult(translate, result), success: result.status === 'landed' })
        },
      })
      if (thread === null || thread === undefined || turnStartedAt === undefined) return noticeToast.element
      const integrations = thread.integrations ?? (thread.rebasedAt === undefined ? [] : [{ at: thread.rebasedAt, tipChangeId: thread.rebasedTipChangeId }])
      const queueEvents = [...(thread.integrationQueueEvents ?? [])]
      if (thread.integrationQueuedAt !== undefined && !queueEvents.some(event => event.kind === 'queued' && event.at === thread.integrationQueuedAt)) {
        queueEvents.push({ at: thread.integrationQueuedAt, kind: 'queued' })
      }
      const events = [...integrations.map(marker => ({ ...marker, kind: 'integrated' }) satisfies IntegrationRecord), ...queueEvents].sort(
        (left, right) => left.at - right.at,
      )
      const activeQueueMarker = events.findLast(event => event.kind === 'queued' && event.at === thread.integrationQueuedAt)
      const markers = IntegrationTimeline.forTurn({ integrations: events, turnStartedAt, nextTurnStartedAt })
      const offered = InlineIntegrateOffer.isOffered({
        category: assessment?.category ?? 'no-changes',
        isNewestTurn: nextTurnStartedAt === undefined,
        archived,
        landing,
        queued: thread.integrationQueuedAt !== undefined,
        turnEndRefreshPending,
      })
      if (markers.length === 0 && !offered) return noticeToast.element
      return (
        <>
          {markers.map((marker, index) => (
            <div
              key={`${marker.kind}-${marker.at}-${index}`}
              data-testid={marker.kind === 'integrated' ? 'jj-thread-rebased-notice' : `jj-thread-integration-${marker.kind}-notice`}
              className="dshx-root dshx:my-3 dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground"
            >
              {marker.kind === 'integrated' ? (
                <GitMergeIcon aria-hidden="true" className="dshx:shrink-0" size={14} />
              ) : (
                <ClockIcon aria-hidden="true" className="dshx:shrink-0" size={14} />
              )}
              <span className="dshx:min-w-0">
                {marker.kind === 'integrated'
                  ? marker.tipChangeId === undefined
                    ? translate('rebaseNotice', { bookmark })
                    : translate('rebaseNoticeWithTip', { bookmark, revisionId: marker.tipChangeId })
                  : translate(marker.kind === 'queued' ? 'integrationQueuedNotice' : 'integrationUnqueuedNotice', { bookmark })}
              </span>
              <time className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums" dateTime={new Date(marker.at).toISOString()}>
                {new Date(marker.at).toLocaleString()}
              </time>
              <span aria-hidden="true" className="dshx:h-px dshx:min-w-4 dshx:flex-1 dshx:bg-border" />
              {marker !== activeQueueMarker ? null : (
                <Button
                  aria-label={translate('undoQueuedIntegrationLabel', { bookmark })}
                  disabled={cancelQueue.isPending}
                  onClick={() => cancelQueue.mutate()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Undo2Icon aria-hidden="true" size={14} />
                  {translate('undoQueuedIntegration')}
                </Button>
              )}
              {archived || marker.kind !== 'integrated' || marker.at !== thread.rebasedAt ? null : (
                <>
                  {noticeActions.includes('settle') && !settledHere ? (
                    <Button
                      aria-label={translate('settleRebasedThread')}
                      disabled={sessionRunning}
                      onClick={settle}
                      size="sm"
                      title={translate('settleRebasedThread')}
                      type="button"
                      variant="ghost"
                    >
                      <CircleCheckIcon aria-hidden="true" size={16} />
                      {translate('settleThread')}
                    </Button>
                  ) : null}
                  {noticeActions.includes('archive') ? (
                    <Button
                      aria-label={translate('archiveRebasedThread')}
                      disabled={sessionRunning || archive.isPending}
                      onClick={() => archive.mutate()}
                      size="sm"
                      title={translate('archiveRebasedThread')}
                      type="button"
                      variant="ghost"
                    >
                      {archive.isPending ? null : <ArchiveIcon aria-hidden="true" size={16} />}
                      {archive.isPending ? translate('archivingThread') : translate('archiveThread')}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          ))}
          {offered ? (
            // The header control stays the permanent entry point; this is the same land action one click from the
            // answer the user just read, and it disappears as soon as the work is integrated.
            <div
              className="dshx-root dshx:my-3 dshx:flex dshx:w-full dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/40 dshx:px-3 dshx:py-2"
              data-testid="jj-inline-integrate-offer"
            >
              <GitMergeIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
              <p className="dshx:min-w-0 dshx:flex-1 dshx:text-sm dshx:text-muted-foreground">
                {translate('inlineIntegrateHint', { count: thread.unlanded.length, bookmark })}
              </p>
              <Button
                aria-label={translate('rebaseOnto', { bookmark })}
                className="dshx-root dshx:shrink"
                disabled={landing}
                onClick={() => land.mutate(thread.path)}
                size="sm"
                title={translate('rebaseThread', { bookmark })}
                type="button"
              >
                {land.isPending ? <Spinner /> : <GitMergeIcon aria-hidden="true" className="dshx:size-3.5" />}
                {land.isPending ? translate('rebasing') : translate('rebaseOnto', { bookmark })}
              </Button>
            </div>
          ) : null}
          {noticeToast.element}
        </>
      )
    }
    // A thread can land, keep working and land again, so each land reads inline after the Turn it followed, like the
    // other Turn-end notes, instead of one thread-level banner that only knew the latest.
    ctx.slots.inject('conversation.chat.turnTail', () =>
      ctx.slots.register(
        {
          name: 'conversation.chat.turnTail',
          id: 'dshfiles-jj-integration-rebased-notice',
          order: 1,
          inject: sessionId => ({ sessionId: SessionId(sessionId) }),
        },
        decorate((props: { readonly turn: TurnLocation; readonly sessionId: SessionSummary['id'] }) => (
          <PluginQueryProvider>
            <ThreadIntegrationMarkers {...props} />
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
    /** Turn a moved draft's clipboard text back into the reference chips the source composer held. */
    const rebuildReferences = (target: ReturnType<typeof ctx.conversation.input.for>, handoff: ComposerReferenceHandoff): boolean => {
      for (const occurrence of handoff.occurrences.toReversed()) {
        const current = target.state.getSnapshot()
        const alreadyPresent = current.occurrences.some(
          candidate =>
            candidate.offset === occurrence.offset &&
            candidate.source === occurrence.source &&
            candidate.ref === occurrence.ref &&
            candidate.clipboardText === occurrence.clipboardText,
        )
        if (alreadyPresent) continue
        const text = current.draft.slice(occurrence.offset, occurrence.offset + occurrence.length)
        if (text !== occurrence.clipboardText) return false
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
        const inserted = target.insertReference(reference, {
          start: detectOffset,
          end: detectOffset + occurrence.length,
          draftRev: current.draftRev,
        })
        if (!inserted) return false
      }
      return true
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
            if (!rebuildReferences(composer.input, input.handoff)) composer.input.notify('error', translate('workspaceReferenceRestoreFailed'))
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
    // The destination bar resolves a move from its own query, which unmounts (and is cancelled) when another New thread
    // opens; a send asks the Host itself.
    const resolveMove = async (move: DeferredMove, signal: AbortSignal, options: { readonly force: boolean }): Promise<ToggleRequest | null> => {
      const destination = await runHostRequest({
        signal,
        timeoutMs: 30_000,
        request: hostSignal => jjThreads.destination({ workspaceId: move.workspaceId, sessionId: move.sessionId }, { signal: hostSignal }),
      })
      if (options.force) return WorkspaceToggle.isolatingMove({ destination, workspaceId: move.workspaceId })
      return ownsIsolatedThreadWorkspace(destination) ? null : WorkspaceToggle.defaultDestinationMove({ destination, workspaceId: move.workspaceId })
    }
    /**
     * The last line of defence against two threads sharing one jj thread workspace: whatever the toggle remembers, a
     * blank Session sending from a thread workspace another Session uses moves to a fresh one first.
     */
    // One forced move per blank Session and workspace: the name it generates is carried by the warm and the send, so
    // asking twice must not propose two destinations.
    const sharedWorkspaceMoves = new Map<string, DeferredMove>()
    const sharedThreadWorkspaceMove = (sessionId: SessionSummary['id'], workspaceId: string): DeferredMove | undefined => {
      const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      if (workspace === undefined || !threadWorkspaceName.safeParse(workspace.path.split('/').at(-1)).success) return undefined
      if (!workspaceHasOtherSession({ sessionId, workspaceSessionIds: workspace.sessionIds })) return undefined
      const key = `${sessionId}\u0000${workspaceId}`
      const cached = sharedWorkspaceMoves.get(key)
      if (cached !== undefined) return cached
      const move: DeferredMove = {
        sessionId,
        visitId: mainViewSessionVisitId(sessionId),
        workspaceId,
        name: workspaceToggle.getSnapshot().context.client.generateName(),
        wantsIsolation: true,
        request: null,
      }
      sharedWorkspaceMoves.set(key, move)
      return move
    }
    const releaseOnceSent = (sessionId: SessionId, release: () => void): void => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let unsubscribe = (): void => undefined
      const done = (): void => {
        clearTimeout(timer)
        unsubscribe()
        release()
      }
      // A first send that fails before it reaches the target lets go of it after a minute.
      timer = setTimeout(done, 60_000)
      unsubscribe = ctx.sessions.list.subscribe(() => {
        if (ctx.sessions.list.getSnapshot().byId[sessionId]?.blank === false) done()
      })
    }
    /** The blank Session of a thread workspace, created or reused without changing what the main view shows. */
    const threadComposerIn = async (workspaceId: string, signal: AbortSignal) => {
      // SAFETY: the id names a workspace the Host's registry just provisioned or listed.
      const sessionId = await ctx.uiWorkspace.connectWorkspace(workspaceId as Parameters<typeof ctx.uiWorkspace.connectWorkspace>[0])
      // A Session has a scope only while something retains it; hold it until its first prompt is accepted.
      const held = ctx.sessions.retain(sessionId, { source: 'controllerOperation', signal })
      await held.ready
      releaseOnceSent(sessionId, () => held.release())
      const scoped = ctx.sessions.scope(sessionId)
      if (scoped === undefined) throw new Error('The thread workspace Session is not available.')
      return { sessionId, workspaceId, blank: true, input: ctx.conversation.input.for(scoped) }
    }
    const warmups = new ThreadWarmup<Awaited<ReturnType<typeof threadComposerIn>>>()
    /** Whether that Session's Conversation screen is the one on screen: the Start page hides the main outlet, not unmounts it. */
    const threadScreenVisible = (sessionId: SessionSummary['id']): boolean => {
      const root = document.querySelector(`[data-conversation-session="${sessionId}"]`)
      return root instanceof HTMLElement && root.offsetParent !== null
    }
    /**
     * The move the destination bar deferred for a New thread visit. The shared-workspace fallback is not one: it is the
     * send's last line of defence for an inherited workspace, and warming for it would provision a workspace under a
     * name the arrival later replaces.
     */
    const deferredMoveFor = (sessionId: SessionSummary['id']): DeferredMove | undefined =>
      workspaceToggle.getSnapshot().context.deferred.find(candidate => candidate.sessionId === sessionId)
    /**
     * Prepare this New thread's destination while the user writes. Provisioning the jj workspace, waiting for its listing
     * and connecting its blank Session are the seconds a first send used to sit through; running them here moves that
     * work under typing, and the send only copies the draft and submits. Nothing moves until the send asks for it.
     */
    const prepareWarm = (sessionId: SessionSummary['id'], move: DeferredMove): void => {
      /** Record a prepared workspace as this project's spare under the name the Host actually gave it. */
      const keepAsSpare = (input: { readonly workspaceId: string; readonly name: string; readonly request: ToggleRequest }): void => {
        // Reusing a client spare skips the Host rename, so the requested name is not always the folder's: read it back.
        const listed = ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === input.workspaceId)
        const name = listed?.path.split('/').at(-1) ?? input.name
        workspaceToggle.getSnapshot().context.client.keepSpare(WorkspaceToggle.spareKey(input.request.projectWorkspaceId, input.request.base), {
          workspaceId: input.workspaceId,
          name,
        })
      }
      warmups.prepare(
        { sessionId, sourceWorkspaceId: move.workspaceId, name: move.name },
        {
          destination: signal => resolveMove(move, signal, { force: false }),
          isolate: async (request, signal) => {
            const landed = await WorkspaceToggle.isolateFirstSend({
              client: workspaceToggle.getSnapshot().context.client,
              request,
              name: move.name,
              signal,
            })
            // Until a send claims it, the prepared workspace is this project's spare: a reload between the draft and
            // its send must reuse it instead of stranding it and provisioning another.
            keepAsSpare({ ...landed, name: move.name, request })
            return landed
          },
          composerIn: (workspaceId, signal) => threadComposerIn(workspaceId, signal),
          keepSpare: keepAsSpare,
        },
      )
    }
    /**
     * A New thread prepares its destination once its draft holds something, and drops it when the draft is cleared.
     * Re-targeting the thread restarts the warm under its new name.
     */
    ctx.effect(() => {
      let unsubscribeInput: (() => void) | undefined
      let watchedSession: SessionSummary['id'] | undefined
      let queued = false
      let disposed = false
      const evaluate = (): void => {
        const source = workspaceComposerFor()
        if (source === undefined || !source.blank) {
          unsubscribeInput?.()
          unsubscribeInput = undefined
          if (watchedSession !== undefined) warmups.abandon(watchedSession)
          watchedSession = undefined
          return
        }
        if (watchedSession !== source.sessionId) {
          unsubscribeInput?.()
          // One New thread is watched at a time: the one that was abandoned keeps its provisioned workspace as a spare.
          if (watchedSession !== undefined) warmups.abandon(watchedSession)
          watchedSession = source.sessionId
          unsubscribeInput = source.input.state.subscribe(changed)
        }
        const move = deferredMoveFor(source.sessionId)
        const isolating = move !== undefined && defersIsolationToSend(move)
        if (
          move !== undefined &&
          ThreadPreparation.shouldPrepare({
            blank: source.blank,
            sending: pendingSubmissions.has(source.sessionId),
            content: ThreadPreparation.holdsContent(source.input.state.getSnapshot()),
            isolating,
          })
        ) {
          prepareWarm(source.sessionId, move)
          return
        }
        if (!isolating) warmups.abandon(source.sessionId)
      }
      function changed(): void {
        if (queued) return
        queued = true
        queueMicrotask(() => {
          queued = false
          if (!disposed) evaluate()
        })
      }
      const unsubscribeSessions = ctx.sessions.list.subscribe(changed)
      const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(changed)
      const toggleSubscription = workspaceToggle.subscribe(changed)
      evaluate()
      return () => {
        disposed = true
        unsubscribeInput?.()
        unsubscribeSessions()
        unsubscribeWorkspaces()
        toggleSubscription.unsubscribe()
        warmups.dispose()
      }
    }, 'jj-integration: prepare a New thread workspace while the draft is written')
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
      const source = workspaceComposerFor(sessionId)
      const sharedWorkspaceMove = source?.blank === true ? sharedThreadWorkspaceMove(sessionId, source.workspaceId) : undefined
      const move = toggleSnapshot.context.deferred.find(candidate => candidate.sessionId === sessionId) ?? sharedWorkspaceMove
      const deferred = defersIsolationToSend(move)
      if (toggleSnapshot.matches('idle') && !deferred) return
      if (source === undefined || !source.blank) return
      const state = source.input.state.getSnapshot()
      if (state.phase !== 'plain' || (state.draft.trim() === '' && state.attachmentIds.length === 0)) return
      stopSubmit(event)
      const controller = new AbortController()
      pendingSubmissions.set(sessionId, controller)
      const settle = (): void => {
        if (pendingSubmissions.get(sessionId) === controller) pendingSubmissions.delete(sessionId)
      }
      if (deferred && move !== undefined) {
        // A New thread isolates on its first send. The send runs on its own and moves only its draft, so another New
        // thread opened meanwhile, or a second thread sent before this one lands, keeps its own composer and move.
        let request = move.request
        const files = DraftAttachmentCarry.filesOf(ctx.conversation, state.attachmentIds)
        // The destination this New thread prepared while it was being written: its provision, listing and blank Session
        // are already under way, so the send only copies the draft and submits instead of waiting for all three.
        const warm = warmups.for({ sessionId, sourceWorkspaceId: source.workspaceId, name: move.name })
        let deliveredSessionId: SessionId | undefined
        let followed = false
        // Keep the source registered while the send runs, so its draft survives the user opening another thread.
        const sourceHeld = ctx.sessions.retain(sessionId, { source: 'controllerOperation' })
        void deliverFirstSend({
          source,
          submitSource,
          destination: async signal => {
            if (warm !== undefined) return warm.destination(signal)
            request ??= await resolveMove(move, signal, { force: move === sharedWorkspaceMove })
            return request
          },
          isolate: async signal => {
            if (warm !== undefined) return { workspaceId: (await warm.target(signal)).workspaceId }
            // SAFETY of the fallback: `destination` returned an isolating request before `isolate` runs.
            const isolating = request ?? { isolate: true, projectWorkspaceId: move.workspaceId, leaving: null, leavingBase: null }
            return WorkspaceToggle.isolateFirstSend({ client: workspaceToggle.getSnapshot().context.client, request: isolating, name: move.name, signal })
          },
          composerIn: async (workspaceId, signal) => {
            const target = warm === undefined ? await threadComposerIn(workspaceId, signal) : await warm.target(signal)
            if (target.workspaceId !== workspaceId) throw new Error('The prepared thread workspace moved before the send landed.')
            deliveredSessionId = target.sessionId
            return target
          },
          copyDraft: async (target, signal) => {
            const snapshot = source.input.state.getSnapshot()
            if (files === undefined) return false
            const attachmentIds = await DraftAttachmentCarry.carry({ conversation: ctx.conversation, files, sessionId: target.sessionId, signal })
            if (attachmentIds === undefined) return false
            target.input.setDraft(snapshot.draft)
            if (attachmentIds.length > 0 && !target.input.addAttachments(attachmentIds)) return false
            return snapshot.occurrences.length === 0 || rebuildReferences(target.input, { draft: snapshot.draft, occurrences: snapshot.occurrences })
          },
          clearSource: () => {
            const carried = source.input.state.getSnapshot().attachmentIds
            source.input.setDraft('')
            for (const id of carried) source.input.removeAttachment(id)
          },
          // The created thread takes the view only while this New thread screen is still the one on screen: going to
          // another thread, another tab or the Start page means the user is done watching it.
          showsSource: () =>
            ThreadPreparation.waitsOnNewThread({
              sourceSessionId: sessionId,
              mainViewSessionId: mainViewSessionId(ctx.sessions.list.getSnapshot()),
              activePanelId: ctx.layout.panelInfo.getSnapshot().activePanelId,
              screenVisible: threadScreenVisible(sessionId),
            }),
          show: targetSessionId => {
            followed = true
            if (!requestReplaceThreadTab(sessionId, targetSessionId)) ctx.uiWorkspace.openSession(targetSessionId)
          },
          blocks: ctx.conversation.blocks,
          reason: translate('preparingWorkspace', { name: move.name }),
          failureMessage: translate('workspaceSendFailed'),
          changedMessage: translate('workspaceSendChanged'),
          signal: controller.signal,
        })
          .then(outcome => {
            if (outcome === 'sent') {
              workspaceToggle.send({ type: 'claim', sessionId })
              warmups.consume(sessionId)
              // The view did not follow, so the thread is only offered: the send happened where the user was not.
              if (!followed && deliveredSessionId !== undefined) {
                ThreadNotices.show({ text: translate('threadStartedElsewhere', { name: move.name }), sessionId: deliveredSessionId })
              }
              return
            }
            if (outcome === 'kept') workspaceToggle.send({ type: 'claim', sessionId })
            if (outcome !== 'not-ready') warmups.abandon(sessionId)
          })
          .catch(() => source.input.notify('error', translate('workspaceSendFailed')))
          .finally(() => {
            sourceHeld.release()
            settle()
          })
        return
      }
      const name = workspaceToggle.getSnapshot().context.pending?.name ?? null
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
        .finally(settle)
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
    // A deferred isolation belongs to one blank Session. When that Session is archived or stops being blank (a send
    // outside this plugin), drop the move so a stale first-send can never provision a workspace for it.
    ctx.effect(() => {
      const cancelStaleMoves = (): void => {
        const moves = workspaceToggle.getSnapshot().context.deferred
        if (moves.length === 0) return
        const sessions = ctx.sessions.list.getSnapshot()
        const archived = ctx.workspaces.list.getSnapshot().archivedSessionIds
        for (const move of moves) {
          const sessionId = SessionId(move.sessionId)
          const stale = archived.includes(sessionId) || sessions.byId[sessionId]?.blank === false
          if (stale) {
            workspaceToggle.send({ type: 'cancel', sessionId: move.sessionId })
            warmups.abandon(move.sessionId)
          }
        }
      }
      const pruneSharedMoves = (): void => {
        if (sharedWorkspaceMoves.size === 0) return
        const sessions = ctx.sessions.list.getSnapshot()
        const archived = ctx.workspaces.list.getSnapshot().archivedSessionIds
        for (const [key, move] of sharedWorkspaceMoves) {
          const sessionId = SessionId(move.sessionId)
          if (archived.includes(sessionId) || sessions.byId[sessionId]?.blank === false) sharedWorkspaceMoves.delete(key)
        }
      }
      const cancelGone = (): void => {
        cancelStaleMoves()
        pruneSharedMoves()
      }
      const unsubscribeSessions = ctx.sessions.list.subscribe(cancelGone)
      const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(cancelGone)
      return () => {
        unsubscribeSessions()
        unsubscribeWorkspaces()
      }
    }, 'jj-integration: cancel a deferred isolation for a thread that is gone')
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
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-jj-integration-thread-notice', order: 122 },
        decorate(() => <ThreadNoticeToast openThread={sessionId => ctx.uiWorkspace.openSession(sessionId)} openLabel={translate('openStartedThread')} />),
      ),
    )
  },
})
