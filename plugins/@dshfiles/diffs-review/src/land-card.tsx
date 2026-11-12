import { announceRepositoryChange } from '@dshfiles/jj-integration/repository-change'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { projectChecksApi } from '@dshfiles/project-checks/api'
import { useApi, useRegistry } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { MergeChecks, type MergeCheck, type MergeCheckStatus } from '@dshfiles/plugin-ui/components/motion/merge-checks'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { ClockIcon, GitMergeIcon, History, Undo2Icon } from '@dshfiles/plugin-ui/icons'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useRef } from 'react'
import { diffsReviewApi } from './api.js'
import { arrangeLandCardActions, LandCardActions } from './land-card-actions.js'
import { ChangesScopeModel } from './changes-scope.js'
import { LandCardModel, type LandReadiness, type LandThread } from './land-readiness.js'
import { TryLive } from './try-live.js'
import { landCardMachine } from './land-machine.js'
import { afterLand } from './land-refresh.js'

export interface LandCardProps {
  readonly sessionId: string
  readonly cwd: string
  /** Whether the thread on screen is mid-turn or waiting on a question, from the client's own thread list. */
  readonly threadBusy: boolean
  readonly openHistory: () => void
  /** Called after a land changed the workspace, so the facet re-reads its diff. */
  readonly onLanded: () => void
  /** Brings another thread on screen with its Changes facet; "Land & next" uses it. Absent: plain Land only. */
  readonly openThread?: ((sessionId: string) => void) | undefined
  /** A thread's title from the client's thread list, so the dialog names the thread "Land & next" opens. */
  readonly threadTitle?: ((sessionId: string) => string | undefined) | undefined
  /** Bumped by the facet's ⇧L: open the Land preview when Land is ready, else bring the card (and its reason) into focus. */
  readonly landRequest?: number | undefined
}

const HINT = 'dshx:text-xs dshx:text-muted-foreground'

