import * as React from 'react'
import { animate, drawStroke, durations, easings, motionSafe, springs, staggers, type AnimationPlaybackControls } from '../../motion/index.js'
import { ArrowUpIcon, PlusIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'
import { AutoHeight } from './auto-height.js'
import { ShimmerText } from './text.js'

export type ShapeshiftPhase = 'idle' | 'thinking' | 'view' | 'done'

export interface ShapeshiftView {
  /** Identity of the picked UI ("paycheck", "calendar"); a new key morphs the card into the new view. */
  readonly key: string
  readonly icon?: React.ReactNode
  readonly title: React.ReactNode
  readonly body: React.ReactNode
  readonly actions?: React.ReactNode
}

export interface ShapeshiftCardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'onSubmit'> {
  readonly prompt: string
  readonly onPromptChange?: (prompt: string) => void
  readonly onSubmit?: (prompt: string) => void
  readonly onDismiss?: () => void
  readonly placeholder?: string
  readonly phase: ShapeshiftPhase
  readonly view?: ShapeshiftView | null
  /** Shown while the intent is classified. */
  readonly thinkingLabel?: React.ReactNode
  /** The confirmation the card collapses to once the action ran. */
  readonly done?: { readonly title: React.ReactNode; readonly detail?: React.ReactNode } | null
}

/**
 * One input that turns into the right interactive UI: type a request, the agent classifies the intent and the card
 * reshapes (height and content morph) into a form, a calendar or an approval card; after the action it shrinks to a
 * confirmation with a drawn check. The views are passed in, so any pre-built UI can be a shape.
 */
export function ShapeshiftCard({
  prompt,
  onPromptChange,
  onSubmit,
  onDismiss,
  placeholder = 'What would you like to do?',
  phase,
  view,
  thinkingLabel = 'Picking the right view…',
  done,
  className,
  ...props
}: ShapeshiftCardProps) {
  const rootRef = React.useRef<HTMLElement>(null)
  const lastWidth = React.useRef<number | null>(null)
  const isDone = phase === 'done' && done != null

  // Width morph: the confirmation is a narrower card than the views.
  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (root == null) return
    root.style.width = ''
    const next = root.offsetWidth
    const previous = lastWidth.current
    lastWidth.current = next
    if (previous === null || Math.abs(previous - next) < 1) return
    const controls = animate(root, { width: [`${previous}px`, `${next}px`] }, motionSafe(springs.smooth))
    void controls.finished.then(() => {
      root.style.width = ''
    })
    return () => controls.stop()
  }, [isDone])

  const contentKey = isDone ? 'done' : phase === 'view' && view != null ? `view:${view.key}` : phase

  return (
    <section
      ref={rootRef}
      aria-label="Ask the agent"
      className={cn(
        'dshx:@container dshx:mx-auto dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-2xl dshx:border dshx:border-border dshx:bg-card dshx:shadow-lg',
        isDone ? 'dshx:w-72 dshx:max-w-full' : 'dshx:w-full',
        className,
      )}
      {...props}
    >
      <AutoHeight>
        {isDone ? null : (
          <form
            className="dshx:flex dshx:items-center dshx:gap-2.5 dshx:px-4 dshx:py-3"
            onSubmit={event => {
              event.preventDefault()
              if (prompt.trim() !== '') onSubmit?.(prompt)
            }}
          >
            <PlusIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
            <input
              value={prompt}
              onChange={event => onPromptChange?.(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') onDismiss?.()
              }}
              readOnly={onPromptChange === undefined}
              placeholder={placeholder}
              aria-label="Request"
              className="dshx:min-w-0 dshx:flex-1 dshx:bg-transparent dshx:text-sm dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={prompt.trim() === ''}
              className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-foreground dshx:text-background dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:disabled:bg-muted dshx:disabled:text-muted-foreground dshx:motion-safe:transition-colors"
            >
              <ArrowUpIcon aria-hidden className="dshx:size-4" />
            </button>
          </form>
        )}
        <Shape key={contentKey}>
          {isDone ? (
            <DoneMark heading={done.title} detail={done.detail} />
          ) : phase === 'thinking' ? (
            <div className="dshx:border-t dshx:border-border dshx:px-4 dshx:py-3 dshx:text-sm">
              <ShimmerText>{thinkingLabel}</ShimmerText>
            </div>
          ) : phase === 'view' && view != null ? (
            <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:border-t dshx:border-border dshx:px-4 dshx:pt-3 dshx:pb-4">
              <div
                data-shape-part
                className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:font-medium dshx:text-foreground dshx:[&_svg]:size-4 dshx:[&_svg]:text-muted-foreground"
              >
                {view.icon}
                <span className="dshx:min-w-0 dshx:truncate">{view.title}</span>
              </div>
              <div data-shape-part className="dshx:min-w-0">
                {view.body}
              </div>
              {view.actions !== undefined ? (
                <div data-shape-part className="dshx:flex dshx:justify-end dshx:gap-2">
                  {view.actions}
                </div>
              ) : null}
              {onDismiss !== undefined ? (
                <div data-shape-part className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
                  <kbd className="dshx:rounded dshx:border dshx:border-border dshx:bg-muted dshx:px-1.5 dshx:font-sans">Esc</kbd> to dismiss
                </div>
              ) : null}
            </div>
          ) : null}
        </Shape>
      </AutoHeight>
    </section>
  )
}

/** Plays the reshape entrance: the block blurs in and its parts rise in sequence. */
function Shape({ children }: { readonly children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const running: AnimationPlaybackControls[] = [
      animate(
        element,
        { opacity: [0, 1], filter: ['blur(8px)', 'blur(0px)'], transform: ['scale(0.985)', 'scale(1)'] },
        motionSafe({ duration: durations.slow, ease: easings.out }),
      ),
    ]
    const parts = Array.from(element.querySelectorAll('[data-shape-part]'))
    if (parts.length > 0)
      running.push(
        animate(
          parts,
          { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0px)'] },
          motionSafe({ ...springs.smooth, delay: (index: number) => 0.06 + index * staggers.loose }),
        ),
      )
    return () => {
      for (const controls of running) controls.complete()
    }
  }, [])
  return <div ref={ref}>{children}</div>
}

function DoneMark({ heading, detail }: { readonly heading: React.ReactNode; readonly detail: React.ReactNode | undefined }) {
  const pathRef = React.useRef<SVGPathElement>(null)
  React.useLayoutEffect(() => {
    if (pathRef.current == null) return
    const controls = drawStroke(pathRef.current, { duration: durations.slower, delay: 0.15, ease: easings.out })
    return () => controls.complete()
  }, [])
  return (
    <div role="status" className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-1.5 dshx:px-6 dshx:py-8 dshx:text-center">
      <svg viewBox="0 0 24 24" className="dshx:mb-1 dshx:size-6 dshx:text-foreground" fill="none" aria-hidden>
        <path ref={pathRef} d="M5 12.5 10 17.5 19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="dshx:text-base dshx:font-semibold dshx:text-foreground">{heading}</span>
      {detail !== undefined ? <span className="dshx:text-sm dshx:text-balance dshx:text-muted-foreground">{detail}</span> : null}
    </div>
  )
}
