import * as React from 'react'
import { animate, durations, easings, motionSafe, presets, springs } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'
import { PresenceList } from './presence-list.js'
import { StepGlyph } from './step-glyph.js'
import { RollingNumber } from './text.js'

export type RosterAgentStatus = 'running' | 'done' | 'failed'

export interface RosterAgent {
  readonly id: string
  readonly title: React.ReactNode
  /** What it is doing now ("Editing 4 files"); swaps with a soft blur when it changes. */
  readonly activity: React.ReactNode
  /** Changes whenever `activity` text changes, to replay the swap; defaults to the activity when it is a string. */
  readonly activityKey?: string
  readonly status: RosterAgentStatus
  /** Estimate while running ("~1 min"). */
  readonly eta?: React.ReactNode
}

export interface AgentRosterProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  readonly agents: readonly RosterAgent[]
  readonly onStopAll?: () => void
  readonly onReview?: (agent: RosterAgent) => void
  readonly reviewLabel?: string
}

/**
 * A compact card of parallel subagents: a rolling "N agents running" count, one row per agent with a spinning arc,
 * its live activity and ETA, and a Review pill that pops in when an agent finishes. Rows enter, leave and reorder.
 */
export function AgentRoster({ agents, onStopAll, onReview, reviewLabel = 'Review', className, ...props }: AgentRosterProps) {
  const running = agents.filter(agent => agent.status === 'running').length
  return (
    <section aria-label="Subagents" className={cn('dshx:@container dshx:flex dshx:flex-col dshx:gap-3', className)} {...props}>
      <header className="dshx:flex dshx:items-baseline dshx:gap-2">
        <h3 className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1.5 dshx:text-[15px] dshx:font-medium" aria-live="polite">
          <span className="dshx:inline-flex dshx:items-baseline dshx:gap-1">
            <RollingNumber value={running} />
            <span>{running === 1 ? 'agent' : 'agents'}</span>
          </span>
          <span className="dshx:text-muted-foreground">{running > 0 ? 'running' : 'idle'}</span>
        </h3>
        {onStopAll !== undefined && running > 0 ? (
          <button
            type="button"
            onClick={onStopAll}
            className="dshx:rounded-sm dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
          >
            Stop all
          </button>
        ) : null}
      </header>
      <PresenceList
        as="ul"
        className="dshx:flex dshx:flex-col dshx:gap-3"
        items={agents.map(agent => ({ key: agent.id, node: <RosterRow agent={agent} onReview={onReview} reviewLabel={reviewLabel} /> }))}
      />
    </section>
  )
}

function RosterRow({
  agent,
  onReview,
  reviewLabel,
}: {
  readonly agent: RosterAgent
  readonly onReview: ((agent: RosterAgent) => void) | undefined
  readonly reviewLabel: string
}) {
  const activityKey = agent.activityKey ?? (typeof agent.activity === 'string' ? agent.activity : agent.status)
  return (
    <div className="dshx:flex dshx:items-start dshx:gap-3">
      <span className="dshx:flex dshx:h-6 dshx:items-center">
        <StepGlyph status={agent.status} />
      </span>
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
        <span className="dshx:truncate dshx:text-[15px] dshx:leading-6 dshx:text-foreground">{agent.title}</span>
        <SwapLine swapKey={`${agent.status}:${activityKey}`}>
          <span
            className={cn(
              'dshx:block dshx:truncate dshx:text-[13px]',
              agent.status === 'done' ? 'dshx:text-primary' : agent.status === 'failed' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground',
            )}
          >
            {agent.activity}
          </span>
        </SwapLine>
      </div>
      <div className="dshx:flex dshx:shrink-0 dshx:self-stretch dshx:items-start">
        {agent.status === 'done' && onReview !== undefined ? (
          <ReviewPill label={reviewLabel} onClick={() => onReview(agent)} />
        ) : agent.status === 'running' && agent.eta !== undefined ? (
          <span className="dshx:text-sm dshx:leading-6 dshx:text-muted-foreground dshx:tabular-nums">{agent.eta}</span>
        ) : null}
      </div>
    </div>
  )
}

function ReviewPill({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, presets.popIn, motionSafe({ ...springs.bouncy, delay: 0.1 }))
    return () => controls.complete()
  }, [])
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="dshx:self-center dshx:rounded-full dshx:bg-foreground dshx:px-3.5 dshx:py-1.5 dshx:text-sm dshx:font-medium dshx:text-background dshx:outline-none dshx:hover:bg-foreground/85 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:active:bg-foreground/75 dshx:motion-safe:transition-colors"
    >
      {label}
    </button>
  )
}

function SwapLine({ swapKey, children }: { readonly swapKey: string; readonly children: React.ReactNode }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const first = React.useRef(true)
  React.useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (ref.current == null) return
    const controls = animate(
      ref.current,
      { ...presets.blurIn, transform: ['translateY(3px)', 'translateY(0px)'] },
      motionSafe({ duration: durations.base, ease: easings.out }),
    )
    return () => controls.complete()
  }, [swapKey])
  return (
    <span ref={ref} className="dshx:block">
      {children}
    </span>
  )
}
