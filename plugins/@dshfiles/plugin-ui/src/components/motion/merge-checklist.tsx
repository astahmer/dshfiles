import * as React from 'react'
import { animate, motionSafe, type AnimationPlaybackControls } from '../../motion/index.js'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, GitMergeIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../ui/dropdown-menu.js'
import { StepGlyph, type StepGlyphStatus } from './step-glyph.js'
import { ShimmerText } from './text.js'

export type MergeCheckStatus = 'pending' | 'running' | 'passed' | 'failed'

export interface MergeCheck {
  readonly id: string
  readonly label: React.ReactNode
  /** Right-hand detail ("4 of 4", "1 of 1 required", "squash · 3 commits"). */
  readonly meta?: React.ReactNode
  readonly status: MergeCheckStatus
}

export interface MergeStrategy {
  readonly id: string
  readonly label: string
}

export interface MergeChecklistProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  readonly checks: readonly MergeCheck[]
  readonly strategies: readonly MergeStrategy[]
  readonly strategy: string
  readonly onStrategyChange?: (id: string) => void
  readonly onMerge?: () => void
  /** Opens one check's detail (its log, its review). */
  readonly onOpenCheck?: (check: MergeCheck) => void
  readonly state?: 'idle' | 'merging' | 'merged'
}

const glyphOf = { pending: 'pending', running: 'running', passed: 'done', failed: 'failed' } as const satisfies Record<MergeCheckStatus, StepGlyphStatus>

/**
 * The checklist a change must clear before it lands: checks, review and conflicts tick to green one by one, and the
 * merge button wakes up (pop and a light sweep) only once every row passed. A split button picks the strategy.
 */
export function MergeChecklist({
  checks,
  strategies,
  strategy,
  onStrategyChange,
  onMerge,
  onOpenCheck,
  state = 'idle',
  className,
  ...props
}: MergeChecklistProps) {
  const ready = checks.length > 0 && checks.every(check => check.status === 'passed')
  const blocked = checks.some(check => check.status === 'failed')
  const current = strategies.find(item => item.id === strategy)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const shineRef = React.useRef<HTMLSpanElement>(null)
  const wasReady = React.useRef(ready)

  React.useLayoutEffect(() => {
    if (wasReady.current === ready) return
    wasReady.current = ready
    if (!ready || buttonRef.current == null) return
    const running: AnimationPlaybackControls[] = [
      animate(buttonRef.current, { transform: ['scale(0.97)', 'scale(1.015)', 'scale(1)'] }, motionSafe({ duration: 0.45 })),
    ]
    if (shineRef.current != null)
      running.push(
        animate(
          shineRef.current,
          { transform: ['translateX(-120%)', 'translateX(320%)'], opacity: [1, 1] },
          motionSafe({ duration: 0.9, delay: 0.1, ease: 'easeInOut' }),
        ),
      )
    return () => {
      for (const controls of running) controls.stop()
    }
  }, [ready])

  return (
    <section
      aria-label="Merge checklist"
      className={cn('dshx:@container dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card', className)}
      {...props}
    >
      <ul className="dshx:flex dshx:flex-col">
        {checks.map((check, index) => {
          const row = (
            <>
              <StepGlyph status={glyphOf[check.status]} tone="success" variant="outline" />
              {/* Narrow panes drop the meta under the label instead of hiding it. */}
              <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-3 dshx:text-left dshx:@max-pane-narrow:flex-col dshx:@max-pane-narrow:items-start dshx:@max-pane-narrow:gap-0">
                <span
                  className={cn(
                    'dshx:max-w-full dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:@max-pane-narrow:flex-none dshx:motion-safe:transition-colors',
                    check.status === 'pending' ? 'dshx:text-muted-foreground' : 'dshx:text-foreground',
                  )}
                >
                  {check.label}
                </span>
                {check.meta !== undefined ? (
                  <span className="dshx:max-w-full dshx:shrink-0 dshx:truncate dshx:text-[13px] dshx:text-muted-foreground dshx:tabular-nums dshx:@max-pane-narrow:text-xs">
                    {check.meta}
                  </span>
                ) : null}
              </span>
              {onOpenCheck !== undefined ? <ChevronRightIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" /> : null}
            </>
          )
          const rowClass = 'dshx:flex dshx:w-full dshx:items-center dshx:gap-3 dshx:px-3.5 dshx:py-3'
          return (
            <li key={check.id} className={cn(index > 0 && 'dshx:border-t dshx:border-border')}>
              {onOpenCheck !== undefined ? (
                <button
                  type="button"
                  onClick={() => onOpenCheck(check)}
                  className={cn(rowClass, 'dshx:outline-none dshx:hover:bg-accent/50 dshx:focus-visible:bg-accent/50')}
                >
                  {row}
                </button>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="dshx:flex dshx:gap-1.5 dshx:border-t dshx:border-border dshx:p-2.5">
        <button
          ref={buttonRef}
          type="button"
          disabled={!ready || state !== 'idle'}
          onClick={onMerge}
          className={cn(
            'dshx:relative dshx:inline-flex dshx:h-9 dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:justify-center dshx:gap-2 dshx:overflow-hidden dshx:rounded-lg dshx:text-sm dshx:font-medium dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:motion-safe:transition-colors dshx:motion-safe:duration-300',
            ready || state !== 'idle' ? 'dshx:bg-foreground dshx:text-background dshx:hover:bg-foreground/90' : 'dshx:bg-muted dshx:text-muted-foreground',
          )}
        >
          <span
            ref={shineRef}
            aria-hidden
            style={{ opacity: 0 }}
            className="dshx:pointer-events-none dshx:absolute dshx:inset-y-0 dshx:left-0 dshx:w-1/3 dshx:bg-gradient-to-r dshx:from-transparent dshx:via-background/35 dshx:to-transparent"
          />
          {state === 'merged' ? (
            <>
              <CheckIcon aria-hidden className="dshx:size-4" />
              <span className="dshx:truncate">Merged</span>
            </>
          ) : state === 'merging' ? (
            <ShimmerText className="dshx:truncate">Merging…</ShimmerText>
          ) : (
            <>
              <GitMergeIcon aria-hidden className="dshx:size-4 dshx:shrink-0" />
              <span className="dshx:truncate">{blocked ? 'Fix failing checks to merge' : (current?.label ?? 'Merge')}</span>
            </>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Merge strategy"
              disabled={state !== 'idle'}
              className={cn(
                'dshx:inline-flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:disabled:opacity-50 dshx:motion-safe:transition-colors dshx:motion-safe:duration-300',
                ready ? 'dshx:bg-foreground dshx:text-background dshx:hover:bg-foreground/90' : 'dshx:bg-muted dshx:text-muted-foreground dshx:hover:bg-accent',
              )}
            >
              <ChevronDownIcon aria-hidden className="dshx:size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={strategy} onValueChange={value => onStrategyChange?.(value)}>
              {strategies.map(item => (
                <DropdownMenuRadioItem key={item.id} value={item.id}>
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  )
}
