import { isApiError } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { BotIcon, GitCommitHorizontalIcon, GitPullRequestIcon, RefreshCwIcon, RocketIcon, SparklesIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useMemo } from 'react'

import { backlogApi, BacklogViews, type BacklogShippedView } from './api.js'
import { BacklogReference } from './backlog-reference.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogShipped, type ShippedUnit } from './shipped.js'
import { ShippedTimeline } from './shipped-timeline.js'
import { BacklogQueries } from './use-backlog-actions.js'

type Bucket = BacklogShippedView['buckets'][number]
type ShippedEntry = Bucket['projects'][number]['items'][number]

const periodLabels = { hour: 'Hour', day: 'Day', week: 'Week', month: 'Month', year: 'Year' } satisfies Record<ShippedUnit, string>
const deltaTone = {
  up: 'dshx:bg-success/12 dshx:text-success',
  down: 'dshx:bg-muted dshx:text-muted-foreground',
  flat: 'dshx:bg-muted dshx:text-muted-foreground',
}
const SUMMARY_UNCONFIGURED = 'shipped-summary-unconfigured'

/** A Host that predates the digest has no `shipped` method; only a Host restart loads it. */
const hostLacksShipped = (error: unknown): boolean => isApiError(error) && error.kind === 'contract'

const pullRequestLabel = (url: string): string => {
  const number = /(\d+)\/?$/u.exec(url)?.[1]
  return number === undefined ? 'PR' : `#${number}`
}

const ItemRow = (props: {
  readonly entry: ShippedEntry
  readonly openId: number | null
  readonly cursorId: number | null
  readonly select: (id: number) => void
  readonly hover: (id: number) => void
}): JSX.Element => {
  const entry = props.entry
  const label = BacklogReference.labelOf(entry)
  return (
    <li
      data-backlog-item-id={String(entry.id)}
      tabIndex={-1}
      aria-label={`Item ${label}`}
      onClick={() => props.select(entry.id)}
      onMouseMove={() => props.hover(entry.id)}
      className={cn(
        'dshx:flex dshx:h-8 dshx:min-w-0 dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-[13px] dshx:outline-none dshx:transition-colors dshx:focus-visible:ring-2 dshx:focus-visible:ring-info/50',
        entry.id === props.openId ? 'dshx:bg-accent/80' : entry.id === props.cursorId ? 'dshx:bg-accent/45' : 'dshx:hover:bg-accent/30',
      )}
    >
      <ItemGlyphs.KindIcon kind={entry.kind} />
      <span className="dshx:w-12 dshx:shrink-0 dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{label}</span>
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">
        {entry.title}
        {entry.summary === undefined ? null : <span className="dshx:text-muted-foreground"> — {entry.summary}</span>}
      </span>
      {entry.byAgent ? (
        <span className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:bg-info/12 dshx:px-1.5 dshx:text-[11px] dshx:text-info">
          <BotIcon aria-hidden className="dshx:size-3" />
          <span className="dshx:@max-pane-compact:sr-only">Agent</span>
        </span>
      ) : null}
      {entry.doneBy.startsWith('agent:') ? (
        <span className="dshx:shrink-0 dshx:truncate dshx:text-[11px] dshx:text-muted-foreground dshx:@max-pane-compact:hidden">
          done by {ItemGlyphs.actorName(entry.doneBy)} for {ItemGlyphs.actorName(entry.owner)}
        </span>
      ) : null}
      {entry.revisions.slice(0, 2).map(revision => (
        <span
          key={revision}
          className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded dshx:bg-muted dshx:px-1 dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground dshx:@max-pane-compact:hidden"
        >
          <GitCommitHorizontalIcon aria-hidden className="dshx:size-3" />
          {revision.slice(0, 8)}
        </span>
      ))}
      {entry.pullRequests.slice(0, 2).map(url => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={event => event.stopPropagation()}
          className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded dshx:bg-muted dshx:px-1 dshx:text-[11px] dshx:text-muted-foreground dshx:hover:text-foreground dshx:@max-pane-compact:hidden"
        >
          <GitPullRequestIcon aria-hidden className="dshx:size-3" />
          {pullRequestLabel(url)}
        </a>
      ))}
      <span className="dshx:w-10 dshx:shrink-0 dshx:text-right dshx:text-[11px] dshx:text-muted-foreground">{ItemGlyphs.ago(entry.doneAt)}</span>
    </li>
  )
}

