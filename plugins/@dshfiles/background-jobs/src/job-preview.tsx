import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ChevronRightIcon, SquareTerminalIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import type { ToolCallSectionProps } from '@dshfiles/tool-meta/tool-call-sections'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { backgroundJobsApi } from './api.js'
import { JobPreviewModel, type JobPreviewView, type JobsClient } from './job-preview-model.js'
import type { BackgroundJobsTranslate } from './locales.js'
import { STATUS_KEY, statusVariant } from './panel.js'

/** What the card reads from its plugin, bound once in the client entry. */
export interface JobPreviewBindings {
  readonly jobs: JobsClient
  readonly t: BackgroundJobsTranslate
  readonly useThreadLabel: () => (sessionId: string) => string
  readonly openThread: (sessionId: string) => void
  readonly openProcesses: () => void
}

const textOfResult = (owner: ToolCallSectionProps['owner']): string | undefined => {
  if (owner.phase !== 'result' || owner.block.isError) return undefined
  return owner.block.content.flatMap(content => (content.type === 'text' ? [content.text] : [])).join('\n')
}

/**
 * One job of the thread's roster, re-rendering only when a field the card shows changes: every roster frame rebuilds
 * its rows and every output frame publishes a new snapshot, and neither may reach anything but this card.
 */
const useJobView = (input: { readonly jobs: JobsClient; readonly sessionId: string; readonly jobId: string }): JobPreviewView | undefined => {
  const { jobs, sessionId, jobId } = input
  // SAFETY: ids come from the Host: the thread on the stage and the job its tool call started.
  useEffect(() => jobs.watchRows(sessionId as SessionId), [jobs, sessionId])
  const last = useRef<JobPreviewView | undefined>(undefined)
  const read = useCallback(() => {
    const row = jobs.state.getSnapshot().rows[sessionId]?.find(candidate => candidate.id === jobId)
    const next = row === undefined ? undefined : JobPreviewModel.viewOf(row)
    if (!JobPreviewModel.sameView(last.current, next)) last.current = next
    return last.current
  }, [jobs, sessionId, jobId])
  return useSyncExternalStore(jobs.state.subscribe, read)
}

const Elapsed = (props: { readonly startedAt: number; readonly finishedAt: number | undefined; readonly live: boolean }): JSX.Element => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!props.live) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [props.live])
  return <span className="dshx:shrink-0 dshx:tabular-nums">{JobPreviewModel.formatElapsed((props.finishedAt ?? now) - props.startedAt)}</span>
}

/** Mounted only while the card is open: collapsing stops the stream, and the Host coalesces its frames. */
const JobOutput = (props: {
  readonly jobs: JobsClient
  readonly jobId: string
  readonly owner: string | undefined
  readonly live: boolean
  readonly t: BackgroundJobsTranslate
}): JSX.Element => {
  const { jobs, jobId, owner, t } = props
  // SAFETY: ids come from the Host roster row this card renders.
  useEffect(() => jobs.observe(owner as SessionId | undefined, jobId as JobId), [jobs, owner, jobId])
  const read = useCallback(() => jobs.state.getSnapshot().observed[jobId], [jobs, jobId])
  const observed = useSyncExternalStore(jobs.state.subscribe, read)
  const pane = useRef<HTMLPreElement>(null)
  const pinned = useRef(true)
  const text = observed?.text ?? ''
  useLayoutEffect(() => {
    const element = pane.current
    if (element !== null && pinned.current) element.scrollTop = element.scrollHeight
  }, [text])
  if (observed?.error !== undefined)
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('previewOutputFailed', { error: observed.error })}</AlertDescription>
      </Alert>
    )
  if (text === '') return <p className="dshx:text-muted-foreground">{t(props.live ? 'noOutputYet' : 'outputUnavailable')}</p>
  return (
    <pre
      ref={pane}
      data-dshfiles-live-preview-output=""
      className="dshx:m-0 dshx:max-h-48 dshx:overflow-auto dshx:font-mono! dshx:text-xs dshx:break-words dshx:whitespace-pre-wrap dshx:text-muted-foreground"
      onScroll={event => {
        const element = event.currentTarget
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
      }}
    >
      {observed?.gapBefore === true ? `${t('previewOutputGap')}\n` : ''}
      {text}
    </pre>
  )
}

