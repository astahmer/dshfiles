import * as React from 'react'
import { animate, motionSafe, springs, staggers, durations, easings } from '../../motion/index.js'
import { useEnter } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { CopyIcon, PauseIcon, PlayIcon, SparklesIcon, TriangleAlertIcon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { Checkbox } from '../ui/checkbox.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js'
import { RollingNumber } from './text.js'

export type RecapTone = 'info' | 'violet' | 'teal' | 'warning' | 'success' | 'info-soft' | 'violet-soft'

export interface RecapParticipant {
  readonly id: string
  readonly name: string
  readonly initials: string
  readonly tone: RecapTone
  /** Share of the turns (or tokens), 0..1. */
  readonly share: number
}

export interface RecapMomentKind {
  readonly id: string
  readonly label: string
  readonly icon: React.ReactNode
}

export interface RecapMoment {
  readonly id: string
  /** Offset into the session, in seconds. */
  readonly at: number
  readonly kind: string
  readonly participantId: string
  readonly role?: string
  readonly quote: string
  /** Length of the excerpt, in seconds, for the replay clock. */
  readonly clipSeconds?: number
  /** Bar heights 0..1 for the excerpt's activity strip; derived from the id when absent. */
  readonly waveform?: readonly number[]
}

export interface RecapStep {
  readonly id: string
  readonly label: string
  readonly owner?: string
  readonly ownerInitials?: string
  readonly due?: string
  readonly done: boolean
}

export interface SessionRecapProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading: string
  readonly meta?: readonly string[]
  readonly icon?: React.ReactNode
  readonly status?: { readonly label: string; readonly tone: 'destructive' | 'warning' | 'success' }
  readonly participants: readonly RecapParticipant[]
  readonly shareLabel?: string
  readonly shareTitle?: string
  readonly durationSeconds: number
  readonly kinds: readonly RecapMomentKind[]
  readonly moments: readonly RecapMoment[]
  readonly momentId: string | null
  readonly onMomentChange: (id: string) => void
  /** Replay of the selected moment's excerpt. */
  readonly playing: boolean
  /** 0..1 through the excerpt. */
  readonly progress: number
  readonly onPlayToggle?: () => void
  readonly summary: React.ReactNode
  readonly summaryBy?: string
  readonly onCopySummary?: () => void
  readonly steps: readonly RecapStep[]
  readonly onToggleStep: (id: string, done: boolean) => void
}

const toneBg = {
  info: 'dshx:bg-info',
  'info-soft': 'dshx:bg-info/45',
  violet: 'dshx:bg-violet',
  'violet-soft': 'dshx:bg-violet/45',
  teal: 'dshx:bg-teal',
  warning: 'dshx:bg-warning',
  success: 'dshx:bg-success',
} as const satisfies Record<RecapTone, string>
const toneTile = {
  info: 'dshx:bg-info/15 dshx:text-info',
  'info-soft': 'dshx:bg-info/10 dshx:text-info',
  violet: 'dshx:bg-violet/15 dshx:text-violet',
  'violet-soft': 'dshx:bg-violet/10 dshx:text-violet',
  teal: 'dshx:bg-teal/15 dshx:text-teal',
  warning: 'dshx:bg-warning/15 dshx:text-warning',
  success: 'dshx:bg-success/15 dshx:text-success',
} as const satisfies Record<RecapTone, string>

const clock = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
const shortClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * A finished session at a glance: who did the talking (a stacked share bar that sweeps in), flagged key moments on
 * a timeline whose progress line glides to the chosen marker, that moment's excerpt with a replay strip, the summary
 * and next steps whose done count rolls. Thread and subagent recaps, review hand-offs.
 */
