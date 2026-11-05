import { jjIntegrationApi, type LandResult, type ThreadView } from '@dshfiles/jj-integration/api'
import { projectChecksApi } from '@dshfiles/project-checks/api'
import { useApi } from '@dshfiles/dshx/client'
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
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { LandCardModel, type LandReadiness, type LandThread } from './land-readiness.js'

export interface LandCardProps {
  readonly sessionId: string
  readonly cwd: string
  /** Whether the thread on screen is mid-turn or waiting on a question, from the client's own thread list. */
  readonly threadBusy: boolean
  readonly openHistory: () => void
  /** Called after a land changed the workspace, so the facet re-reads its diff. */
  readonly onLanded: () => void
}

const HINT = 'dshx:text-xs dshx:text-muted-foreground'

const landStatusQueryKey = (cwd: string) => ['pulls-review', 'land', cwd] as const

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

const describeResult = (result: LandResult): string => {
  if (result.status === 'landed') return `Landed ${String(result.revisions.length)} revision${result.revisions.length === 1 ? '' : 's'} on ${result.bookmark}.`
  if (result.status === 'nothing-to-land') return `Nothing to land: ${result.bookmark} already has this work.`
  if (result.status === 'needs-description') return 'Describe every revision before landing; History lets you write the descriptions.'
  return `Landing stopped on conflicts. Resolve them in this workspace, then land again.`
}

/**
 * The top of the Changes facet: where this thread's work would land and whether it can, with one primary Land. Land
 * goes through jj-integration's own `land` method, so every Host guard (busy threads, undescribed revisions, conflicts)
 * still applies; the dialog previews the exact revisions before anything moves.
 */
export const LandCard = (props: LandCardProps): JSX.Element | null => {
  const jj = useApi(jjIntegrationApi)
  const checksApi = useApi(projectChecksApi)
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<{ readonly tone: 'success' | 'failure'; readonly text: string } | null>(null)
  const status = useQuery({
    queryKey: landStatusQueryKey(props.cwd),
    refetchInterval: 15_000,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 60_000, request: hostSignal => jj.threadStatus({ path: props.cwd }, { signal: hostSignal }) }),
  })
  const checks = useQuery({
    queryKey: ['pulls-review', 'land-checks', props.sessionId],
    refetchInterval: 30_000,
    retry: false,
    queryFn: ({ signal }) =>
      runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => checksApi.receipts({ sessionId: props.sessionId }, { signal: hostSignal }) }),
  })
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: landStatusQueryKey(props.cwd) })
    props.onLanded()
  }
  const land = useMutation({
    mutationFn: (thread: ThreadView) =>
      runHostRequest({ timeoutMs: 300_000, request: signal => jj.land({ path: thread.path, sessionId: props.sessionId }, { signal }) }),
    onSuccess: result =>
      setNotice({ tone: result.status === 'landed' || result.status === 'nothing-to-land' ? 'success' : 'failure', text: describeResult(result) }),
    onError: error => setNotice({ tone: 'failure', text: errorMessage(error, 'Landing failed. Refresh the card and try again.') }),
    onSettled: refresh,
  })
  const queue = useMutation({
    mutationFn: (thread: ThreadView) =>
      runHostRequest({ timeoutMs: 30_000, request: signal => jj.queueLand({ path: thread.path, sessionId: props.sessionId }, { signal }) }),
    onError: error => setNotice({ tone: 'failure', text: errorMessage(error, 'Could not queue the land. Try again once the thread is idle.') }),
    onSettled: refresh,
  })
  const unqueue = useMutation({
    mutationFn: (thread: ThreadView) => runHostRequest({ timeoutMs: 30_000, request: signal => jj.cancelQueuedLand({ path: thread.path }, { signal }) }),
    onSuccess: result => {
      if (result.status === 'integrating') setNotice({ tone: 'failure', text: 'The land already started; wait for it to finish.' })
    },
    onSettled: refresh,
  })

  if (status.isPending)
    return (
      <section aria-label="Land" className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3" data-testid="land-card">
        <p className={cn(HINT, 'dshx:flex dshx:items-center dshx:gap-2')}>
          <Spinner /> Reading where this work lands…
        </p>
      </section>
    )
  if (status.isError)
    return (
      <section aria-label="Land" className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3" data-testid="land-card">
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
  const readiness: LandReadiness = LandCardModel.readiness({ thread, threadBusy: props.threadBusy, pending: land.isPending })
  const checkSummary = LandCardModel.checks(checks.data)
  const revisions = thread?.unlanded ?? []

  return (
    <section
      aria-label="Land"
      className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-3"
      data-testid="land-card"
    >
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <GitMergeIcon aria-hidden className="dshx:size-4 dshx:text-muted-foreground" />
        <h3 className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-medium">Land on {bookmark}</h3>
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
        <MergeChecks checks={landChecks({ thread, bookmark, readiness, checkSummary })} />
      )}
      {thread !== null && thread.integrationQueuedAt !== undefined ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:py-1 dshx:pr-1 dshx:pl-2">
          <ClockIcon aria-hidden className="dshx:size-3.5 dshx:text-muted-foreground" />
          <p className="dshx:min-w-0 dshx:flex-1 dshx:text-xs">Lands on {bookmark} once the thread is idle.</p>
          <Button disabled={unqueue.isPending} onClick={() => unqueue.mutate(thread)} size="xs" type="button" variant="ghost">
            {unqueue.isPending ? <Spinner /> : <Undo2Icon aria-hidden className="dshx:size-3.5" />}
            Undo
          </Button>
        </div>
      ) : thread !== null && revisions.length > 0 ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <Button
            aria-describedby={readiness.reason === undefined ? undefined : 'land-card-reason'}
            aria-label={`Land ${String(revisions.length)} revision${revisions.length === 1 ? '' : 's'} on ${bookmark}`}
            disabled={!readiness.canLand}
            onClick={() => {
              setNotice(null)
              setConfirming(true)
            }}
            size="sm"
            type="button"
          >
            {land.isPending ? <Spinner /> : <GitMergeIcon aria-hidden className="dshx:size-3.5" />}
            Land
          </Button>
          {readiness.canQueue ? (
            <Button disabled={queue.isPending} onClick={() => queue.mutate(thread)} size="sm" type="button" variant="outline">
              {queue.isPending ? <Spinner /> : <ClockIcon aria-hidden className="dshx:size-3.5" />}
              Land when idle
            </Button>
          ) : null}
          {readiness.reason === undefined ? null : (
            <p className={cn(HINT, 'dshx:basis-full')} id="land-card-reason">
              {readiness.reason}
            </p>
          )}
        </div>
      ) : null}
      {notice === null ? null : (
        <p className={cn('dshx:text-xs', notice.tone === 'failure' ? 'dshx:text-destructive' : 'dshx:text-success')} role="status">
          {notice.text}
        </p>
      )}
      {thread === null ? null : (
        <AlertDialog onOpenChange={setConfirming} open={confirming}>
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
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  land.mutate(thread)
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
