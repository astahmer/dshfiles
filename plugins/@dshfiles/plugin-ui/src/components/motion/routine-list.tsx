import * as React from 'react'
import { everyFrame } from '../../motion/index.js'
import { useEnter, useFlip } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import type { LucideIcon } from '../../icons.js'
import { ArrowRightIcon, ChevronDownIcon, CircleCheckIcon, CircleXIcon, PlayIcon, PlusIcon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { Switch } from '../ui/switch.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js'
import { AgentAvatar, agentToneSoft, type AgentTone } from './agent-avatar.js'
import { HeightReveal } from './height-reveal.js'
import { RollingNumber, ShimmerText } from './text.js'

export type RoutineRunStatus = 'ok' | 'failed' | 'skipped'

export interface RoutineRun {
  readonly id: string
  readonly status: RoutineRunStatus
  /** Shown in the bar's tooltip, e.g. "Thu 15 Oct, 8:30 · 42s". */
  readonly label: string
}

export interface RoutineEndpoint {
  readonly label: string
  readonly icon?: LucideIcon
  readonly tone?: AgentTone
}

export interface Routine {
  readonly id: string
  readonly name: string
  /** Human schedule, e.g. "Weekdays at 9:00". */
  readonly schedule: string
  readonly enabled: boolean
  /** Epoch ms of the next run; the countdown ticks toward it. */
  readonly nextRunAt?: number
  readonly running?: boolean
  readonly lastRun?: { readonly label: string; readonly ok: boolean }
  /** Oldest first; the newest bar pops in on the right. */
  readonly history: readonly RoutineRun[]
  readonly sources: readonly RoutineEndpoint[]
  readonly destination: RoutineEndpoint
  readonly agent?: { readonly name: string; readonly tone?: AgentTone }
  /** Expanded body: prompt, recent output, settings. */
  readonly details?: React.ReactNode
  /** Always visible under the row: a webhook URL, the last run with a link to its thread. */
  readonly footer?: React.ReactNode
  /** Extra row controls after Run now (Edit, Delete). */
  readonly actions?: React.ReactNode
  /** Locks the switch and Run now while a change is in flight. */
  readonly busy?: boolean
  /** Run now stays available while paused (a manual run ignores the schedule). Defaults to `enabled`. */
  readonly runnable?: boolean
}

export interface RoutineListProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly routines: readonly Routine[]
  /** Header title; `null` keeps only the "N of M on schedule" line, for a page that has its own heading. */
  readonly heading?: React.ReactNode
  readonly onToggle?: (id: string, enabled: boolean) => void
  readonly onRunNow?: (id: string) => void
  readonly onNew?: () => void
  /** Bars kept per routine. */
  readonly historyLength?: number
}