export function SessionRecap({
  heading,
  meta = [],
  icon,
  status,
  participants,
  shareLabel,
  shareTitle = 'Turn share',
  durationSeconds,
  kinds,
  moments,
  momentId,
  onMomentChange,
  playing,
  progress,
  onPlayToggle,
  summary,
  summaryBy,
  onCopySummary,
  steps,
  onToggleStep,
  className,
  ...props
}: SessionRecapProps) {
  const moment = moments.find(entry => entry.id === momentId)
  const doneCount = steps.filter(step => step.done).length
  const sectionsRef = React.useRef<HTMLDivElement>(null)
  useEnter(sectionsRef, 'riseIn', { children: true, stagger: staggers.loose })

  return (
    <TooltipProvider>
      <article
        aria-label={heading}
        className={cn('dshx:@container dshx:w-full dshx:min-w-0 dshx:overflow-hidden dshx:rounded-2xl dshx:border dshx:border-border dshx:bg-card', className)}
        {...props}
      >
        <div ref={sectionsRef} className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
          <header className="dshx:flex dshx:items-center dshx:gap-3 dshx:px-5 dshx:py-4 dshx:@max-pane-narrow:px-4">
            <span className="dshx:grid dshx:size-10 dshx:shrink-0 dshx:place-items-center dshx:rounded-[10px] dshx:bg-foreground dshx:text-background dshx:[&_svg]:size-5 dshx:@max-pane-narrow:hidden">
              {icon ?? <SparklesIcon />}
            </span>
            <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
              <span className="dshx:truncate dshx:text-[15px] dshx:font-semibold dshx:text-foreground">{heading}</span>
              <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{meta.join(' · ')}</span>
            </div>
            {status ? <StatusPill status={status} /> : null}
            <span className="dshx:flex dshx:shrink-0 dshx:-space-x-1.5 dshx:@max-pane-narrow:hidden">
              {participants.map(participant => (
                <Tooltip key={participant.id}>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      aria-label={participant.name}
                      className={cn(
                        'dshx:grid dshx:size-6 dshx:place-items-center dshx:rounded-full dshx:text-[9px] dshx:font-semibold dshx:ring-2 dshx:ring-card',
                        toneTile[participant.tone],
                      )}
                    >
                      {participant.initials}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{participant.name}</TooltipContent>
                </Tooltip>
              ))}
            </span>
          </header>

          <ShareSection heading={shareTitle} label={shareLabel} participants={participants} />

          <section aria-label="Key moments" className="dshx:flex dshx:flex-col dshx:gap-3 dshx:px-5 dshx:py-4 dshx:@max-pane-narrow:px-4">
            <div className="dshx:flex dshx:items-baseline dshx:justify-between">
              <h3 className="dshx:text-sm dshx:font-medium dshx:text-foreground">Key moments</h3>
              <span className="dshx:text-xs dshx:text-muted-foreground">{moments.length} flagged</span>
            </div>
            <MomentTimeline moments={moments} kinds={kinds} durationSeconds={durationSeconds} selectedId={momentId} onSelect={onMomentChange} />
            {moment ? (
              <MomentCard
                moment={moment}
                kind={kinds.find(entry => entry.id === moment.kind)}
                participant={participants.find(entry => entry.id === moment.participantId)}
                playing={playing}
                progress={progress}
                onPlayToggle={onPlayToggle}
              />
            ) : null}
          </section>

          <section aria-label="Summary" className="dshx:flex dshx:flex-col dshx:gap-2 dshx:px-5 dshx:py-4 dshx:@max-pane-narrow:px-4">
            <div className="dshx:flex dshx:items-center dshx:gap-2">
              <SparklesIcon aria-hidden className="dshx:size-3.5 dshx:text-warning" />
              <h3 className="dshx:text-sm dshx:font-medium dshx:text-foreground">Summary</h3>
              {summaryBy ? <span className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground">{summaryBy}</span> : null}
              <span className="dshx:flex-1" />
              {onCopySummary ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon-xs" variant="ghost" aria-label="Copy summary" onClick={onCopySummary}>
                      <CopyIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy summary</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <p className="dshx:text-[13px] dshx:leading-relaxed dshx:text-foreground/90">{summary}</p>
          </section>

          <section aria-label="Next steps" className="dshx:flex dshx:flex-col dshx:gap-2 dshx:px-5 dshx:py-4 dshx:@max-pane-narrow:px-4">
            <div className="dshx:flex dshx:items-baseline dshx:justify-between">
              <h3 className="dshx:text-sm dshx:font-medium dshx:text-foreground">Next steps</h3>
              <span className="dshx:flex dshx:items-baseline dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
                <RollingNumber value={doneCount} /> of {steps.length} done
              </span>
            </div>
            <ul className="dshx:flex dshx:flex-col">
              {steps.map(step => (
                <StepRow key={step.id} step={step} onToggle={done => onToggleStep(step.id, done)} />
              ))}
            </ul>
          </section>
        </div>
      </article>
    </TooltipProvider>
  )
}

function StatusPill({ status }: { readonly status: NonNullable<SessionRecapProps['status']> }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'popIn', { ...springs.bouncy, delay: 0.3 }, status.label)
  return (
    <span
      ref={ref}
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-full dshx:border dshx:px-2.5 dshx:py-0.5 dshx:text-xs dshx:font-medium dshx:[&_svg]:size-3.5',
        status.tone === 'destructive' && 'dshx:border-destructive/40 dshx:bg-destructive/10 dshx:text-destructive',
        status.tone === 'warning' && 'dshx:border-warning/40 dshx:bg-warning/10 dshx:text-warning',
        status.tone === 'success' && 'dshx:border-success/40 dshx:bg-success/10 dshx:text-success',
      )}
    >
      <TriangleAlertIcon aria-hidden />
      {status.label}
    </span>
  )
}

