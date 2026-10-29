import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  ActivityIcon,
  BookOpenIcon,
  ChevronRightIcon,
  CoinsIcon,
  GaugeIcon,
  LayersIcon,
  QuoteIcon,
  SearchIcon,
  ShieldIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UsersIcon,
  ZapIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'

import type { MemoryEvent, MemoryUsage } from './api.ts'
import { CostChart, DigestActivityChart, MetricBar, recallPercent, RetrievalChart, StatCard, type DayPoint } from './panel-charts.tsx'
import { PanelFormat } from './panel-format.ts'

const DAY_MS = 86_400_000

const dayLabel = (day: string): string => PanelFormat.formatDay(Date.parse(`${day}T00:00:00.000Z`))

const buildPoints = (usage: MemoryUsage, days: number): readonly DayPoint[] => {
  const daily = new Map(usage.daily.map(entry => [entry.day, entry]))
  const costs = new Map(usage.costs.days.map(entry => [entry.day, entry]))
  const points: DayPoint[] = []
  const today = Date.now()
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(today - offset * DAY_MS).toISOString().slice(0, 10)
    const entry = daily.get(day)
    const cost = costs.get(day)
    points.push({
      day,
      label: dayLabel(day),
      digests: entry?.digests ?? 0,
      searchFound: entry?.searchFound ?? 0,
      searchEmpty: entry?.searchEmpty ?? 0,
      readFound: entry?.readFound ?? 0,
      readMissing: entry?.readMissing ?? 0,
      citations: entry?.citations ?? 0,
      agentCorrected: entry?.agentCorrected ?? 0,
      userCorrected: entry?.userCorrected ?? 0,
      blockRequests: entry?.blockRequests ?? 0,
      searchers: entry?.searches ?? 0,
      readers: entry?.reads ?? 0,
      digestUsd: cost?.digest.usd ?? 0,
      jevCalls: cost?.jev.calls ?? 0,
      jevUsd: cost?.jev.usd ?? 0,
    })
  }
  return points
}

const kindBadge = {
  citation: { label: 'Citation', className: 'dshx:bg-info/10 dshx:text-info' },
  digest: { label: 'Digest', className: 'dshx:bg-success/10 dshx:text-success' },
  note: { label: 'Memory created', className: 'dshx:bg-violet/10 dshx:text-violet' },
} satisfies Record<MemoryEvent['kind'], { readonly label: string; readonly className: string }>

const eventDetail = (event: MemoryEvent): string => {
  if (event.kind === 'citation') {
    const thread = event.threadTitle ?? `t:${PanelFormat.shortThread(event.thread ?? '')}`
    return `Cited memory in thread “${thread}”`
  }
  if (event.kind === 'digest') return `Digested thread “${event.detail}”`
  return PanelFormat.noteExcerpt(event.detail, 90)
}

const EventRow = (props: { readonly event: MemoryEvent; readonly openThread: (id: string) => void; readonly openNote: (id: number) => void }): JSX.Element => {
  const badge = kindBadge[props.event.kind]
  return (
    <tr className="dshx:border-t dshx:border-border/70">
      <td className="dshx:whitespace-nowrap dshx:py-1.5 dshx:pr-3 dshx:tabular-nums dshx:text-muted-foreground">{PanelFormat.formatTime(props.event.at)}</td>
      <td className="dshx:py-1.5 dshx:pr-3">
        <Badge variant="outline" className={cn('dshx:h-4 dshx:border-transparent dshx:px-1.5 dshx:text-[10px]', badge.className)}>
          {badge.label}
        </Badge>
      </td>
      <td className="dshx:py-1.5 dshx:pr-3 dshx:text-muted-foreground">{PanelFormat.projectName(props.event.project)}</td>
      <td className="dshx:min-w-0 dshx:py-1.5 dshx:pr-3">
        <button
          type="button"
          className="dshx:block dshx:max-w-full dshx:truncate dshx:text-left dshx:hover:underline"
          onClick={() => {
            if (props.event.kind === 'note' && props.event.noteId !== null) props.openNote(props.event.noteId)
            else if (props.event.thread !== null) props.openThread(props.event.thread)
          }}
        >
          {eventDetail(props.event)}
        </button>
      </td>
      <td className="dshx:py-1.5 dshx:text-right">
        {props.event.kind !== 'citation' ? (
          <ChevronRightIcon className="dshx:ml-auto dshx:size-3 dshx:text-muted-foreground" />
        ) : (
          <span className="dshx:flex dshx:justify-end dshx:gap-1">
            {props.event.rating === 'up' ? <ThumbsUpIcon className="dshx:size-3 dshx:text-success" /> : null}
            {props.event.rating === 'down' ? <ThumbsDownIcon className="dshx:size-3 dshx:text-destructive" /> : null}
            {props.event.userCorrected ? <ShieldIcon className="dshx:size-3 dshx:text-warning" /> : null}
          </span>
        )}
      </td>
    </tr>
  )
}