const StopControl = (props: { readonly jobId: string; readonly status: JobPreviewView['status']; readonly t: BackgroundJobsTranslate }): JSX.Element => {
  const api = useApi(backgroundJobsApi)
  const t = props.t
  const [armed, setArmed] = useState(false)
  const stop = useMutation({ mutationFn: () => api.kill({ jobId: props.jobId, confirm: true }), onSettled: () => setArmed(false) })
  return (
    <>
      {armed ? (
        <Button size="xs" variant="ghost" className="dshx:shrink" onClick={() => setArmed(false)}>
          {t('stopCancel')}
        </Button>
      ) : null}
      <Button
        size="xs"
        variant={armed ? 'destructive' : 'outline'}
        className="dshx:shrink"
        disabled={stop.isPending || props.status === 'stopping'}
        onClick={() => (armed ? stop.mutate() : setArmed(true))}
      >
        {t(armed ? 'stopConfirm' : 'stop')}
      </Button>
      {stop.isError ? <span className="dshx:basis-full dshx:text-destructive">{errorMessage(stop.error, t('stopFailed'))}</span> : null}
    </>
  )
}

const JobPreviewCard = (props: JobPreviewBindings & { readonly sessionId: string; readonly jobId: string; readonly owner: ToolCallSectionProps['owner'] }) => {
  const { jobs, t, sessionId, jobId } = props
  const view = useJobView({ jobs, sessionId, jobId })
  const disclosure = props.owner.useDisclosure()
  const threadLabel = props.useThreadLabel()
  // A job the registry no longer holds (an earlier DSH process, or retention) has nothing live to show.
  if (view === undefined) return null
  const live = JobPreviewModel.isLive(view.status)
  const open = disclosure.expanded
  return (
    <section
      aria-label={`${t('previewKind')}: ${view.label}`}
      className="dshx-root dshx:@container dshx:my-1 dshx:ml-1 dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:text-xs"
      data-dshfiles-live-preview="job"
      data-job-id={view.id}
      data-state={view.status}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('previewToggle', { label: view.label })}
        className="dshx:flex dshx:h-8 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:px-2 dshx:text-left dshx:hover:bg-accent"
        onClick={disclosure.toggle}
      >
        <ChevronRightIcon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground', open && 'dshx:rotate-90')} />
        <SquareTerminalIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
        <span className="dshx:shrink-0 dshx:text-muted-foreground dshx:@max-pane-narrow:sr-only">{t('previewKind')}</span>
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono!">{view.label}</span>
        {view.progress === undefined ? null : <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{view.progress}</span>}
        <span role="status" className="dshx:shrink-0">
          <Badge variant={statusVariant(view.status)}>{t(STATUS_KEY[view.status])}</Badge>
        </span>
        <Elapsed startedAt={view.startedAt} finishedAt={view.finishedAt} live={live} />
      </button>
      {open ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:border-border dshx:p-2">
          {view.detail === undefined ? null : <p className="dshx:text-muted-foreground">{view.detail}</p>}
          <JobOutput jobs={jobs} jobId={view.id} owner={view.owner} live={live} t={t} />
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            {view.owner === undefined ? null : view.owner === sessionId ? (
              <span className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground">{t('previewThisThread')}</span>
            ) : (
              <Button size="xs" variant="link" className="dshx:shrink" onClick={() => props.openThread(view.owner ?? sessionId)}>
                {t('previewThread', { label: threadLabel(view.owner) })}
              </Button>
            )}
            <span className="dshx:flex-1" />
            <Button size="xs" variant="ghost" className="dshx:shrink" onClick={props.openProcesses}>
              {t('previewOpenProcesses')}
            </Button>
            {live ? <StopControl jobId={view.id} status={view.status} t={t} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** The live preview under a tool card that started a background job; nothing for any other call. */
export const JobPreviewSection = (props: ToolCallSectionProps & JobPreviewBindings): JSX.Element | null => {
  const text = textOfResult(props.owner)
  const jobId = text === undefined ? undefined : JobPreviewModel.jobIdOfResult({ toolName: props.owner.toolName, text })
  return jobId === undefined ? null : <JobPreviewCard {...props} jobId={jobId} />
}