function ShareSection({
  heading,
  label,
  participants,
}: {
  readonly heading: string
  readonly label: string | undefined
  readonly participants: readonly RecapParticipant[]
}) {
  const barRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const bar = barRef.current
    if (bar == null) return
    const controls = animate(
      Array.from(bar.children),
      { transform: ['scaleX(0)', 'scaleX(1)'] },
      motionSafe({ duration: durations.slower, ease: easings.emphasized, delay: (index: number) => 0.2 + index * 0.1 }),
    )
    return () => controls.complete()
  }, [])
  return (
    <section aria-label={heading} className="dshx:flex dshx:flex-col dshx:gap-3 dshx:px-5 dshx:py-4 dshx:@max-pane-narrow:px-4">
      <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-3">
        <h3 className="dshx:shrink-0 dshx:text-sm dshx:font-medium dshx:text-foreground">{heading}</h3>
        {label ? <span className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{label}</span> : null}
      </div>
      <div ref={barRef} aria-hidden className="dshx:flex dshx:h-2 dshx:gap-0.5">
        {participants.map(participant => (
          <span
            key={participant.id}
            style={{ flexGrow: participant.share }}
            className={cn('dshx:h-full dshx:basis-0 dshx:origin-left dshx:rounded-[2px]', toneBg[participant.tone])}
          />
        ))}
      </div>
      <ul className="dshx:grid dshx:grid-cols-4 dshx:gap-x-4 dshx:gap-y-1.5 dshx:text-xs dshx:@max-pane-compact:grid-cols-2">
        {participants.map(participant => (
          <li key={participant.id} className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
            <span aria-hidden className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-[2px]', toneBg[participant.tone])} />
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-muted-foreground">{participant.name}</span>
            <span className="dshx:font-medium dshx:text-foreground dshx:tabular-nums">{Math.round(participant.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MomentTimeline({
  moments,
  kinds,
  durationSeconds,
  selectedId,
  onSelect,
}: {
  readonly moments: readonly RecapMoment[]
  readonly kinds: readonly RecapMomentKind[]
  readonly durationSeconds: number
  readonly selectedId: string | null
  readonly onSelect: (id: string) => void
}) {
  const fillRef = React.useRef<HTMLSpanElement>(null)
  const markersRef = React.useRef<HTMLDivElement>(null)
  const selected = moments.find(entry => entry.id === selectedId)
  const position = (at: number) => (durationSeconds > 0 ? Math.min(1, Math.max(0, at / durationSeconds)) : 0)
  const fill = selected ? position(selected.at) : 0

  React.useLayoutEffect(() => {
    const element = fillRef.current
    if (element == null) return
    const controls = animate(element, { width: `${fill * 100}%` }, motionSafe(springs.smooth))
    return () => controls.stop()
  }, [fill])

  React.useLayoutEffect(() => {
    const root = markersRef.current
    if (root == null) return
    const controls = animate(
      Array.from(root.children),
      { opacity: [0, 1], transform: ['scale(0.4)', 'scale(1)'] },
      motionSafe({ ...springs.bouncy, delay: (index: number) => 0.25 + index * staggers.loose }),
    )
    return () => controls.complete()
  }, [])

  const usedKinds = kinds.filter(kind => moments.some(entry => entry.kind === kind.id))
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      <div className="dshx:relative dshx:mx-3 dshx:h-7">
        <span aria-hidden className="dshx:absolute dshx:inset-x-0 dshx:top-1/2 dshx:h-px dshx:bg-border" />
        <span
          ref={fillRef}
          aria-hidden
          style={{ width: 0 }}
          className="dshx:absolute dshx:top-1/2 dshx:left-0 dshx:h-[1.5px] dshx:-translate-y-px dshx:bg-foreground/70"
        />
        <div ref={markersRef} role="radiogroup" aria-label="Moments" className="dshx:absolute dshx:inset-0">
          {moments.map(entry => {
            const kind = kinds.find(candidate => candidate.id === entry.kind)
            const active = entry.id === selectedId
            const passed = selected !== undefined && entry.at <= selected.at
            return (
              <Tooltip key={entry.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${kind?.label ?? entry.kind} at ${clock(entry.at)}`}
                    onClick={() => onSelect(entry.id)}
                    style={{ left: `${position(entry.at) * 100}%` }}
                    className={cn(
                      'dshx:absolute dshx:top-1/2 dshx:-mt-3 dshx:-ml-3 dshx:grid dshx:size-6 dshx:place-items-center dshx:rounded-full dshx:border dshx:outline-none dshx:transition-[background-color,color,border-color,box-shadow] dshx:duration-200 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:[&_svg]:size-3',
                      // No Tailwind scale here: Motion animates this button's transform on entry and the two would compound.
                      active
                        ? 'dshx:border-foreground dshx:bg-foreground dshx:text-background dshx:ring-4 dshx:ring-foreground/10'
                        : passed
                          ? 'dshx:border-foreground/40 dshx:bg-card dshx:text-foreground dshx:hover:border-foreground/70'
                          : 'dshx:border-border dshx:bg-card dshx:text-muted-foreground dshx:hover:border-foreground/40 dshx:hover:text-foreground',
                    )}
                  >
                    {kind?.icon}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {kind?.label ?? entry.kind} · {clock(entry.at)}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
      {/* Clocks stay on the ends; on a narrow pane the legend drops to its own centred row. */}
      <div className="dshx:grid dshx:grid-cols-[auto_minmax(0,1fr)_auto] dshx:items-center dshx:gap-x-3 dshx:gap-y-1.5 dshx:text-xs dshx:text-muted-foreground">
        <span className="dshx:col-start-1 dshx:row-start-1 dshx:tabular-nums">00:00</span>
        <span className="dshx:col-start-2 dshx:row-start-1 dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:justify-center dshx:gap-x-3 dshx:gap-y-1 dshx:[&_svg]:size-3 dshx:@max-pane-narrow:col-span-3 dshx:@max-pane-narrow:col-start-1 dshx:@max-pane-narrow:row-start-2">
          {usedKinds.map(kind => (
            <span key={kind.id} className="dshx:flex dshx:items-center dshx:gap-1">
              {kind.icon}
              {kind.label}
            </span>
          ))}
        </span>
        <span className="dshx:col-start-3 dshx:row-start-1 dshx:text-right dshx:tabular-nums">{clock(durationSeconds)}</span>
      </div>
    </div>
  )
}

function MomentCard({
  moment,
  kind,
  participant,
  playing,
  progress,
  onPlayToggle,
}: {
  readonly moment: RecapMoment
  readonly kind: RecapMomentKind | undefined
  readonly participant: RecapParticipant | undefined
  readonly playing: boolean
  readonly progress: number
  readonly onPlayToggle: (() => void) | undefined
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  useEnter(ref, 'blurIn', { duration: durations.base, ease: easings.out }, moment.id)
  const bars = moment.waveform ?? syntheticWave(moment.id, 44)
  const clip = moment.clipSeconds ?? 7
  return (
    <div ref={ref} key={moment.id} className="dshx:flex dshx:flex-col dshx:gap-2.5 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-muted/50 dshx:p-3.5">
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        {participant ? (
          <span
            aria-hidden
            className={cn(
              'dshx:grid dshx:size-5 dshx:shrink-0 dshx:place-items-center dshx:rounded-full dshx:text-[8px] dshx:font-semibold',
              toneTile[participant.tone],
            )}
          >
            {participant.initials}
          </span>
        ) : null}
        <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium dshx:text-foreground">{participant?.name ?? 'Unknown'}</span>
        {moment.role ? (
          <span className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{moment.role}</span>
        ) : null}
        <span className="dshx:flex-1" />
        <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground dshx:[&_svg]:size-3">
          {kind?.icon}
          <span className="dshx:@max-pane-narrow:hidden">{kind?.label} ·</span>
          <span className="dshx:tabular-nums">{clock(moment.at)}</span>
        </span>
      </div>
      <blockquote className="dshx:text-[13px] dshx:leading-relaxed dshx:text-foreground">“{moment.quote}”</blockquote>
      <div className="dshx:flex dshx:items-center dshx:gap-3">
        <button
          type="button"
          aria-label={playing ? 'Pause excerpt' : 'Play excerpt'}
          aria-pressed={playing}
          onClick={onPlayToggle}
          className="dshx:grid dshx:size-8 dshx:shrink-0 dshx:place-items-center dshx:rounded-full dshx:bg-info dshx:text-white dshx:outline-none dshx:transition-transform dshx:active:scale-90 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:[&_svg]:size-3.5 dshx:[&_svg]:fill-current"
        >
          {playing ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden className="dshx:ml-0.5" />}
        </button>
        <Waveform bars={bars} progress={progress} replayKey={moment.id} />
        <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">
          <span className="dshx:text-foreground">{shortClock(progress * clip)}</span> / {shortClock(clip)}
        </span>
      </div>
    </div>
  )
}

/** Activity bars that rise in a ripple; bars before the playhead are solid, the rest faded. */
function Waveform({ bars, progress, replayKey }: { readonly bars: readonly number[]; readonly progress: number; readonly replayKey: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const root = ref.current
    if (root == null) return
    const controls = animate(
      Array.from(root.children),
      { transform: ['scaleY(0.15)', 'scaleY(1)'] },
      motionSafe({ ...springs.bouncy, delay: (index: number) => index * 0.012 }),
    )
    return () => controls.complete()
  }, [replayKey])
  const played = Math.round(progress * bars.length)
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-label="Excerpt progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className="dshx:flex dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-[3px] dshx:overflow-hidden"
    >
      {bars.map((height, index) => (
        <span
          key={index}
          style={{ height: `${Math.max(12, height * 100)}%` }}
          className={cn(
            'dshx:w-[2px] dshx:shrink-0 dshx:rounded-full dshx:transition-colors dshx:duration-150',
            index < played ? 'dshx:bg-foreground' : 'dshx:bg-foreground/25',
          )}
        />
      ))}
    </div>
  )
}

function StepRow({ step, onToggle }: { readonly step: RecapStep; readonly onToggle: (done: boolean) => void }) {
  const id = React.useId()
  const labelRef = React.useRef<HTMLLabelElement>(null)
  const first = React.useRef(true)
  React.useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const element = labelRef.current
    if (element == null) return
    const controls = animate(
      element,
      { transform: ['translateX(0px)', step.done ? 'translateX(3px)' : 'translateX(-2px)', 'translateX(0px)'] },
      motionSafe({ duration: durations.base, ease: easings.out }),
    )
    return () => controls.complete()
  }, [step.done])
  return (
    <li className="dshx:flex dshx:items-center dshx:gap-3 dshx:py-2">
      <Checkbox id={id} checked={step.done} onCheckedChange={value => onToggle(value === true)} />
      <label
        ref={labelRef}
        htmlFor={id}
        className={cn(
          'dshx:min-w-0 dshx:flex-1 dshx:cursor-pointer dshx:truncate dshx:text-[13px] dshx:transition-colors dshx:duration-300',
          step.done ? 'dshx:text-muted-foreground dshx:line-through dshx:decoration-muted-foreground/50' : 'dshx:text-foreground',
        )}
      >
        {step.label}
      </label>
      {step.owner ? (
        <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
          <span
            aria-hidden
            className="dshx:grid dshx:size-5 dshx:place-items-center dshx:rounded-full dshx:bg-muted dshx:text-[8px] dshx:font-semibold dshx:text-foreground"
          >
            {step.ownerInitials ?? step.owner.slice(0, 1)}
          </span>
          {step.owner}
        </span>
      ) : null}
      {step.due ? <span className="dshx:w-12 dshx:shrink-0 dshx:text-right dshx:text-xs dshx:text-muted-foreground">{step.due}</span> : null}
    </li>
  )
}

/** Stable pseudo-random bar heights from a string, so an excerpt always draws the same strip. */
function syntheticWave(seed: string, count: number): number[] {
  let state = 0
  for (const char of seed) state = (state * 31 + char.charCodeAt(0)) >>> 0
  return Array.from({ length: count }, (_, index) => {
    state = (state * 1664525 + 1013904223) >>> 0
    const noise = (state % 1000) / 1000
    const envelope = 0.55 + 0.45 * Math.sin((index / count) * Math.PI)
    return Math.min(1, 0.2 + noise * 0.8 * envelope)
  })
}
