import * as React from 'react'
import { animate, motionSafe, presets, springs, staggers, type AnimationPlaybackControls } from '../../motion/index.js'
import { PlayIcon, PlusIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { AutoHeight } from './auto-height.js'
import { StepGlyph, type StepGlyphStatus } from './step-glyph.js'
import { RollingNumber, ShimmerText } from './text.js'

export type FlowStepKind = 'when' | 'then' | 'if'

/** A sentence part: plain words or a token chip (a field, an address, a channel). */
export type FlowPart = string | { readonly token: string }

export interface FlowBranch {
  readonly label: string
  readonly title: React.ReactNode
  readonly detail?: React.ReactNode
}

export interface FlowStep {
  readonly id: string
  readonly kind: FlowStepKind
  readonly icon?: React.ReactNode
  readonly sentence: readonly FlowPart[]
  /** Instructions under the sentence (an agent step's prompt). */
  readonly note?: React.ReactNode
  /** For `if` steps: the two outcomes. */
  readonly branches?: readonly [FlowBranch, FlowBranch]
  /** Index of the branch the current run took. */
  readonly taken?: 0 | 1
}

export type RunEntryStatus = 'done' | 'running' | 'waiting' | 'pending' | 'failed'

export interface RunEntry {
  readonly id: string
  /** The flow step it ran; highlights that card while running. */
  readonly stepId?: string
  readonly label: React.ReactNode
  readonly detail?: React.ReactNode
  readonly status: RunEntryStatus
  readonly seconds?: number
  /** Extracted values, unfolded once the entry is done. */
  readonly fields?: readonly { readonly key: string; readonly value: React.ReactNode }[]
}

export interface WorkflowRunProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  readonly heading: React.ReactNode
  readonly description?: React.ReactNode
  readonly steps: readonly FlowStep[]
  readonly run: readonly RunEntry[]
  readonly runState: 'idle' | 'running' | 'passed' | 'failed'
  /** Total run time, shown once it passed or failed. */
  readonly runSeconds?: number | undefined
  readonly onRun?: () => void
  readonly onAddStep?: () => void
}

const kindLabels = { when: 'When', then: 'Then', if: 'If' } as const satisfies Record<FlowStepKind, string>
const glyphOf = { done: 'done', running: 'running', waiting: 'attention', pending: 'pending', failed: 'failed' } as const satisfies Record<
  RunEntryStatus,
  StepGlyphStatus
>

/**
 * A minimalist workflow builder with its test run: plain-sentence steps (When / Then / If) with token chips and a
 * branch card, and a run log beside it. As the run advances, a highlight ring glides to the step being executed,
 * entries tick to done with a drawn check, durations roll, and extracted fields unfold.
 */
export function WorkflowRun({ heading, description, steps, run, runState, runSeconds, onRun, onAddStep, className, ...props }: WorkflowRunProps) {
  const activeStepId = run.find(entry => entry.status === 'running' || entry.status === 'waiting')?.stepId
  return (
    <section aria-label="Workflow" className={cn('dshx:@container', className)} {...props}>
      <div className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_17rem] dshx:gap-5 dshx:@max-pane-compact:grid-cols-1">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <h3 className="dshx:text-lg dshx:font-semibold dshx:tracking-tight dshx:text-foreground">{heading}</h3>
            {description !== undefined ? <p className="dshx:text-sm dshx:text-muted-foreground">{description}</p> : null}
          </div>
          <StepList steps={steps} activeStepId={activeStepId} />
          {onAddStep !== undefined ? (
            <button
              type="button"
              onClick={onAddStep}
              className="dshx:inline-flex dshx:items-center dshx:gap-2 dshx:self-start dshx:rounded-lg dshx:border dshx:border-dashed dshx:border-border dshx:px-3 dshx:py-1.5 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
            >
              <PlusIcon aria-hidden className="dshx:size-4" />
              Add a step, or describe it
            </button>
          ) : null}
        </div>
        <RunPanel run={run} runState={runState} runSeconds={runSeconds} onRun={onRun} />
      </div>
    </section>
  )
}