const landStatusQueryKey = (cwd: string) => ['diffs-review', 'land', cwd] as const

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`

const checkStatus = (status: WorkStatus): MergeCheckStatus => {
  if (status === 'done') return 'passed'
  if (status === 'failed') return 'failed'
  return 'warning'
}

/** One chip per land precondition, in the order the card explains them. */
const landChecks = (input: {
  readonly thread: LandThread
  readonly bookmark: string
  readonly readiness: LandReadiness
  readonly checkSummary: ReturnType<typeof LandCardModel.checks>
}): MergeCheck[] => {
  const revisions = input.thread.unlanded
  const behind = (input.thread.behindCount ?? (input.thread.behind ? 1 : 0)) > 0
  const rows: MergeCheck[] = [
    revisions.length === 0
      ? { id: 'revisions', label: 'Nothing to land', status: 'passed', summary: `${input.bookmark} has all of this work.` }
      : { id: 'revisions', label: `${plural(revisions.length, 'revision')} to land`, status: 'passed' },
    {
      id: 'behind',
      label: LandCardModel.behindText(input.thread, input.bookmark),
      status: behind ? 'warning' : 'passed',
      summary: behind ? 'Land moves this work onto its tip' : undefined,
    },
  ]
  if (input.readiness.conflicts > 0)
    rows.push({
      id: 'conflicts',
      label: `Conflicts in ${plural(input.readiness.conflicts, 'revision')}`,
      status: 'failed',
      summary: 'Resolve them in this workspace, or open History.',
    })
  if (input.readiness.undescribed > 0)
    rows.push({
      id: 'undescribed',
      label: `${String(input.readiness.undescribed)} revision${input.readiness.undescribed === 1 ? ' needs' : 's need'} a description`,
      status: 'warning',
      summary: 'Ask the thread to describe its work, or describe it in History.',
    })
  else if (revisions.length > 0) rows.push({ id: 'described', label: 'Every revision is described', status: 'passed' })
  if (input.checkSummary !== undefined)
    rows.push({
      id: 'checks',
      label: input.checkSummary.text,
      status: checkStatus(input.checkSummary.status),
      summary: input.checkSummary.hint,
    })
  return rows
}

/**
 * The top of the Changes facet: where this thread's work would land and whether it can, with one primary Land. Land
 * goes through jj-integration's own `land` method, so every Host guard (busy threads, undescribed revisions, conflicts)
 * still applies; the dialog previews the exact revisions before anything moves.
 */
export const LandCard = (props: LandCardProps): JSX.Element | null => {
  const jj = useApi(jjIntegrationApi)
  const review = useApi(diffsReviewApi)
  const checksApi = useApi(projectChecksApi)
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: landStatusQueryKey(props.cwd),
    refetchInterval: 15_000,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 60_000, request: hostSignal => jj.threadStatus({ path: props.cwd }, { signal: hostSignal }) }),
  })
  const checks = useQuery({
    queryKey: ['diffs-review', 'land-checks', props.sessionId],
    refetchInterval: 30_000,
    retry: false,
    queryFn: ({ signal }) =>
      runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => checksApi.receipts({ sessionId: props.sessionId }, { signal: hostSignal }) }),
  })
  const bookmarkName = status.data?.bookmark
  const hasThread = status.data?.thread !== null && status.data?.thread !== undefined
  // The thread's own work (the Whole thread scope): the same query the facet reads, so one Host call serves both.
  const threadBase = bookmarkName === undefined ? undefined : ChangesScopeModel.base('thread', bookmarkName)
  const size = useQuery({
    queryKey: ['diffs-review', 'facet', props.cwd, threadBase ?? ''],
    enabled: hasThread && threadBase !== undefined,
    queryFn: ({ signal }) =>
      runHostRequest({ signal, timeoutMs: 60_000, request: hostSignal => review.review({ path: props.cwd, base: threadBase }, { signal: hostSignal }) }),
  })
  const repositories = useQuery({
    queryKey: ['diffs-review', 'land-next', 'repositories'],
    enabled: hasThread && props.openThread !== undefined,
    refetchInterval: 30_000,
    retry: false,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => jj.repositories({}, { signal: hostSignal }) }),
  })
  const refresh = (): void =>
    afterLand({
      invalidateOwn: () => {
        void queryClient.invalidateQueries({ queryKey: ['diffs-review', 'land-next'] })
        void queryClient.invalidateQueries({ queryKey: landStatusQueryKey(props.cwd) })
      },
      announceRepositoryChange,
      onLanded: props.onLanded,
    })
  const [landSnapshot, sendLand] = useMachine(landCardMachine, {
    input: {
      land: thread => runHostRequest({ timeoutMs: 300_000, request: signal => jj.land({ path: thread.path, sessionId: props.sessionId }, { signal }) }),
      queue: thread => runHostRequest({ timeoutMs: 30_000, request: signal => jj.queueLand({ path: thread.path, sessionId: props.sessionId }, { signal }) }),
      unqueue: thread => runHostRequest({ timeoutMs: 30_000, request: signal => jj.cancelQueuedLand({ path: thread.path }, { signal }) }),
      refresh,
      openThread: props.openThread,
    },
  })
  const registeredActions = useRegistry(LandCardActions)
  const card = useRef<HTMLElement | null>(null)
  const seenLandRequest = useRef(props.landRequest ?? 0)
  useEffect(() => {
    const request = props.landRequest ?? 0
    if (request === seenLandRequest.current) return
    seenLandRequest.current = request
    const current = status.data?.thread
    card.current?.scrollIntoView({ block: 'nearest' })
    if (current === null || current === undefined || current.unlanded.length === 0) {
      card.current?.focus()
      return
    }
    if (LandCardModel.readiness({ thread: current, threadBusy: props.threadBusy, pending: false }).canLand) sendLand({ type: 'ask', thread: current })
    else card.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new ⇧L press acts; status changes alone never open the dialog.
  }, [props.landRequest])
  const notice = landSnapshot.context.notice
  const busy = landSnapshot.matches('landing') || landSnapshot.matches('queuing') || landSnapshot.matches('unqueuing')
  const confirming = landSnapshot.matches('confirming')

  if (status.isPending)
    return (
      <section
        aria-label="Land"
        ref={card}
        tabIndex={-1}
        className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3"
        data-testid="land-card"
      >
        <p className={cn(HINT, 'dshx:flex dshx:items-center dshx:gap-2')}>
          <Spinner /> Reading where this work lands…
        </p>
      </section>
    )
  if (status.isError)
    return (
      <section
        aria-label="Land"
        ref={card}
        tabIndex={-1}
        className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3"
        data-testid="land-card"
      >
        <p className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive" role="alert">
          {errorMessage(status.error, 'Could not read this workspace.')}
          <Button onClick={() => void status.refetch()} size="xs" variant="outline">
            Try again
          </Button>
        </p>
      </section>
    )

  const bookmark = status.data.bookmark
  const thread = status.data.thread
  const readiness: LandReadiness = LandCardModel.readiness({ thread, threadBusy: props.threadBusy, pending: landSnapshot.matches('landing') })
  const checkSummary = LandCardModel.checks(checks.data)
  const revisions = thread?.unlanded ?? []
  const sizeData = size.data?.status === 'ok' ? size.data.files : undefined
  const summary = LandCardModel.changeSummary({ revisions, files: sizeData })
  const next =
    thread === null || repositories.data === undefined
      ? undefined
      : LandCardModel.nextReady({ repositories: repositories.data.repositories, currentPath: thread.path })
  const extraActions =
    thread === null
      ? null
      : arrangeLandCardActions(registeredActions).map(action => (
          <action.component
            blocked={readiness.conflicts > 0 || readiness.undescribed > 0}
            bookmark={bookmark}
            cwd={props.cwd}
            key={action.id}
            sessionId={props.sessionId}
            threadTitle={props.threadTitle?.(props.sessionId)}
            unlanded={revisions.length}
          />
        ))
  // Named by its thread, never its workspace folder (b:212a).
  const nextTitle = next === undefined ? undefined : (props.threadTitle?.(next.sessionId) ?? 'Untitled thread')

  return (
    <section
      aria-label="Land"
      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3 dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
      ref={card}
      tabIndex={-1}
      data-testid="land-card"
    >
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <GitMergeIcon aria-hidden className="dshx:size-4 dshx:text-muted-foreground" />
        <h3 className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-medium">Land on {bookmark}</h3>
        {thread === null || revisions.length === 0 ? null : <TryLive bookmark={bookmark} cwd={props.cwd} />}
        <Button aria-label="Open History" className="dshx:shrink-0" onClick={props.openHistory} size="xs" type="button" variant="ghost">
          <History aria-hidden className="dshx:size-3.5" />
          History
        </Button>
      </header>
      {thread === null ? (
        <p className={HINT}>
          This thread edits the project checkout directly, so there is nothing to land. Start the next thread in its own workspace to land its work here.
        </p>
      ) : (
        <>
          {revisions.length === 0 ? null : (
            <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1" data-testid="land-card-summary">
              <ul aria-label="Revisions to land" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:text-xs">
                {summary.titles.map((revision, index) => (
                  <li className="dshx:flex dshx:min-w-0 dshx:gap-2" key={`${revision.changeId}-${String(index)}`}>
                    <span className="dshx:shrink-0 dshx:font-mono dshx:text-muted-foreground">{revision.changeId}</span>
                    <span className="dshx:min-w-0 dshx:truncate">{revision.title}</span>
                  </li>
                ))}
              </ul>
              <p className={HINT}>
                {[summary.more === 0 ? undefined : `+${String(summary.more)} more`, summary.stat ?? (size.isPending ? 'Counting files…' : undefined)]
                  .filter(part => part !== undefined)
                  .join(' · ')}
              </p>
            </div>
          )}
          <MergeChecks checks={landChecks({ thread, bookmark, readiness, checkSummary })} />
        </>
      )}
      {thread !== null && thread.integrationQueuedAt !== undefined ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:py-1 dshx:pr-1 dshx:pl-2">
          <ClockIcon aria-hidden className="dshx:size-3.5 dshx:text-muted-foreground" />
          <p className="dshx:min-w-0 dshx:flex-1 dshx:text-xs">Lands on {bookmark} once the thread is idle.</p>
          <Button disabled={busy} onClick={() => sendLand({ type: 'unqueue', thread })} size="xs" type="button" variant="ghost">
            {busy ? <Spinner /> : <Undo2Icon aria-hidden className="dshx:size-3.5" />}
            Undo
          </Button>
        </div>
      ) : null}
      {thread !== null && thread.integrationQueuedAt === undefined && revisions.length > 0 ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <Button
            aria-describedby={readiness.reason === undefined ? undefined : 'land-card-reason'}
            aria-label={`Land ${String(revisions.length)} revision${revisions.length === 1 ? '' : 's'} on ${bookmark}`}
            disabled={!readiness.canLand || busy}
            onClick={() => {
              sendLand({ type: 'ask', thread })
            }}
            size="sm"
            type="button"
          >
            {landSnapshot.matches('landing') ? <Spinner /> : <GitMergeIcon aria-hidden className="dshx:size-3.5" />}
            Land
          </Button>
          {readiness.canQueue ? (
            <Button disabled={busy} onClick={() => sendLand({ type: 'queue', thread })} size="sm" type="button" variant="outline">
              {landSnapshot.matches('queuing') ? <Spinner /> : <ClockIcon aria-hidden className="dshx:size-3.5" />}
              Land when idle
            </Button>
          ) : null}
          {extraActions}
          {readiness.reason === undefined ? null : (
            <p className={cn(HINT, 'dshx:basis-full')} id="land-card-reason">
              {readiness.reason}
            </p>
          )}
        </div>
      ) : null}
      {(thread === null || (thread.integrationQueuedAt === undefined && revisions.length === 0)) && extraActions !== null && extraActions.length > 0 ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">{extraActions}</div>
      ) : null}
      {notice === null ? null : (
        <p className={cn('dshx:text-xs', notice.tone === 'failure' ? 'dshx:text-destructive' : 'dshx:text-success')} role="status">
          {notice.text}
        </p>
      )}
      {thread === null ? null : (
        <AlertDialog
          onOpenChange={open => {
            if (!open) sendLand({ type: 'cancel' })
          }}
          open={confirming}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Land {revisions.length} revision{revisions.length === 1 ? '' : 's'} on {bookmark}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                They move onto the current tip of {bookmark} and {bookmark} advances to them. Nothing is pushed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="dshx:flex dshx:max-h-48 dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:text-xs" data-testid="land-preview">
              {revisions.map(revision => (
                <li className="dshx:flex dshx:min-w-0 dshx:gap-2" key={revision.changeId}>
                  <span className="dshx:shrink-0 dshx:font-mono dshx:text-muted-foreground">{revision.changeId.slice(0, 8)}</span>
                  <span className="dshx:min-w-0 dshx:truncate">{revision.description.split('\n')[0] || '(no description)'}</span>
                </li>
              ))}
            </ul>
            {summary.stat === undefined ? null : <p className={HINT}>{summary.stat}</p>}
            {next === undefined ? null : (
              <p className={HINT} data-testid="land-next-target">
                Next ready to land: <span className="dshx:text-foreground">{nextTitle}</span>
              </p>
            )}
            <AlertDialogFooter className="dshx:flex-wrap dshx:gap-2">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {next === undefined ? null : (
                <AlertDialogAction
                  data-testid="land-and-next"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    sendLand({ type: 'confirm', next: next.sessionId })
                  }}
                >
                  Land &amp; next
                </AlertDialogAction>
              )}
              <AlertDialogAction
                disabled={busy}
                onClick={() => {
                  sendLand({ type: 'confirm' })
                }}
              >
                Land on {bookmark}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  )
}
