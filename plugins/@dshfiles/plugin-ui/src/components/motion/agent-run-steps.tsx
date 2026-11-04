import * as React from 'react'
import { animate, everyFrame, motionSafe, presets, springs } from '../../motion/index.js'
import { useEnter } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import type { LucideIcon } from '../../icons.js'
import {
  CheckIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FileTextIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  XIcon,
  BrainIcon,
  GlobeIcon,
} from '../../icons.js'
import { Button } from '../ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js'
import { AgentAvatar, type AgentTone } from './agent-avatar.js'
import { HeightReveal } from './height-reveal.js'
import { PresenceList } from './presence-list.js'
import { ShimmerText } from './text.js'

export type AgentRunStepKind = 'plan' | 'think' | 'read' | 'search' | 'edit' | 'run' | 'web'
export type AgentRunStepStatus = 'running' | 'done' | 'failed'
export type AgentRunStatus = 'working' | 'done' | 'failed' | 'stopped'

export interface AgentRunStep {
  readonly id: string
  readonly kind: AgentRunStepKind
  /** Verb part, muted ("Searching for", "Read"). */
  readonly label: string
  /** Object part, emphasised ("rate limit middleware", "src/api/routes.ts"). */
  readonly target?: string
  readonly status: AgentRunStepStatus
  readonly durationMs?: number
  /** Expandable body: tool output, a diff summary, matched files. */
  readonly output?: React.ReactNode
}

export interface AgentRunStepsProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** The run's task, shown as the card heading. */
  readonly heading: string
  readonly model: { readonly name: string; readonly tone?: AgentTone }
  readonly status: AgentRunStatus
  /** Epoch ms the run started; the clock ticks from it while working. */
  readonly startedAt: number
  /** Epoch ms the run ended; freezes the clock. */
  readonly endedAt?: number
  readonly steps: readonly AgentRunStep[]
  readonly onRestart?: () => void
}

const stepIcons = {
  plan: SparklesIcon,
  think: BrainIcon,
  read: FileTextIcon,
  search: SearchIcon,
  edit: FilePenLineIcon,
  run: TerminalIcon,
  web: GlobeIcon,
} as const satisfies Record<AgentRunStepKind, LucideIcon>