function StepList({ steps, activeStepId }: { readonly steps: readonly FlowStep[]; readonly activeStepId: string | undefined }) {
  const listRef = React.useRef<HTMLOListElement>(null)
  const ringRef = React.useRef<HTMLDivElement>(null)
  const last = React.useRef<{ readonly top: number; readonly height: number } | null>(null)

  React.useLayoutEffect(() => {
    const list = listRef.current
    const ring = ringRef.current
    if (list == null || ring == null) return
    const card = activeStepId === undefined ? null : list.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(activeStepId)}"]`)
    if (card == null) {
      if (last.current !== null) {
        last.current = null
        const controls = animate(ring, { opacity: 0 }, motionSafe({ duration: 0.2 }))
        return () => controls.complete()
      }
      ring.style.opacity = '0'
      return
    }
    const next = { top: card.offsetTop, height: card.offsetHeight }
    const previous = last.current
    if (previous !== null && previous.top === next.top && previous.height === next.height) return
    last.current = next
    if (previous === null) {
      ring.style.top = `${next.top}px`
      ring.style.height = `${next.height}px`
      const controls = animate(ring, { opacity: [0, 1], transform: ['scale(0.98)', 'scale(1)'] }, motionSafe(springs.snappy))
      return () => controls.complete()
    }
    const controls = animate(ring, { top: `${next.top}px`, height: `${next.height}px`, opacity: 1 }, motionSafe(springs.smooth))
    return () => controls.complete()
  })

  return (
    <div className="dshx:relative">
      <ol ref={listRef} aria-label="Steps" className="dshx:relative dshx:flex dshx:flex-col">
        {steps.map((step, index) => (
          <li key={step.id} className="dshx:flex dshx:flex-col">
            {index > 0 ? <span aria-hidden className="dshx:ml-9 dshx:h-3 dshx:w-px dshx:bg-border" /> : null}
            <StepCard step={step} active={step.id === activeStepId} />
          </li>
        ))}
      </ol>
      <div
        ref={ringRef}
        aria-hidden
        style={{ opacity: 0 }}
        className="dshx:pointer-events-none dshx:absolute dshx:inset-x-0 dshx:top-0 dshx:rounded-xl dshx:border-2 dshx:border-primary dshx:shadow-[0_0_0_4px] dshx:shadow-primary/10"
      />
    </div>
  )
}

