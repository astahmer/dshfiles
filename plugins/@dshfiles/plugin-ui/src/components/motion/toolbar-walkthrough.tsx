import * as React from 'react'
import { animate, motionSafe, springs, durations, easings } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'
import { GripVerticalIcon, XIcon, type LucideIcon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js'
import { RollingNumber } from './text.js'

export interface WalkthroughTool {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  /** Draw a divider before this tool. */
  readonly separatorBefore?: boolean
}

export interface WalkthroughStep {
  /** The tool this step points at. */
  readonly toolId: string
  readonly title: string
  readonly body: string
  readonly preview?: React.ReactNode
}

export interface ToolbarWalkthroughProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  readonly tools: readonly WalkthroughTool[]
  readonly steps: readonly WalkthroughStep[]
  /** Current step, or `null` when the walkthrough is closed. */
  readonly step: number | null
  readonly onStepChange: (step: number) => void
  readonly onClose: () => void
  readonly onToolSelect?: (toolId: string) => void
  /** Show the drag grip at the toolbar's start. Default true. */
  readonly grip?: boolean
}

/**
 * A floating toolbar with a guided tour: a coach card hovers over the tool it explains, glides sideways to the next
 * tool on Next / Previous (its arrow tracking the button), swaps its title, preview and copy, and the active ring
 * slides along the toolbar. Clicking a tool jumps to its step.
 */