const statusLabel = { working: 'Working', done: 'Done', failed: 'Failed', stopped: 'Stopped' } as const satisfies Record<AgentRunStatus, string>

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`

/**
 * One agent run as a live step list: title, model, a ticking clock and status, then each tool step with a shimmering
 * label while it runs, its duration and a popped check when it lands, and an expandable output. Subagent cards,
 * the current turn of a thread, a background job.
 */
export function AgentRunSteps({ heading, model, status, startedAt, endedAt, steps, onRestart, className, ...props }: AgentRunStepsProps) {
  const clockRef = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const element = clockRef.current
    if (element == null) return
    if (status !== 'working' || endedAt !== undefined) {
      element.textContent = clock((endedAt ?? Date.now()) - startedAt)
      return
    }
    let last = ''
    return everyFrame(() => {
      const text = clock(Date.now() - startedAt)
      if (text !== last) element.textContent = last = text
    })
  }, [status, startedAt, endedAt])

  return (
    <section aria-label={`Agent run: ${heading}`} className={cn('dshx:@container dshx:flex dshx:flex-col dshx:text-sm', className)} {...props}>
      <header className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-3 dshx:pb-3">
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <h3 className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-medium dshx:text-foreground">{heading}</h3>
          {onRestart ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label="Restart run" onClick={onRestart} className="dshx:text-muted-foreground">
                  <RotateCcwIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Restart run</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-muted-foreground">
          <AgentAvatar name={model.name} tone={model.tone ?? 'chart-4'} size="xs" decorative />
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{model.name}</span>
          <RunStatus status={status} />
          <span ref={clockRef} aria-label="Elapsed" className="dshx:w-10 dshx:text-right dshx:tabular-nums" />
        </div>
      </header>
      <PresenceList
        as="ol"
        aria-label="Steps"
        className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:border-t dshx:border-border dshx:pt-2"
        enter="riseIn"
        items={steps.map(step => ({ key: step.id, node: <StepRow step={step} /> }))}
      />
    </section>
  )
}

function RunStatus({ status }: { readonly status: AgentRunStatus }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'blurIn', { duration: 0.3 }, status)
  return (
    <span
      ref={ref}
      role="status"
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1.5',
        status === 'done' && 'dshx:text-success',
        status === 'failed' && 'dshx:text-destructive',
      )}
    >
      {status === 'working' ? <LoaderCircleIcon aria-hidden className="dshx:size-3.5 dshx:animate-spin dshx:motion-reduce:animate-none" /> : null}
      {status === 'done' ? <CheckIcon aria-hidden className="dshx:size-3.5" /> : null}
      {status === 'failed' ? <XIcon aria-hidden className="dshx:size-3.5" /> : null}
      <span className="dshx:@max-pane-narrow:sr-only">{statusLabel[status]}</span>
    </span>
  )
}

function StepRow({ step }: { readonly step: AgentRunStep }) {
  const [open, setOpen] = React.useState(false)
  const Icon = stepIcons[step.kind]
  const running = step.status === 'running'
  const bodyId = React.useId()
  const hasOutput = step.output !== undefined
  const text = (
    <>
      {step.label}
      {/* While running the whole label shimmers: a coloured target would paint over the clipped gradient. */}
      {step.target ? <span className={cn(!running && 'dshx:text-foreground')}> {step.target}</span> : null}
    </>
  )
  return (
    <div className="dshx:flex dshx:flex-col">
      <div className="dshx:group dshx:flex dshx:min-h-8 dshx:items-center dshx:gap-2.5 dshx:rounded-md dshx:px-3 dshx:transition-colors dshx:motion-reduce:transition-none dshx:hover:bg-muted/70">
        <Icon aria-hidden className={cn('dshx:size-3.5 dshx:shrink-0', running ? 'dshx:text-foreground' : 'dshx:text-muted-foreground')} />
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">
          {running ? (
            <ShimmerText>{text}</ShimmerText>
          ) : (
            <span className={cn(step.status === 'failed' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}>{text}</span>
          )}
        </span>
        {step.durationMs !== undefined && !running ? <StepDuration ms={step.durationMs} /> : null}
        {step.status === 'done' ? <PopIcon tone="success" /> : null}
        {step.status === 'failed' ? <PopIcon tone="destructive" /> : null}
        {hasOutput ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? 'Hide output' : 'Show output'}
            onClick={() => setOpen(value => !value)}
            className="dshx:text-muted-foreground"
          >
            <ChevronDownIcon className={cn('dshx:transition-transform dshx:duration-200 dshx:motion-reduce:transition-none', open && 'dshx:rotate-180')} />
          </Button>
        ) : (
          <span aria-hidden className="dshx:size-6 dshx:shrink-0" />
        )}
      </div>
      {hasOutput ? (
        <HeightReveal open={open} id={bodyId}>
          <div className="dshx:my-1 dshx:ml-9 dshx:mr-3 dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted/40 dshx:px-3 dshx:py-2 dshx:font-mono dshx:text-xs dshx:text-muted-foreground">
            {step.output}
          </div>
        </HeightReveal>
      ) : null}
    </div>
  )
}

function StepDuration({ ms }: { readonly ms: number }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'slideInRight', { duration: 0.25 })
  return (
    <span ref={ref} className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">
      {seconds(ms)}
    </span>
  )
}

function PopIcon({ tone }: { readonly tone: 'success' | 'destructive' }) {
  const ref = React.useRef<SVGSVGElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = animate(ref.current, { ...presets.popIn, transform: ['scale(0.4)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [])
  return tone === 'success' ? (
    <CheckIcon ref={ref} aria-label="Done" className="dshx:size-3.5 dshx:shrink-0 dshx:text-success" />
  ) : (
    <XIcon ref={ref} aria-label="Failed" className="dshx:size-3.5 dshx:shrink-0 dshx:text-destructive" />
  )
}
