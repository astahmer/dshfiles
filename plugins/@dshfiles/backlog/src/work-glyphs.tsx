import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  BotIcon,
  CalendarIcon,
  HourglassIcon,
  CircleAlertIcon,
  HandIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  LockIcon,
  MoonIcon,
  CheckIcon,
  LinkIcon,
  ScrollTextIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { createContext, useContext, type ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import type { AgentRunState } from './agent-run-state.js'
import type { BacklogPriority } from './item.js'
import { actorName } from './actor-name.js'
import { DueDates } from './due-date.js'
import { BacklogGates } from './gates.js'

const priorityLabels = { none: 'No priority', urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' } satisfies Record<BacklogPriority, string>

/** Linear's priority glyphs: three dashes for none, a filled alert square for urgent, then three, two and one lit bars. */
const PriorityIcon = (props: { readonly priority: BacklogPriority; readonly className?: string }): JSX.Element => {
  const lit = { none: 0, urgent: 0, high: 3, medium: 2, low: 1 }[props.priority]
  if (props.priority === 'urgent')
    return (
      <svg aria-hidden viewBox="0 0 14 14" width="14" height="14" className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-warning', props.className)}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <path d="M7 3.8v4" stroke="var(--color-background, #fff)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.2" r="0.9" fill="var(--color-background, #fff)" />
      </svg>
    )
  if (props.priority === 'none')
    return (
      <svg aria-hidden viewBox="0 0 14 14" width="14" height="14" className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground/60', props.className)}>
        {[2, 6, 10].map(x => (
          <rect key={x} x={x} y="6.4" width="2.2" height="1.4" rx="0.6" fill="currentColor" />
        ))}
      </svg>
    )
  return (
    <svg aria-hidden viewBox="0 0 14 14" width="14" height="14" className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground', props.className)}>
      {[0, 1, 2].map(bar => (
        <rect key={bar} x={1.5 + bar * 4} y={9 - bar * 3} width="3" height={3 + bar * 3} rx="0.8" fill="currentColor" opacity={bar < lit ? 1 : 0.28} />
      ))}
    </svg>
  )
}

const chip =
  'dshx:inline-flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:px-1.5 dshx:text-[11px] dshx:font-medium dshx:tabular-nums'

const WithTooltip = (props: { readonly tip: string; readonly children: ReactNode }): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>{props.children}</TooltipTrigger>
    <TooltipContent>{props.tip}</TooltipContent>
  </Tooltip>
)

/** Sub-issue progress as Linear writes it: done out of counted, green once all are done. */
const ProgressBadge = (props: { readonly progress: BacklogSummaryView['children'] }): JSX.Element | null => {
  if (props.progress.total === 0) return null
  const complete = props.progress.done === props.progress.total
  return (
    <WithTooltip tip={`${String(props.progress.done)} of ${String(props.progress.total)} sub-issues done`}>
      <span
        aria-label="Sub-issue progress"
        className={cn(chip, complete ? 'dshx:bg-success/12 dshx:text-success' : 'dshx:bg-muted dshx:text-muted-foreground')}
      >
        {complete ? <CheckIcon aria-hidden className="dshx:size-3" /> : null}
        {props.progress.done}/{props.progress.total}
      </span>
    </WithTooltip>
  )
}

/** Acceptance criteria checked out of all of them. */
const CriteriaBadge = (props: { readonly progress: { readonly total: number; readonly done: number } }): JSX.Element | null => {
  if (props.progress.total === 0) return null
  const complete = props.progress.done === props.progress.total
  return (
    <WithTooltip tip={`${String(props.progress.done)} of ${String(props.progress.total)} acceptance criteria met`}>
      <span aria-label="Acceptance criteria" className={cn(chip, complete ? 'dshx:bg-success/12 dshx:text-success' : 'dshx:bg-muted dshx:text-muted-foreground')}>
        <ListChecksIcon aria-hidden className="dshx:size-3" />
        {props.progress.done}/{props.progress.total}
      </span>
    </WithTooltip>
  )
}

/** A plan waiting for the user's approval. */
const PlanPendingBadge = (props: { readonly approval: 'pending' | 'approved' | null }): JSX.Element | null =>
  props.approval !== 'pending' ? null : (
    <WithTooltip tip="The plan waits for your approval">
      <span aria-label="Plan waiting for approval" className={cn(chip, 'dshx:bg-warning/12 dshx:text-warning')}>
        <ScrollTextIcon aria-hidden className="dshx:size-3" />
        Plan
      </span>
    </WithTooltip>
  )

/** The due date, relative to today: red once an open item is past it. */
const DueChip = (props: { readonly due: string | null; readonly overdue: boolean; readonly compact?: boolean }): JSX.Element | null => {
  if (props.due === null) return null
  const today = DueDates.dateOf(Date.now())
  const soon = !props.overdue && DueDates.daysBetween(today, props.due) <= 1
  return (
    <WithTooltip tip={`${props.overdue ? 'Overdue: was due' : 'Due'} ${props.due}`}>
      <span
        aria-label={`${props.overdue ? 'Overdue' : 'Due'} ${props.due}`}
        className={cn(
          chip,
          props.overdue ? 'dshx:bg-destructive/12 dshx:text-destructive' : soon ? 'dshx:bg-warning/12 dshx:text-warning' : 'dshx:bg-muted dshx:text-muted-foreground',
        )}
      >
        <CalendarIcon aria-hidden className="dshx:size-3" />
        <span className={cn(props.compact === true && 'dshx:@max-pane-narrow:sr-only')}>{DueDates.label({ due: props.due, today })}</span>
      </span>
    </WithTooltip>
  )
}

/** Outside conditions still holding the item back. */
const GatesBadge = (props: { readonly gates: BacklogSummaryView['gates'] }): JSX.Element | null => {
  const open = props.gates.filter(gate => gate.open)
  if (open.length === 0) return null
  return (
    <WithTooltip tip={`Waits on: ${open.map(gate => BacklogGates.label(gate)).join(', ')}`}>
      <span aria-label={`Waits on ${String(open.length)} gate${open.length === 1 ? '' : 's'}`} className={cn(chip, 'dshx:bg-warning/12 dshx:text-warning')}>
        <HourglassIcon aria-hidden className="dshx:size-3" />
        {open.length}
      </span>
    </WithTooltip>
  )
}

/** The agent holding a live claim on the item. */
const ClaimChip = (props: { readonly lease: BacklogSummaryView['lease']; readonly compact?: boolean }): JSX.Element | null => {
  if (props.lease === null) return null
  const holder = actorName(props.lease.holder)
  return (
    <WithTooltip tip={`Claimed by ${holder} until ${new Date(props.lease.expiresAt).toLocaleTimeString()} unless it writes again`}>
      <span aria-label={`Claimed by ${holder}`} className={cn(chip, 'dshx:bg-violet/12 dshx:text-violet')}>
        <LockIcon aria-hidden className="dshx:size-3" />
        {props.compact === true ? null : <span className="dshx:max-w-28 dshx:truncate">{holder}</span>}
      </span>
    </WithTooltip>
  )
}

/** Items still open that this one waits on. */
const BlockedBadge = (props: { readonly blockedBy: readonly string[] }): JSX.Element | null => {
  if (props.blockedBy.length === 0) return null
  return (
    <WithTooltip tip={`Waits on ${props.blockedBy.map(ref => `b:${ref}`).join(', ')}`}>
      <span aria-label="Blocked by open items" className={cn(chip, 'dshx:bg-destructive/12 dshx:text-destructive')}>
        <LinkIcon aria-hidden className="dshx:size-3" />
        {props.blockedBy.length}
      </span>
    </WithTooltip>
  )
}

const runStateLabels = {
  working: 'Working',
  'awaiting-input': 'Awaiting input',
  error: 'Error',
  done: 'Done',
  stale: 'Stale',
} satisfies Record<AgentRunState, string>
const runStateTone = {
  working: 'dshx:bg-info/12 dshx:text-info',
  'awaiting-input': 'dshx:bg-warning/12 dshx:text-warning',
  error: 'dshx:bg-destructive/12 dshx:text-destructive',
  done: 'dshx:bg-success/12 dshx:text-success',
  stale: 'dshx:bg-muted dshx:text-muted-foreground',
} satisfies Record<AgentRunState, string>
const runStateIcons = { working: LoaderCircleIcon, 'awaiting-input': HandIcon, error: CircleAlertIcon, done: BotIcon, stale: MoonIcon } as const

/** What the agent on this item is doing now; nothing when no thread this browser lists works on it. */
const RunStateChip = (props: { readonly run: { readonly state: AgentRunState } | null; readonly compact?: boolean }): JSX.Element | null => {
  if (props.run === null) return null
  const Icon = runStateIcons[props.run.state]
  return (
    <WithTooltip tip={`Agent: ${runStateLabels[props.run.state]}`}>
      <span aria-label={`Agent ${runStateLabels[props.run.state].toLowerCase()}`} className={cn(chip, runStateTone[props.run.state])}>
        <Icon aria-hidden className={cn('dshx:size-3', props.run.state === 'working' && 'dshx:animate-spin')} />
        {props.compact === true ? null : runStateLabels[props.run.state]}
      </span>
    </WithTooltip>
  )
}

type RunStateLookup = (item: Pick<BacklogSummaryView, 'status' | 'delegate' | 'links'>) => { readonly sessionId: string; readonly state: AgentRunState } | null

const RunStateContext = createContext<RunStateLookup>(() => null)

/** The run state of an item's agent, from the threads and attention records the panel already reads. */
const useRunState = (item: Pick<BacklogSummaryView, 'status' | 'delegate' | 'links'>) => useContext(RunStateContext)(item)

export class WorkGlyphs {
  static readonly priorityLabels = priorityLabels
  static readonly PriorityIcon = PriorityIcon
  static readonly ProgressBadge = ProgressBadge
  static readonly CriteriaBadge = CriteriaBadge
  static readonly PlanPendingBadge = PlanPendingBadge
  static readonly DueChip = DueChip
  static readonly GatesBadge = GatesBadge
  static readonly ClaimChip = ClaimChip
  static readonly BlockedBadge = BlockedBadge
  static readonly RunStateChip = RunStateChip
  static readonly runStateLabels = runStateLabels
  static readonly RunStateProvider = RunStateContext.Provider
  static readonly useRunState = useRunState
}
