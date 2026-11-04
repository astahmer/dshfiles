import * as React from 'react'
import { animate, durations, easings, motionSafe, presets, springs } from '../../motion/index.js'
import { useFlip } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'

export type DelegatorStatus = 'running' | 'done' | 'waiting' | 'failed' | 'needs-you'

export interface DelegatorItem {
  readonly id: string
  readonly title: React.ReactNode
  readonly detail?: React.ReactNode
  readonly status: DelegatorStatus
  /** 0..1; draws a progress rule under a running item. */
  readonly progress?: number
}

export interface DelegatorSection {
  readonly id: string
  readonly label: string
  readonly items: readonly DelegatorItem[]
  /** Shown when the section has no items ("Nothing. You're free."). */
  readonly empty?: React.ReactNode
}

export interface DelegatorBoardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'onSelect'> {
  /** The one-line state of the world, written by the delegator agent. */
  readonly headline?: React.ReactNode
  readonly summary?: React.ReactNode
  readonly sections: readonly DelegatorSection[]
  readonly onSelect?: (item: DelegatorItem) => void
}

const statusLabels = {
  running: 'Running',
  done: 'Done',
  waiting: 'Waiting',
  failed: 'Failed',
  'needs-you': 'Needs you',
} as const satisfies Record<DelegatorStatus, string>

/**
 * The delegator's dashboard: a "Now" headline, then sections of delegated work (release, agents, needs-you) with a
 * mono status tag per item. Items glide between sections when they move, tags pop when their status flips, and the
 * running item's progress rule springs forward.
 */
export function DelegatorBoard({ headline, summary, sections, onSelect, className, ...props }: DelegatorBoardProps) {
  const rootRef = React.useRef<HTMLElement>(null)
  const signature = sections.map(section => `${section.id}:${section.items.map(item => item.id).join(',')}`).join('|')
  useFlip(rootRef, [signature], { ...springs.smooth })

  return (
    <section ref={rootRef} aria-label="Delegated work" className={cn('dshx:@container dshx:flex dshx:flex-col dshx:text-foreground', className)} {...props}>
      {headline !== undefined ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:pb-5">
          <SectionLabel>Now</SectionLabel>
          <Swap swapKey={typeof headline === 'string' ? headline : undefined}>
            <p className="dshx:text-[17px] dshx:leading-snug dshx:font-semibold dshx:tracking-tight dshx:text-balance dshx:@max-pane-narrow:text-[15px]">
              {headline}
            </p>
          </Swap>
          {summary !== undefined ? <p className="dshx:text-sm dshx:text-muted-foreground">{summary}</p> : null}
        </div>
      ) : null}
      {sections.map(section => (
        <div key={section.id} role="group" aria-label={section.label} className="dshx:flex dshx:flex-col dshx:border-t dshx:border-border dshx:pt-4 dshx:pb-3">
          <SectionLabel>{section.label}</SectionLabel>
          {section.items.length === 0 ? (
            <Swap swapKey="empty">
              <p className="dshx:py-2.5 dshx:text-sm dshx:text-muted-foreground">{section.empty ?? 'Nothing here.'}</p>
            </Swap>
          ) : (
            <ul className="dshx:flex dshx:flex-col">
              {section.items.map((item, index) => (
                <li key={item.id} data-flip-key={item.id} className={cn(index > 0 && 'dshx:border-t dshx:border-border/60')}>
                  <DelegatorRow item={item} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  )
}

function SectionLabel({ children }: { readonly children: React.ReactNode }) {
  return <span className="dshx:font-mono dshx:text-[11px] dshx:font-medium dshx:tracking-[0.18em] dshx:text-muted-foreground dshx:uppercase">{children}</span>
}

function DelegatorRow({ item, onSelect }: { readonly item: DelegatorItem; readonly onSelect: ((item: DelegatorItem) => void) | undefined }) {
  const body = (
    <>
      <div className="dshx:flex dshx:items-start dshx:gap-3">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <span className="dshx:text-sm dshx:font-semibold dshx:text-foreground">{item.title}</span>
          {item.detail !== undefined ? <span className="dshx:text-[13px] dshx:leading-snug dshx:text-muted-foreground">{item.detail}</span> : null}
        </div>
        <StatusTag status={item.status} />
      </div>
      {item.status === 'running' && item.progress !== undefined ? <ProgressRule value={item.progress} /> : null}
    </>
  )
  const base = 'dshx:flex dshx:w-full dshx:flex-col dshx:gap-2.5 dshx:py-3 dshx:text-left'
  if (onSelect === undefined) return <div className={base}>{body}</div>
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        base,
        'dshx:-mx-2 dshx:w-[calc(100%+1rem)] dshx:rounded-md dshx:px-2 dshx:outline-none dshx:hover:bg-accent/50 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
      )}
    >
      {body}
    </button>
  )
}

function StatusTag({ status }: { readonly status: DelegatorStatus }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const previous = React.useRef(status)
  React.useLayoutEffect(() => {
    if (previous.current === status || ref.current == null) return
    previous.current = status
    const controls = animate(ref.current, { transform: ['scale(0.82)', 'scale(1)'], opacity: [0.2, 1] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [status])
  return (
    <span
      ref={ref}
      className={cn(
        'dshx:mt-0.5 dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:rounded-[4px] dshx:border dshx:px-2 dshx:py-0.5 dshx:font-mono dshx:text-[11px] dshx:font-medium dshx:tracking-[0.12em] dshx:uppercase',
        status === 'running' && 'dshx:border-warning/60 dshx:text-warning',
        status === 'done' && 'dshx:border-success/50 dshx:text-success',
        status === 'waiting' && 'dshx:border-border dshx:text-muted-foreground',
        status === 'failed' && 'dshx:border-destructive/60 dshx:text-destructive',
        status === 'needs-you' && 'dshx:border-info/60 dshx:text-info',
      )}
    >
      {statusLabels[status]}
    </span>
  )
}

function ProgressRule({ value }: { readonly value: number }) {
  const fillRef = React.useRef<HTMLSpanElement>(null)
  const clamped = Math.min(1, Math.max(0, value))
  React.useLayoutEffect(() => {
    if (fillRef.current == null) return
    const controls = animate(fillRef.current, { transform: `scaleX(${clamped})` }, motionSafe(springs.gentle))
    return () => controls.stop()
  }, [clamped])
  return (
    <span
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className="dshx:relative dshx:block dshx:h-[3px] dshx:w-full dshx:overflow-hidden dshx:rounded-full dshx:bg-muted"
    >
      <span ref={fillRef} style={{ transform: 'scaleX(0)' }} className="dshx:absolute dshx:inset-0 dshx:origin-left dshx:rounded-full dshx:bg-warning" />
    </span>
  )
}

/** Cross-fades its child in (blur + rise) whenever `swapKey` changes. */
function Swap({ swapKey, children }: { readonly swapKey: string | undefined; readonly children: React.ReactElement }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const first = React.useRef(true)
  React.useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (ref.current == null) return
    const controls = animate(
      ref.current,
      { ...presets.blurIn, transform: ['translateY(4px)', 'translateY(0px)'] },
      motionSafe({ duration: durations.slow, ease: easings.out }),
    )
    return () => controls.complete()
  }, [swapKey])
  return <div ref={ref}>{children}</div>
}
