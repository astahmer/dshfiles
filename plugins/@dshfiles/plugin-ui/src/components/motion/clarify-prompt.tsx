import * as React from 'react'
import { animate, motionSafe, springs, durations, easings, staggers } from '../../motion/index.js'
import { useEnter } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, DiamondIcon, PlusIcon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js'
import { RollingNumber } from './text.js'

export interface ClarifyCandidate {
  readonly id: string
  /** The bold subject the agent guesses ("Right panel"). */
  readonly label: string
  /** What the candidate points at: a screenshot, a hatched mock, a file excerpt. */
  readonly preview?: React.ReactNode
}

export interface ClarifyQuestion {
  readonly id: string
  /** Text before the subject ("Are you talking about the"). */
  readonly lead: string
  /** Text after it; defaults to "?". */
  readonly trail?: string
  readonly candidates: readonly ClarifyCandidate[]
}

export type ClarifyAnswer = 'yes' | 'no'

/** Plain text, or a highlighted token the agent understood: `target` (what) or `value` (how much). */
export type ClarifySegment = { readonly text: string } | { readonly id: string; readonly text: string; readonly tone: 'target' | 'value' }

export interface ClarifyPromptProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  readonly question: ClarifyQuestion
  /** 0-based position of this question in the batch. */
  readonly index: number
  readonly total: number
  readonly candidateIndex: number
  readonly onCandidateChange: (index: number) => void
  readonly onAnswer: (answer: ClarifyAnswer, candidateId: string | undefined) => void
  /** Resolved values under the preview (`24 24 24 24`). */
  readonly values?: readonly string[]
  /** Token or scale the values map to (`space/xl`). */
  readonly token?: string
  /** The draft prompt with the tokens the agent picked out. */
  readonly prompt: readonly ClarifySegment[]
  readonly onSubmit?: () => void
  readonly modelLabel?: string
}

/**
 * A clarifying question that rises out of the composer before the agent commits to a prompt: "Are you talking about
 * the **Right panel**?" with Yes / No, a candidate carousel with a preview, the resolved values, and the draft prompt
 * whose understood words light up (each letter hops in a quick wave while the highlight fades in).
 */
export function ClarifyPrompt({
  question,
  index,
  total,
  candidateIndex,
  onCandidateChange,
  onAnswer,
  values = [],
  token,
  prompt,
  onSubmit,
  modelLabel = 'Auto',
  className,
  ...props
}: ClarifyPromptProps) {
  const rootRef = React.useRef<HTMLElement>(null)
  useEnter(rootRef, 'riseIn', springs.smooth)
  const count = question.candidates.length
  const at = count === 0 ? 0 : ((candidateIndex % count) + count) % count
  const candidate = question.candidates[at]
  const lastAt = React.useRef(at)
  const direction = at === lastAt.current ? 0 : at > lastAt.current ? 1 : -1
  React.useEffect(() => {
    lastAt.current = at
  }, [at])
  const go = (delta: number) => count > 0 && onCandidateChange((at + delta + count) % count)

  return (
    <section
      ref={rootRef}
      aria-label="Clarifying question"
      className={cn(
        'dshx:@container dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-2xl dshx:border dshx:border-border dshx:bg-card dshx:text-card-foreground dshx:shadow-lg',
        className,
      )}
      {...props}
    >
      <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:p-3">
        <div className="dshx:flex dshx:items-baseline dshx:gap-3 dshx:px-1">
          <QuestionLine key={question.id} question={question} subject={candidate?.label ?? ''} direction={direction} />
          <span className="dshx:ml-auto dshx:inline-flex dshx:shrink-0 dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
            <RollingNumber value={index + 1} /> of {total}
          </span>
        </div>

        <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2" role="group" aria-label="Answer">
          <Button variant="outline" className="dshx:h-9" onClick={() => onAnswer('yes', candidate?.id)}>
            Yes
          </Button>
          <Button variant="outline" className="dshx:h-9" onClick={() => onAnswer('no', candidate?.id)}>
            No
          </Button>
        </div>

        {candidate?.preview !== undefined ? (
          <div
            className={cn(
              'dshx:relative dshx:flex dshx:h-48 dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-muted/60 dshx:@max-pane-narrow:h-40',
              count > 1 && 'dshx:px-12 dshx:@max-pane-narrow:px-11',
            )}
            role="group"
            aria-roledescription="carousel"
            aria-label={`Candidate ${at + 1} of ${count}: ${candidate.label}`}
          >
            <PreviewSlide key={candidate.id} direction={direction}>
              {candidate.preview}
            </PreviewSlide>
            {count > 1 ? (
              <>
                <CarouselArrow side="left" onClick={() => go(-1)} />
                <CarouselArrow side="right" onClick={() => go(1)} />
              </>
            ) : null}
          </div>
        ) : null}

        {values.length > 0 || token ? (
          <div className="dshx:flex dshx:items-center dshx:gap-1.5">
            {values.map((value, i) => (
              <WaveToken key={`${i}:${value}`} tone="value" text={value} className="dshx:text-sm" />
            ))}
            {token ? (
              <span className="dshx:ml-auto dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-sm dshx:text-muted-foreground">
                <DiamondIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
                <span className="dshx:truncate dshx:font-mono">{token}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:border-t dshx:border-border dshx:p-3">
        <p className="dshx:px-1 dshx:text-sm dshx:leading-7" aria-label="Draft prompt">
          {prompt.map((segment, i) =>
            'tone' in segment ? (
              <WaveToken key={`${segment.id}:${segment.text}`} tone={segment.tone} text={segment.text} />
            ) : (
              <span key={i}>{segment.text}</span>
            ),
          )}
        </p>
        <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-muted-foreground">
          <PlusIcon aria-hidden className="dshx:size-4" />
          <span aria-hidden className="dshx:text-sm">
            /
          </span>
          <span className="dshx:ml-auto dshx:text-sm">{modelLabel}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                aria-label="Send"
                className="dshx:rounded-full dshx:bg-foreground dshx:text-background dshx:hover:bg-foreground/90"
                onClick={onSubmit}
              >
                <ArrowUpIcon aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Send</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </section>
  )
}

function QuestionLine({ question, subject, direction }: { readonly question: ClarifyQuestion; readonly subject: string; readonly direction: number }) {
  const ref = React.useRef<HTMLParagraphElement>(null)
  useEnter(ref, 'blurIn', { duration: durations.base, ease: easings.out })
  return (
    <p ref={ref} className="dshx:min-w-0 dshx:text-sm dshx:text-muted-foreground" aria-live="polite">
      {question.lead} <SubjectWord key={subject} text={subject} direction={direction} />
      {question.trail ?? '?'}
    </p>
  )
}

function SubjectWord({ text, direction }: { readonly text: string; readonly direction: number }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null || direction === 0) return
    const from = direction > 0 ? 'translateY(70%)' : 'translateY(-70%)'
    const c = animate(ref.current, { transform: [from, 'translateY(0%)'], opacity: [0, 1] }, motionSafe(springs.snappy))
    return () => c.complete()
  }, [direction])
  return (
    <span ref={ref} className="dshx:inline-block dshx:font-semibold dshx:text-foreground">
      {text}
    </span>
  )
}

function PreviewSlide({ direction, children }: { readonly direction: number; readonly children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const from = direction === 0 ? 'translateX(0px) scale(0.97)' : direction > 0 ? 'translateX(36px) scale(0.98)' : 'translateX(-36px) scale(0.98)'
    const c = animate(ref.current, { transform: [from, 'translateX(0px) scale(1)'], opacity: [0, 1] }, motionSafe(springs.smooth))
    return () => c.complete()
  }, [direction])
  return (
    <div ref={ref} className="dshx:flex dshx:h-full dshx:w-full dshx:min-w-0 dshx:items-center dshx:justify-center">
      {children}
    </div>
  )
}