const Summary = (props: {
  readonly bucket: Bucket
  readonly unit: ShippedUnit
  readonly projects: readonly (string | null)[]
  readonly openSettings: () => void
}): JSX.Element => {
  const api = useApi(backlogApi)
  const queryClient = useQueryClient()
  const summarize = useMutation({
    mutationFn: (regenerate: boolean) =>
      api.summarizeShipped({
        period: props.unit,
        start: props.bucket.start,
        end: props.bucket.end,
        projects: [...props.projects],
        regenerate,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [BacklogQueries.key, 'shipped'] }),
  })
  const summary = summarize.data ?? props.bucket.summary
  const busy = summarize.isPending
  const stale = summarize.data === undefined && summary?.stale === true
  const failure = summarize.error
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      {summary === null ? null : (
        <div className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/30 dshx:px-3 dshx:py-2.5">
          <p className="dshx:whitespace-pre-wrap dshx:text-[13px] dshx:leading-relaxed">{summary.text}</p>
          <div className="dshx:mt-2 dshx:flex dshx:items-center dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
            <SparklesIcon aria-hidden className="dshx:size-3" />
            <span className="dshx:min-w-0 dshx:truncate">
              {summary.model} · {ItemGlyphs.ago(summary.generatedAt)}
            </span>
            {stale ? <span className="dshx:rounded-full dshx:bg-warning/12 dshx:px-1.5 dshx:text-warning">Out of date</span> : null}
            <Button size="xs" variant="ghost" className="dshx:ml-auto" disabled={busy} onClick={() => summarize.mutate(true)}>
              <RefreshCwIcon className={cn('dshx:size-3', busy && 'dshx:animate-spin')} />
              Regenerate
            </Button>
          </div>
        </div>
      )}
      {summary === null ? (
        <div>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => summarize.mutate(false)}>
            <SparklesIcon className={cn('dshx:size-3', busy && 'dshx:animate-pulse')} />
            {busy ? 'Summarizing…' : 'Summarize'}
          </Button>
        </div>
      ) : null}
      {failure === null ? null : (
        <p role="alert" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive">
          <span className="dshx:min-w-0">{errorMessage(failure, 'The summary could not be written. Try again.')}</span>
          {isApiError(failure) && failure.remoteCode === SUMMARY_UNCONFIGURED ? (
            <Button size="xs" variant="outline" onClick={props.openSettings}>
              Backlog settings
            </Button>
          ) : null}
        </p>
      )}
    </div>
  )
}