export function ToolbarWalkthrough({ tools, steps, step, onStepChange, onClose, onToolSelect, grip = true, className, ...props }: ToolbarWalkthroughProps) {
  const rootRef = React.useRef<HTMLElement>(null)
  const barRef = React.useRef<HTMLDivElement>(null)
  const ringRef = React.useRef<HTMLSpanElement>(null)
  const cardRef = React.useRef<HTMLDivElement>(null)
  const arrowRef = React.useRef<HTMLSpanElement>(null)
  const current = step === null ? undefined : steps[step]
  const activeId = current?.toolId
  const lastStep = React.useRef<number | null>(step)
  const direction = step === null || lastStep.current === null ? 0 : step > lastStep.current ? 1 : step < lastStep.current ? -1 : 0
  React.useEffect(() => {
    lastStep.current = step
  }, [step])

  // Glide the ring and the card to the active tool.
  const place = React.useCallback(
    (instant: boolean) => {
      const root = rootRef.current
      const bar = barRef.current
      if (root == null || bar == null) return []
      const button = activeId === undefined ? null : bar.querySelector<HTMLElement>(`[data-tool-id="${CSS.escape(activeId)}"]`)
      const controls: ReturnType<typeof animate>[] = []
      const options = instant ? { duration: 0 } : motionSafe(springs.smooth)
      const ring = ringRef.current
      if (ring != null) {
        if (button == null) controls.push(animate(ring, { opacity: 0 }, motionSafe({ duration: durations.fast })))
        else {
          const wasHidden = ring.style.opacity === '' || ring.style.opacity === '0'
          const target = { left: `${button.offsetLeft}px`, width: `${button.offsetWidth}px` }
          controls.push(animate(ring, { ...target, opacity: 1 }, wasHidden ? { duration: 0 } : options))
        }
      }
      const card = cardRef.current
      const arrow = arrowRef.current
      if (button != null && card != null) {
        const rootBox = root.getBoundingClientRect()
        const buttonBox = button.getBoundingClientRect()
        const center = buttonBox.left + buttonBox.width / 2 - rootBox.left
        const width = card.offsetWidth
        const left = Math.max(0, Math.min(rootBox.width - width, center - width / 2))
        controls.push(animate(card, { left: `${left}px` }, options))
        if (arrow != null) controls.push(animate(arrow, { left: `${Math.max(14, Math.min(width - 14, center - left)) - 7}px` }, options))
      }
      return controls
    },
    [activeId],
  )

  const opened = React.useRef(false)
  React.useLayoutEffect(() => {
    const first = !opened.current && step !== null
    opened.current = step !== null
    const controls = place(first)
    return () => {
      for (const c of controls) c.stop()
    }
  }, [place, step])

  React.useEffect(() => {
    const root = rootRef.current
    if (root == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => place(true))
    observer.observe(root)
    return () => observer.disconnect()
  }, [place])

  return (
    <section
      ref={rootRef}
      aria-label="Toolbar"
      className={cn('dshx:@container dshx:relative dshx:flex dshx:w-full dshx:flex-col dshx:items-start dshx:gap-3', className)}
      {...props}
    >
      {current !== undefined && step !== null ? (
        <CoachCard
          ref={cardRef}
          arrowRef={arrowRef}
          step={current}
          index={step}
          total={steps.length}
          direction={direction}
          onPrevious={() => onStepChange(Math.max(0, step - 1))}
          onNext={() => (step >= steps.length - 1 ? onClose() : onStepChange(step + 1))}
          onClose={onClose}
        />
      ) : null}
      <div
        ref={barRef}
        role="toolbar"
        aria-label="Tools"
        className="dshx:relative dshx:mx-auto dshx:flex dshx:max-w-full dshx:items-center dshx:gap-1 dshx:overflow-x-auto dshx:rounded-2xl dshx:border dshx:border-border dshx:bg-card dshx:p-1.5 dshx:shadow-md dshx:[scrollbar-width:none] dshx:@max-pane-narrow:gap-0 dshx:@max-pane-narrow:p-1"
      >
        <span
          ref={ringRef}
          aria-hidden
          className="dshx:pointer-events-none dshx:absolute dshx:top-1.5 dshx:bottom-1.5 dshx:@max-pane-narrow:top-1 dshx:@max-pane-narrow:bottom-1 dshx:rounded-xl dshx:bg-primary/10 dshx:opacity-0 dshx:ring-2 dshx:ring-primary/40"
        />
        {grip ? (
          <span
            aria-hidden
            className="dshx:inline-flex dshx:size-10 dshx:shrink-0 dshx:cursor-grab dshx:items-center dshx:justify-center dshx:text-muted-foreground dshx:@max-pane-narrow:hidden"
          >
            <GripVerticalIcon className="dshx:size-4" />
          </span>
        ) : null}
        {tools.map(tool => {
          const Icon = tool.icon
          const index = steps.findIndex(s => s.toolId === tool.id)
          return (
            <React.Fragment key={tool.id}>
              {tool.separatorBefore ? <span aria-hidden className="dshx:mx-0.5 dshx:h-6 dshx:w-px dshx:shrink-0 dshx:bg-border" /> : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-tool-id={tool.id}
                    aria-label={tool.label}
                    aria-pressed={tool.id === activeId}
                    onClick={() => {
                      onToolSelect?.(tool.id)
                      if (step !== null && index >= 0) onStepChange(index)
                    }}
                    className={cn(
                      'dshx:relative dshx:inline-flex dshx:size-10 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl dshx:outline-none dshx:transition-colors dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:@max-pane-compact:size-9 dshx:@max-pane-narrow:size-8',
                      tool.id === activeId ? 'dshx:text-primary' : 'dshx:text-foreground dshx:hover:bg-accent',
                    )}
                  >
                    <Icon aria-hidden className="dshx:size-5 dshx:@max-pane-narrow:size-[18px]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{tool.label}</TooltipContent>
              </Tooltip>
            </React.Fragment>
          )
        })}
      </div>
    </section>
  )
}

interface CoachCardProps {
  readonly arrowRef: React.RefObject<HTMLSpanElement>
  readonly step: WalkthroughStep
  readonly index: number
  readonly total: number
  readonly direction: number
  readonly onPrevious: () => void
  readonly onNext: () => void
  readonly onClose: () => void
}

const CoachCard = React.forwardRef<HTMLDivElement, CoachCardProps>(function CoachCard(
  { arrowRef, step, index, total, direction, onPrevious, onNext, onClose },
  ref,
) {
  const innerRef = React.useRef<HTMLDivElement>(null)
  // Pop up from the toolbar when the tour opens.
  React.useLayoutEffect(() => {
    if (innerRef.current == null) return
    const c = animate(
      innerRef.current,
      { opacity: [0, 1], transform: ['translateY(10px) scale(0.96)', 'translateY(0px) scale(1)'] },
      motionSafe(springs.bouncy),
    )
    return () => c.complete()
  }, [])
  const last = index >= total - 1
  return (
    <div ref={ref} className="dshx:relative dshx:w-[300px] dshx:max-w-full" role="dialog" aria-modal={false} aria-label={step.title}>
      <div ref={innerRef} className="dshx:relative dshx:origin-bottom dshx:rounded-2xl dshx:bg-primary dshx:p-4 dshx:text-primary-foreground dshx:shadow-xl">
        <CardContent key={index} step={step} direction={direction} onClose={onClose} />
        <div className="dshx:mt-4 dshx:flex dshx:items-center dshx:gap-1">
          <span className="dshx:inline-flex dshx:text-sm dshx:opacity-80" aria-label={`Step ${index + 1} of ${total}`}>
            <RollingNumber value={index + 1} />/{total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="dshx:ml-auto dshx:text-primary-foreground/85 dshx:hover:bg-primary-foreground/15 dshx:hover:text-primary-foreground"
            onClick={onPrevious}
            disabled={index === 0}
          >
            Previous
          </Button>
          <Button size="sm" className="dshx:bg-primary-foreground dshx:text-primary dshx:hover:bg-primary-foreground/90" onClick={onNext}>
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
        <span
          ref={arrowRef}
          aria-hidden
          className="dshx:absolute dshx:-bottom-1.5 dshx:left-[143px] dshx:size-3.5 dshx:rotate-45 dshx:rounded-[3px] dshx:bg-primary"
        />
      </div>
    </div>
  )
})

function CardContent({ step, direction, onClose }: { readonly step: WalkthroughStep; readonly direction: number; readonly onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const parts = Array.from(element.querySelectorAll('[data-part]'))
    const from = direction > 0 ? 'translateX(12px)' : direction < 0 ? 'translateX(-12px)' : 'translateX(0px)'
    const c = animate(
      parts,
      { opacity: [0, 1], transform: [from, 'translateX(0px)'], filter: ['blur(4px)', 'blur(0px)'] },
      motionSafe({ duration: durations.slow, ease: easings.out, delay: (i: number) => i * 0.04 }),
    )
    return () => c.complete()
  }, [direction])
  return (
    <div ref={ref} className="dshx:flex dshx:flex-col dshx:gap-3" aria-live="polite">
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <h3 data-part className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-semibold">
          {step.title}
        </h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close tour"
              onClick={onClose}
              className="dshx:text-primary-foreground dshx:hover:bg-primary-foreground/15 dshx:hover:text-primary-foreground"
            >
              <XIcon aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close tour</TooltipContent>
        </Tooltip>
      </div>
      {step.preview !== undefined ? (
        <div
          data-part
          className="dshx:flex dshx:h-32 dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:rounded-xl dshx:bg-card dshx:text-card-foreground"
        >
          {step.preview}
        </div>
      ) : null}
      <p data-part className="dshx:text-sm dshx:leading-relaxed dshx:opacity-90">
        {step.body}
      </p>
    </div>
  )
}