function CarouselArrow({ side, onClick }: { readonly side: 'left' | 'right'; readonly onClick: () => void }) {
  const label = side === 'left' ? 'Previous candidate' : 'Next candidate'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className={cn(
            'dshx:absolute dshx:top-1/2 dshx:-translate-y-1/2 dshx:rounded-full dshx:bg-card dshx:shadow-sm',
            side === 'left' ? 'dshx:left-3 dshx:@max-pane-narrow:left-2' : 'dshx:right-3 dshx:@max-pane-narrow:right-2',
          )}
        >
          {side === 'left' ? <ChevronLeftIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** A highlighted token: its background fades in while each letter hops 3px in a quick wave. */
export function WaveToken({ text, tone, className }: { readonly text: string; readonly tone: 'target' | 'value'; readonly className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null) return
    const wash = element.querySelector('[data-wash]')
    const letters = Array.from(element.querySelectorAll('[data-letter]'))
    const fade = wash ? animate(wash, { opacity: [0, 1] }, motionSafe({ duration: durations.slow, ease: easings.out })) : null
    const wave = letters.length
      ? animate(
          letters,
          { transform: ['translateY(0px)', 'translateY(-3px)', 'translateY(0px)'] },
          motionSafe({ duration: 0.34, ease: easings.inOut, delay: (i: number) => i * staggers.tight }),
        )
      : null
    return () => {
      fade?.complete()
      wave?.complete()
    }
  }, [])
  return (
    <span
      ref={ref}
      className={cn(
        'dshx:relative dshx:mx-px dshx:inline-block dshx:px-1 dshx:font-medium',
        tone === 'target' ? 'dshx:text-chart-3' : 'dshx:text-info',
        className,
      )}
    >
      <span data-wash aria-hidden className={cn('dshx:absolute dshx:inset-0 dshx:rounded-md', tone === 'target' ? 'dshx:bg-chart-3/15' : 'dshx:bg-info/15')} />
      <span className="dshx:sr-only">{text}</span>
      <span aria-hidden className="dshx:relative">
        {Array.from(text).map((char, i) => (
          <span key={i} data-letter className="dshx:inline-block dshx:whitespace-pre">
            {char}
          </span>
        ))}
      </span>
    </span>
  )
}