const BucketSection = (props: {
  readonly bucket: Bucket
  readonly current: boolean
  readonly unit: ShippedUnit
  readonly now: number
  readonly projects: readonly (string | null)[]
  readonly openId: number | null
  readonly cursorId: number | null
  readonly select: (id: number) => void
  readonly hover: (id: number) => void
  readonly openSettings: () => void
}): JSX.Element => {
  const bucket = props.bucket
  const delta = ShippedTimeline.deltaOf(bucket)
  const label = ShippedTimeline.labelOf({ unit: props.unit, start: bucket.start, now: props.now })
  return (
    <li aria-label={`${label}: ${String(bucket.count)} shipped`} className="dshx:relative dshx:flex dshx:gap-4 dshx:pb-6 dshx:@max-pane-narrow:gap-3">
      <span
        aria-hidden
        className={cn(
          'dshx:relative dshx:z-10 dshx:mt-1.5 dshx:size-2.5 dshx:shrink-0 dshx:rounded-full dshx:ring-4 dshx:ring-background',
          bucket.count > 0 ? 'dshx:bg-success' : 'dshx:bg-muted-foreground/40',
        )}
      />
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-3">
        <header className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2">
          <h3 className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold">{label}</h3>
          <span className="dshx:shrink-0 dshx:text-sm dshx:tabular-nums dshx:text-muted-foreground">{bucket.count} shipped</span>
          <span className={cn('dshx:shrink-0 dshx:rounded-full dshx:px-1.5 dshx:text-[11px] dshx:tabular-nums', deltaTone[delta.tone])}>
            <span className="dshx:sr-only">Change from the previous period: </span>
            {delta.text}
          </span>
        </header>
        {bucket.count === 0 ? (
          <p className="dshx:text-xs dshx:text-muted-foreground">{props.current ? 'Nothing shipped yet.' : 'Nothing shipped.'}</p>
        ) : (
          <>
            <Summary bucket={bucket} unit={props.unit} projects={props.projects} openSettings={props.openSettings} />
            <div className="dshx:flex dshx:flex-col dshx:gap-3">
              {bucket.projects.map(group => (
                <section key={group.project ?? ''} aria-label={group.project === null ? 'No project' : ItemGlyphs.projectName(group.project)}>
                  <h4 className="dshx:mb-1 dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">
                    {group.project === null ? <span>No project</span> : <ItemGlyphs.ProjectLabel project={group.project} />}
                    <span className="dshx:tabular-nums">{group.items.length}</span>
                  </h4>
                  <ul className="dshx:-mx-2 dshx:flex dshx:flex-col">
                    {group.items.map(entry => (
                      <ItemRow key={entry.id} entry={entry} openId={props.openId} cursorId={props.cursorId} select={props.select} hover={props.hover} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </li>
  )
}

/** What reached done per period, newest first: a Linear Pulse for the backlog, derived from the items' history. */
export const ShippedView = (props: {
  readonly period: ShippedUnit
  readonly setPeriod: (period: ShippedUnit) => void
  readonly projects: readonly (string | null)[]
  readonly openId: number | null
  readonly cursorId: number | null
  readonly select: (id: number) => void
  readonly hover: (id: number) => void
  readonly openSettings: () => void
}): JSX.Element => {
  const api = useApi(backlogApi)
  const tzOffsetMinutes = ShippedTimeline.localOffsetMinutes()
  const shipped = useQuery({
    queryKey: [BacklogQueries.key, 'shipped', props.period, props.projects, tzOffsetMinutes],
    queryFn: async ({ signal }) =>
      BacklogViews.shipped(await api.shipped({ period: props.period, tzOffsetMinutes, projects: [...props.projects] }, { signal })),
    placeholderData: keepPreviousData,
    retry: (failures, error) => !hostLacksShipped(error) && failures < 2,
  })
  const now = shipped.dataUpdatedAt
  const entries = useMemo(() => ShippedTimeline.entriesOf(shipped.data?.buckets ?? []), [shipped.data])
  const current = shipped.data?.buckets[0]
  return (
    <div className="dshx:@container dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
      <div className="dshx:mx-auto dshx:flex dshx:max-w-4xl dshx:flex-col dshx:gap-5 dshx:px-6 dshx:py-5 dshx:@max-pane-narrow:px-3">
        <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3">
          <span className="dshx:inline-flex dshx:size-9 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card">
            <RocketIcon aria-hidden className="dshx:size-4 dshx:text-muted-foreground" />
          </span>
          <h2 className="dshx:text-lg dshx:font-semibold dshx:tracking-tight">Shipped</h2>
          <div
            role="radiogroup"
            aria-label="Shipped period"
            className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-0.5 dshx:rounded-lg dshx:bg-muted/60 dshx:p-0.5"
          >
            {BacklogShipped.unitPeriods.map(period => (
              <button
                key={period}
                type="button"
                role="radio"
                aria-checked={props.period === period}
                onClick={() => props.setPeriod(period)}
                className={cn(
                  'dshx:inline-flex dshx:h-7 dshx:items-center dshx:rounded-md dshx:px-2.5 dshx:text-xs dshx:font-medium dshx:transition-colors',
                  props.period === period ? 'dshx:bg-background dshx:text-foreground dshx:shadow-xs' : 'dshx:text-muted-foreground dshx:hover:text-foreground',
                )}
              >
                {periodLabels[period]}
              </button>
            ))}
          </div>
        </header>
        {shipped.isError ? (
          hostLacksShipped(shipped.error) ? (
            <p role="alert" className="dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-4 dshx:text-[13px]">
              The running DSH Host predates Shipped. Restart the DSH Host process to load it; the other backlog views keep working until then.
            </p>
          ) : (
            <p role="alert" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive">
              <span className="dshx:min-w-0">{errorMessage(shipped.error, 'What shipped could not be read.')}</span>
              <Button size="xs" variant="outline" onClick={() => void shipped.refetch()}>
                Try again
              </Button>
            </p>
          )
        ) : null}
        {current === undefined ? null : (
          <ol aria-label="Shipped timeline" className="dshx:relative dshx:flex dshx:flex-col">
            <span aria-hidden className="dshx:absolute dshx:top-2 dshx:bottom-6 dshx:left-[4.5px] dshx:w-px dshx:bg-border" />
            {entries.map(entry =>
              entry.kind === 'quiet' ? (
                <li key={`quiet-${String(entry.start)}`} className="dshx:relative dshx:flex dshx:items-center dshx:gap-4 dshx:pb-6 dshx:@max-pane-narrow:gap-3">
                  <span
                    aria-hidden
                    className="dshx:relative dshx:z-10 dshx:ml-[2px] dshx:size-1.5 dshx:shrink-0 dshx:rounded-full dshx:bg-border dshx:ring-4 dshx:ring-background"
                  />
                  <span className="dshx:text-xs dshx:text-muted-foreground">{ShippedTimeline.quietLabel(props.period, entry.periods)}</span>
                </li>
              ) : (
                <BucketSection
                  key={entry.bucket.start}
                  bucket={entry.bucket}
                  current={entry.current}
                  unit={props.period}
                  now={now}
                  projects={props.projects}
                  openId={props.openId}
                  cursorId={props.cursorId}
                  select={props.select}
                  hover={props.hover}
                  openSettings={props.openSettings}
                />
              ),
            )}
          </ol>
        )}
      </div>
    </div>
  )
}