function StepCard({ step, active }: { readonly step: FlowStep; readonly active: boolean }) {
  return (
    <div
      data-step-id={step.id}
      aria-current={active ? 'step' : undefined}
      className="dshx:flex dshx:flex-col dshx:gap-2.5 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2.5"
    >
      <div className="dshx:flex dshx:items-start dshx:gap-3 dshx:@max-pane-narrow:gap-2">
        <span className="dshx:w-9 dshx:shrink-0 dshx:pt-1 dshx:text-sm dshx:text-muted-foreground">{kindLabels[step.kind]}</span>
        <span className="dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:bg-muted dshx:text-muted-foreground dshx:@max-pane-narrow:hidden dshx:[&_svg]:size-4">
          {step.icon}
        </span>
        <p className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-wrap dshx:items-center dshx:gap-x-1.5 dshx:gap-y-1 dshx:pt-0.5 dshx:text-sm dshx:leading-6 dshx:text-foreground">
          {step.sentence.map((part, index) =>
            typeof part === 'string' ? (
              <span key={index}>{part}</span>
            ) : (
              <span key={index} className="dshx:rounded-md dshx:bg-muted dshx:px-1.5 dshx:text-[13px] dshx:leading-6 dshx:font-medium">
                {part.token}
              </span>
            ),
          )}
        </p>
      </div>
      {step.note !== undefined ? (
        <div className="dshx:ml-[5.5rem] dshx:rounded-lg dshx:bg-muted/70 dshx:px-3 dshx:py-2 dshx:text-[13px] dshx:text-muted-foreground dshx:@max-pane-narrow:ml-0">
          {step.note}
        </div>
      ) : null}
      {step.branches !== undefined ? (
        <div className="dshx:ml-[5.5rem] dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:@max-pane-narrow:ml-0 dshx:@max-pane-narrow:grid-cols-1">
          {step.branches.map((branch, index) => (
            <div
              key={branch.label}
              className={cn(
                'dshx:flex dshx:flex-col dshx:gap-0.5 dshx:rounded-lg dshx:px-3 dshx:py-2 dshx:motion-safe:transition-colors dshx:motion-safe:duration-300',
                step.taken === index ? 'dshx:bg-warning/15' : 'dshx:bg-muted/60',
              )}
            >
              <span
                className={cn(
                  'dshx:text-[11px] dshx:font-medium dshx:tracking-wide dshx:uppercase',
                  step.taken === index ? 'dshx:text-warning' : 'dshx:text-muted-foreground',
                )}
              >
                {branch.label}
              </span>
              <span className="dshx:text-sm dshx:font-medium dshx:text-foreground">{branch.title}</span>
              {branch.detail !== undefined ? (
                <span className={cn('dshx:text-xs', step.taken === index ? 'dshx:text-warning' : 'dshx:text-muted-foreground')}>{branch.detail}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RunPanel({
  run,
  runState,
  runSeconds,
  onRun,
}: {
  readonly run: readonly RunEntry[]
  readonly runState: WorkflowRunProps['runState']
  readonly runSeconds: number | undefined
  readonly onRun: (() => void) | undefined
}) {
  return (
    <aside
      aria-label="Test run"
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4 dshx:border-l dshx:border-border dshx:pl-5 dshx:@max-pane-compact:border-t dshx:@max-pane-compact:border-l-0 dshx:@max-pane-compact:pt-4 dshx:@max-pane-compact:pl-0"
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-[15px] dshx:font-medium dshx:text-foreground">Test run</span>
        <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-xs" aria-live="polite">
          {runState === 'running' ? (
            <ShimmerText>Running…</ShimmerText>
          ) : runState === 'idle' ? (
            <span className="dshx:text-muted-foreground">Not run yet</span>
          ) : (
            <>
              <span className={cn('dshx:size-1.5 dshx:rounded-full', runState === 'passed' ? 'dshx:bg-success' : 'dshx:bg-destructive')} />
              <span className="dshx:text-muted-foreground">{runState === 'passed' ? 'Passed' : 'Failed'}</span>
              {runSeconds !== undefined ? <span className="dshx:text-muted-foreground dshx:tabular-nums">in {runSeconds.toFixed(1)}s</span> : null}
            </>
          )}
        </span>
      </div>
      <ol className="dshx:flex dshx:flex-col dshx:gap-4">
        {run.map(entry => (
          <RunRow key={entry.id} entry={entry} />
        ))}
      </ol>
      {onRun !== undefined ? (
        <Button variant="outline" size="sm" className="dshx:self-start" onClick={onRun} disabled={runState === 'running'}>
          <PlayIcon aria-hidden />
          {runState === 'idle' ? 'Test run' : 'Run again'}
        </Button>
      ) : null}
    </aside>
  )
}

function RunRow({ entry }: { readonly entry: RunEntry }) {
  const showFields = entry.status === 'done' && entry.fields !== undefined && entry.fields.length > 0
  return (
    <li className="dshx:flex dshx:gap-3">
      <span className="dshx:flex dshx:h-5 dshx:items-center">
        <StepGlyph status={glyphOf[entry.status]} tone="success" />
      </span>
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
        <div className="dshx:flex dshx:items-baseline dshx:gap-2">
          <span
            className={cn(
              'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:motion-safe:transition-colors',
              entry.status === 'pending' ? 'dshx:text-muted-foreground' : 'dshx:text-foreground',
            )}
          >
            {entry.label}
          </span>
          {entry.seconds !== undefined && entry.status !== 'pending' ? (
            <RollingNumber value={entry.seconds} format={value => `${value.toFixed(1)}s`} className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground" />
          ) : null}
        </div>
        {entry.detail !== undefined ? (
          <span className={cn('dshx:text-xs', entry.status === 'waiting' ? 'dshx:text-warning' : 'dshx:text-muted-foreground')}>{entry.detail}</span>
        ) : null}
        <AutoHeight>{showFields ? <FieldTable fields={entry.fields ?? []} /> : null}</AutoHeight>
      </div>
    </li>
  )
}

function FieldTable({ fields }: { readonly fields: NonNullable<RunEntry['fields']> }) {
  const ref = React.useRef<HTMLDListElement>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const running: AnimationPlaybackControls[] = [
      animate(Array.from(element.children), presets.slideInLeft, motionSafe({ ...springs.smooth, delay: (index: number) => 0.1 + index * staggers.base })),
    ]
    return () => {
      for (const controls of running) controls.complete()
    }
  }, [])
  return (
    <dl
      ref={ref}
      className="dshx:mt-1.5 dshx:grid dshx:grid-cols-[auto_minmax(0,1fr)] dshx:gap-x-4 dshx:gap-y-1 dshx:rounded-lg dshx:bg-muted/70 dshx:px-3 dshx:py-2 dshx:text-xs"
    >
      {fields.map(field => (
        <div key={field.key} className="dshx:col-span-2 dshx:grid dshx:grid-cols-subgrid">
          <dt className="dshx:text-muted-foreground">{field.key}</dt>
          <dd className="dshx:min-w-0 dshx:truncate dshx:text-foreground">{field.value}</dd>
        </div>
      ))}
    </dl>
  )
}