/** "2 h 14 min", "14 min 27 s", "3 d 9 h". */
export const formatCountdown = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86_400)
  const h = Math.floor((total % 86_400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min ${s} s`
  return `${s} s`
}

/**
 * Scheduled agent routines: each row says when it runs, counts down to the next run live, shows where it reads and
 * writes, and keeps a strip of recent runs whose newest bar pops in. Hover reveals Run now; the switch pauses it.
 * Scheduled threads, cron-like agent jobs, backlog triage runs.
 */
export function RoutineList({ routines, heading = 'Routines', onToggle, onRunNow, onNew, historyLength = 12, className, ...props }: RoutineListProps) {
  const rootRef = React.useRef<HTMLElement>(null)
  const onSchedule = routines.filter(routine => routine.enabled).length

  React.useEffect(() => {
    const root = rootRef.current
    if (root == null) return
    return everyFrame(() => {
      const now = Date.now()
      for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-next-run]'))) {
        const text = formatCountdown(Number(element.dataset.nextRun) - now)
        if (element.textContent !== text) element.textContent = text
      }
    })
  }, [])

  return (
    <section ref={rootRef} aria-label="Routines" className={cn('dshx:@container dshx:flex dshx:flex-col dshx:gap-1 dshx:text-sm', className)} {...props}>
      <header className="dshx:flex dshx:items-start dshx:gap-3 dshx:px-3 dshx:pb-2">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
          {heading === null ? null : <h3 className="dshx:font-medium">{heading}</h3>}
          <p className="dshx:flex dshx:gap-1 dshx:text-muted-foreground">
            <RollingNumber value={onSchedule} /> of {routines.length} on schedule
          </p>
        </div>
        {onNew ? (
          <Button variant="outline" size="sm" className="dshx:rounded-full" onClick={onNew}>
            <PlusIcon />
            <span className="dshx:@max-pane-narrow:sr-only">New routine</span>
          </Button>
        ) : null}
      </header>
      <ul className="dshx:flex dshx:flex-col">
        {routines.map((routine, index) => (
          <RoutineRow
            key={routine.id}
            routine={routine}
            last={index === routines.length - 1}
            historyLength={historyLength}
            onToggle={onToggle}
            onRunNow={onRunNow}
          />
        ))}
      </ul>
    </section>
  )
}

function RoutineRow({
  routine,
  last,
  historyLength,
  onToggle,
  onRunNow,
}: {
  readonly routine: Routine
  readonly last: boolean
  readonly historyLength: number
  readonly onToggle: RoutineListProps['onToggle']
  readonly onRunNow: RoutineListProps['onRunNow']
}) {
  const [open, setOpen] = React.useState(false)
  const bodyId = React.useId()
  const switchId = React.useId()
  return (
    <li aria-label={routine.name} data-routine-id={routine.id} className="dshx:group dshx:relative">
      <div className="dshx:flex dshx:gap-3 dshx:rounded-xl dshx:px-3 dshx:py-3 dshx:transition-colors dshx:motion-reduce:transition-none dshx:hover:bg-muted/60 dshx:focus-within:bg-muted/60">
        <div
          className={cn(
            'dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1 dshx:transition-opacity dshx:motion-reduce:transition-none',
            !routine.enabled && 'dshx:opacity-55',
          )}
        >
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(value => !value)}
            className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:self-start dshx:rounded dshx:text-left dshx:font-medium dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
          >
            <span className="dshx:min-w-0 dshx:truncate">{routine.name}</span>
            <ChevronDownIcon
              aria-hidden
              className={cn(
                'dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground dshx:transition-transform dshx:motion-reduce:transition-none',
                open && 'dshx:rotate-180',
              )}
            />
          </button>
          {/* Below 28rem the schedule and the countdown stack instead of truncating each other. */}
          <p className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground dshx:@max-pane-narrow:flex-col dshx:@max-pane-narrow:items-start dshx:@max-pane-narrow:gap-0">
            <span className="dshx:max-w-full dshx:truncate">{routine.schedule}</span>
            {routine.enabled && routine.running !== true && routine.nextRunAt === undefined ? null : (
              <>
                <span aria-hidden className="dshx:@max-pane-narrow:hidden">
                  ·
                </span>
                <NextRun routine={routine} />
              </>
            )}
          </p>
          <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:pt-0.5 dshx:text-xs dshx:text-muted-foreground">
            {routine.sources.map(source => (
              <Endpoint key={source.label} endpoint={source} iconOnly />
            ))}
            <ArrowRightIcon aria-label="to" className="dshx:size-3 dshx:shrink-0" />
            <Endpoint endpoint={routine.destination} />
            {routine.agent === undefined ? null : (
              <>
                <span aria-hidden className="dshx:mx-1 dshx:h-3 dshx:w-px dshx:bg-border" />
                <AgentAvatar name={routine.agent.name} tone={routine.agent.tone ?? 'chart-4'} size="xs" />
              </>
            )}
          </div>
        </div>
        <div className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:items-end dshx:gap-1.5">
          <div className="dshx:flex dshx:items-center dshx:gap-2">
            {routine.running ? (
              <ShimmerText className="dshx:text-xs dshx:@max-pane-narrow:sr-only">Running…</ShimmerText>
            ) : onRunNow ? (
              <Button
                variant="ghost"
                size="xs"
                disabled={!(routine.runnable ?? routine.enabled) || routine.busy === true}
                onClick={() => onRunNow(routine.id)}
                className="dshx:opacity-0 dshx:transition-opacity dshx:motion-reduce:transition-none dshx:group-hover:opacity-100 dshx:group-focus-within:opacity-100 dshx:@max-pane-narrow:opacity-100"
              >
                <PlayIcon />
                <span className="dshx:@max-pane-narrow:sr-only">Run now</span>
              </Button>
            ) : null}
            {routine.actions}
            <label htmlFor={switchId} className="dshx:sr-only">
              {routine.name} enabled
            </label>
            <Switch id={switchId} checked={routine.enabled} disabled={routine.busy === true} onCheckedChange={checked => onToggle?.(routine.id, checked)} />
          </div>
          {routine.lastRun ? (
            <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
              {routine.lastRun.ok ? (
                <CircleCheckIcon aria-label="Succeeded" className="dshx:size-3.5 dshx:text-success" />
              ) : (
                <CircleXIcon aria-label="Failed" className="dshx:size-3.5 dshx:text-destructive" />
              )}
              Last run {routine.lastRun.label}
            </span>
          ) : null}
          <RunStrip runs={routine.history.slice(-historyLength)} running={routine.running === true} />
        </div>
      </div>
      {routine.footer === undefined ? null : <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:px-3 dshx:pb-3">{routine.footer}</div>}
      <HeightReveal open={open} id={bodyId}>
        <div className="dshx:mx-3 dshx:mb-3 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">
          {routine.details ?? `${routine.agent?.name ?? 'It'} runs ${routine.schedule.toLowerCase()} and posts to ${routine.destination.label}.`}
        </div>
      </HeightReveal>
      {last ? null : <div aria-hidden className="dshx:mx-3 dshx:h-px dshx:bg-border" />}
    </li>
  )
}

function NextRun({ routine }: { readonly routine: Routine }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const state = !routine.enabled ? 'paused' : routine.running ? 'running' : 'scheduled'
  useEnter(ref, 'blurIn', { duration: 0.3 }, state)
  return (
    <span ref={ref} className="dshx:max-w-full dshx:min-w-0 dshx:truncate">
      {state === 'paused' ? 'Paused' : null}
      {state === 'running' ? 'Running now' : null}
      {state === 'scheduled' && routine.nextRunAt !== undefined ? (
        <>
          Next run in <Countdown to={routine.nextRunAt} />
        </>
      ) : null}
    </span>
  )
}

/** Written before paint (reading the clock during render is impure); the list's frame loop keeps it ticking. */
function Countdown({ to }: { readonly to: number }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current != null) ref.current.textContent = formatCountdown(to - Date.now())
  }, [to])
  return <span ref={ref} data-next-run={to} className="dshx:tabular-nums" />
}

function Endpoint({ endpoint, iconOnly = false }: { readonly endpoint: RoutineEndpoint; readonly iconOnly?: boolean }) {
  const Icon = endpoint.icon
  const glyph = Icon ? (
    <span
      className={cn(
        'dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:[&_svg]:size-3',
        endpoint.tone ? agentToneSoft[endpoint.tone] : 'dshx:bg-muted dshx:text-foreground',
      )}
    >
      <Icon aria-hidden />
    </span>
  ) : (
    <AgentAvatar name={endpoint.label} tone={endpoint.tone ?? 'muted'} size="xs" decorative />
  )
  if (iconOnly) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={endpoint.label}
            className="dshx:inline-flex dshx:rounded dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
          >
            {glyph}
          </span>
        </TooltipTrigger>
        <TooltipContent>{endpoint.label}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
      {glyph}
      <span className="dshx:min-w-0 dshx:truncate">{endpoint.label}</span>
    </span>
  )
}

function RunStrip({ runs, running }: { readonly runs: readonly RoutineRun[]; readonly running: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null)
  useFlip(ref, [runs.map(run => run.id).join('|'), running], { enterPreset: 'popIn' })
  const ok = runs.filter(run => run.status === 'ok').length
  return (
    <div ref={ref} role="list" aria-label={`Recent runs: ${ok} of ${runs.length} succeeded`} className="dshx:flex dshx:h-3.5 dshx:items-stretch dshx:gap-[3px]">
      {runs.map(run => (
        <Tooltip key={run.id}>
          <TooltipTrigger asChild>
            <span
              role="listitem"
              tabIndex={-1}
              aria-label={`${run.status === 'ok' ? 'Succeeded' : run.status === 'failed' ? 'Failed' : 'Skipped'} ${run.label}`}
              data-flip-key={run.id}
              className={cn(
                'dshx:w-[3px] dshx:origin-bottom dshx:rounded-full',
                run.status === 'ok' && 'dshx:bg-success/70',
                run.status === 'failed' && 'dshx:bg-destructive/80',
                run.status === 'skipped' && 'dshx:bg-muted-foreground/30',
              )}
            />
          </TooltipTrigger>
          <TooltipContent>{run.label}</TooltipContent>
        </Tooltip>
      ))}
      {running ? (
        <span
          data-flip-key="__running"
          aria-label="Running"
          role="listitem"
          className="dshx:w-[3px] dshx:animate-pulse dshx:rounded-full dshx:bg-info dshx:motion-reduce:animate-none"
        />
      ) : null}
    </div>
  )
}