const PanelCard = (props: { readonly heading: string; readonly description?: string; readonly children: ReactNode }): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card/60 dshx:p-3">
    <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
      <h3 className="dshx:text-sm dshx:font-semibold">{props.heading}</h3>
      {props.description === undefined ? null : <span className="dshx:text-[11px] dshx:text-muted-foreground">{props.description}</span>}
    </div>
    {props.children}
  </section>
)

export const AnalyticsTab = (props: {
  readonly project: string | undefined
  readonly days: number
  readonly onDaysChange: (days: number) => void
  readonly usage: MemoryUsage | undefined
  readonly openThread: (id: string) => void
  readonly openNote: (id: number) => void
}): JSX.Element => {
  const [eventKind, setEventKind] = useState<'all' | MemoryEvent['kind']>('all')
  const usage = props.usage
  if (usage === undefined) return <p className="dshx:p-6 dshx:text-sm dshx:text-muted-foreground">Loading analytics…</p>
  const tool = (name: string) => usage.tools.find(item => item.tool === name) ?? { calls: 0, withResults: 0, empty: 0, used: 0 }
  const search = tool('memory_search')
  const read = tool('memory_read')
  const points = buildPoints(usage, props.days)
  const firstActive = points.findIndex(point =>
    Boolean(
      point.digests ||
      point.searchFound ||
      point.searchEmpty ||
      point.readFound ||
      point.readMissing ||
      point.citations ||
      point.blockRequests ||
      point.digestUsd,
    ),
  )
  const chartPoints = firstActive <= 0 ? points : points.slice(Math.min(firstActive, Math.max(0, points.length - 7)))
  const digestCalls = usage.digests.trail + usage.digests.model + usage.digests.duplicate
  const effectiveness = usage.effectiveness
  const maxCorrectness = Math.max(
    effectiveness.citations.total,
    effectiveness.citations.agentCorrected,
    effectiveness.citations.userCorrected,
    usage.citations,
    1,
  )
  const projectEvents = usage.events.filter(event => props.project === undefined || event.project === props.project)
  const events = projectEvents.filter(event => eventKind === 'all' || event.kind === eventKind)
  const topNotes = usage.topNotes.filter(note => props.project === undefined || note.project === props.project)
  const maxTop = Math.max(...topNotes.map(note => note.citations), 1)
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-3 dshx:overflow-auto dshx:px-5 dshx:pb-5">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <span className="dshx:text-xs dshx:text-muted-foreground">
          {usage.state === 'ready' ? 'Memory is active' : usage.state === 'off' ? 'Memory is off' : 'Memory failed to start'}
          {usage.failure === null ? '' : `: ${usage.failure}`}
          {props.project === undefined ? '' : ' · charts cover every project; events and top memories follow the project filter'}
        </span>
        <span className="dshx:flex-1" />
        <Select value={String(props.days)} onValueChange={value => props.onDaysChange(Number(value))}>
          <SelectTrigger
            aria-label="Analytics window"
            className="dshx:h-7 dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-transparent dshx:px-2.5 dshx:text-xs dshx:shadow-none"
            size="sm"
          >
            <SelectValue>Last {props.days} days</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {[7, 14, 30, 90].map(days => (
              <SelectItem key={days} value={String(days)}>
                Last {days} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <TooltipProvider delayDuration={500}>
      <div className="dshx:grid dshx:grid-cols-5 dshx:gap-2 dshx:@max-pane-compact:grid-cols-2 dshx:@max-pane-narrow:grid-cols-1">
        <StatCard
          label="Digest calls"
          value={PanelFormat.formatCount(digestCalls)}
          detail={`${PanelFormat.formatCount(usage.digests.model)} by a cheap model`}
          Icon={ActivityIcon}
          iconTile="dshx:bg-info/10 dshx:text-info"
          spark={points.map(point => point.digests)}
        />
        <StatCard
          label="Digest cost"
          value={PanelFormat.formatUsd(usage.costs.total.digest.usd)}
          detail={`${PanelFormat.formatCount(usage.costs.total.digest.calls)} priced calls`}
          Icon={CoinsIcon}
          iconTile="dshx:bg-warning/10 dshx:text-warning"
          spark={points.map(point => point.digestUsd)}
          sparkTone="dshx:bg-warning/70"
        />
        <StatCard
          label="Jev calls"
          value={PanelFormat.formatCount(usage.jev.calls)}
          detail={PanelFormat.formatUsd(usage.costs.total.jev.usd)}
          Icon={ZapIcon}
          iconTile="dshx:bg-violet/10 dshx:text-violet"
          spark={points.map(point => point.jevCalls)}
          sparkTone="dshx:bg-violet/70"
        />
        <StatCard
          label="Searches"
          value={PanelFormat.formatCount(search.calls)}
          detail={`${PanelFormat.formatCount(search.withResults)} found · ${PanelFormat.formatCount(search.empty)} empty`}
          Icon={SearchIcon}
          iconTile="dshx:bg-success/10 dshx:text-success"
          spark={points.map(point => point.searchFound + point.searchEmpty)}
          sparkTone="dshx:bg-success/70"
        />
        <StatCard
          label="Reads"
          value={PanelFormat.formatCount(read.calls)}
          detail={`${PanelFormat.formatCount(read.withResults)} found · ${PanelFormat.formatCount(read.empty)} missing`}
          Icon={BookOpenIcon}
          iconTile="dshx:bg-teal/10 dshx:text-teal"
          spark={points.map(point => point.readFound + point.readMissing)}
          sparkTone="dshx:bg-teal/70"
        />
        <StatCard
          label="Citations"
          value={PanelFormat.formatCount(usage.citations)}
          detail={`${PanelFormat.formatCount(effectiveness.citations.total)} cited memories`}
          Icon={QuoteIcon}
          iconTile="dshx:bg-info/10 dshx:text-info"
          spark={points.map(point => point.citations)}
        />
        <StatCard
          label="User corrections"
          value={PanelFormat.formatCount(effectiveness.citations.userCorrected)}
          detail="heuristic signal"
          Icon={ThumbsUpIcon}
          iconTile="dshx:bg-warning/10 dshx:text-warning"
          spark={points.map(point => point.userCorrected)}
          sparkTone="dshx:bg-warning/70"
        />
        <StatCard
          label="Start blocks"
          value={PanelFormat.formatCount(effectiveness.block.threads)}
          detail={`${PanelFormat.formatCount(usage.blocksServed)} total frozen`}
          Icon={LayersIcon}
          iconTile="dshx:bg-primary/10 dshx:text-primary"
          spark={points.map(point => point.blockRequests)}
        />
        <StatCard
          label="Avg block size"
          value={PanelFormat.formatBytes(effectiveness.block.meanBytes)}
          detail={`largest ${PanelFormat.formatBytes(effectiveness.block.maxBytes)}`}
          Icon={GaugeIcon}
          iconTile="dshx:bg-muted dshx:text-muted-foreground"
        />
        <StatCard
          label="Model requests"
          value={PanelFormat.formatCount(effectiveness.block.requests)}
          detail="carried a start block"
          Icon={UsersIcon}
          iconTile="dshx:bg-muted dshx:text-muted-foreground"
          spark={points.map(point => point.blockRequests)}
        />
      </div>
      </TooltipProvider>
      <div className="dshx:grid dshx:grid-cols-3 dshx:gap-3 dshx:@max-pane-compact:grid-cols-1">
        <DigestActivityChart points={chartPoints} />
        <RetrievalChart points={chartPoints} />
        <CostChart points={chartPoints} />
      </div>
      <div className="dshx:grid dshx:grid-cols-2 dshx:gap-3 dshx:@max-pane-compact:grid-cols-1">
        <PanelCard heading="Recall" description="How often retrieval returns useful results.">
          <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:py-1">
            <div>
              <MetricBar
                label="memory_search"
                value={search.withResults}
                max={search.calls}
                detail={`${PanelFormat.formatCount(search.withResults)} found · ${PanelFormat.formatCount(search.empty)} empty · ${recallPercent(search.withResults, search.calls)}`}
              />
            </div>
            <div>
              <MetricBar
                label="memory_read"
                value={read.withResults}
                max={read.calls}
                detail={`${PanelFormat.formatCount(read.withResults)} found · ${PanelFormat.formatCount(read.empty)} missing · ${recallPercent(read.withResults, read.calls)}`}
              />
            </div>
          </div>
        </PanelCard>
        <PanelCard heading="Correctness" description="Signals about memory quality and corrections.">
          <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-1">
            <MetricBar
              label="Cited memories"
              value={effectiveness.citations.total}
              max={maxCorrectness}
              detail={PanelFormat.formatCount(effectiveness.citations.total)}
            />
            <MetricBar
              label="Revised by the agent"
              value={effectiveness.citations.agentCorrected}
              max={maxCorrectness}
              detail={PanelFormat.formatCount(effectiveness.citations.agentCorrected)}
              tone="dshx:bg-warning"
            />
            <MetricBar
              label="Corrected by the user"
              value={effectiveness.citations.userCorrected}
              max={maxCorrectness}
              detail={PanelFormat.formatCount(effectiveness.citations.userCorrected)}
              tone="dshx:bg-destructive"
            />
            <MetricBar label="Citations" value={usage.citations} max={maxCorrectness} detail={PanelFormat.formatCount(usage.citations)} tone="dshx:bg-info" />
          </div>
        </PanelCard>
      </div>
      <div className="dshx:grid dshx:grid-cols-[1.7fr_1fr] dshx:gap-3 dshx:@max-pane-compact:grid-cols-1">
        <PanelCard heading="Recent events" description="Latest notable memory-related events.">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
            {(['all', 'citation', 'digest', 'note'] as const).map(kind => (
              <Button key={kind} size="xs" variant={eventKind === kind ? 'secondary' : 'ghost'} onClick={() => setEventKind(kind)}>
                {kind === 'all' ? 'All types' : kindBadge[kind].label}
              </Button>
            ))}
          </div>
          {events.length === 0 ? <p className="dshx:py-3 dshx:text-xs dshx:text-muted-foreground">No events in this window.</p> : null}
          <div className="dshx:overflow-auto">
            <table className="dshx:w-full dshx:text-[11px]" aria-label="Recent memory events">
              <thead className="dshx:text-muted-foreground">
                <tr>
                  <th className="dshx:py-1 dshx:pr-3 dshx:text-left dshx:font-medium">Time</th>
                  <th className="dshx:py-1 dshx:pr-3 dshx:text-left dshx:font-medium">Type</th>
                  <th className="dshx:py-1 dshx:pr-3 dshx:text-left dshx:font-medium">Project</th>
                  <th className="dshx:py-1 dshx:pr-3 dshx:text-left dshx:font-medium">Details</th>
                  <th className="dshx:py-1 dshx:text-right dshx:font-medium" />
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 12).map((event, index) => (
                  <EventRow key={`${String(event.at)}:${event.kind}:${String(index)}`} event={event} openThread={props.openThread} openNote={props.openNote} />
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
        <PanelCard heading="Top memories by usage" description="Most frequently retrieved.">
          {topNotes.length === 0 ? <p className="dshx:py-3 dshx:text-xs dshx:text-muted-foreground">No cited memory yet.</p> : null}
          <ol className="dshx:flex dshx:flex-col dshx:gap-2">
            {topNotes.map((note, index) => {
              const tone = PanelFormat.noteToneOf(note.type)
              return (
                <li key={note.id}>
                  <button type="button" onClick={() => props.openNote(note.id)} className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-1 dshx:text-left">
                    <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
                      <span className="dshx:w-3 dshx:shrink-0 dshx:text-right dshx:text-[11px] dshx:tabular-nums dshx:text-muted-foreground">{index + 1}</span>
                      <span className={cn('dshx:flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md', tone.iconTile)}>
                        <tone.Icon className="dshx:size-3" />
                      </span>
                      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:hover:underline">{PanelFormat.noteExcerpt(note.text, 70)}</span>
                      <span className="dshx:shrink-0 dshx:tabular-nums dshx:text-muted-foreground">{note.citations}</span>
                    </span>
                    <span className="dshx:ml-5 dshx:h-1.5 dshx:w-[calc(100%-1.25rem)] dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
                      <span
                        className="dshx:block dshx:h-full dshx:rounded-full dshx:bg-violet"
                        style={{ width: `${String(Math.max(4, (note.citations / maxTop) * 100))}%` }}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </PanelCard>
      </div>
      <p className="dshx:pb-1 dshx:text-[11px] dshx:text-muted-foreground">
        Costs are list-price estimates from AI Accounts' models.dev catalog. Correction counts are heuristics over a 30-minute window after a citation.
      </p>
    </div>
  )
}
