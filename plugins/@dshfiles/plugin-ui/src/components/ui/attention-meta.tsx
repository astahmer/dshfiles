import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { ProjectMark, type ProjectMarkProps } from './project-mark.js'

/** The asks a thread can wait on: the one word list every surface prints (council round 14). */
export type AttentionKind = 'approval' | 'question' | 'failed'

/**
 * The words for each ask, the same on the thread list, the Inbox and the phone: never "Thread question" or "BA ·
 * Approval" on one surface and "Approval · BA billing…" on another (council round 14 A1).
 */
export const ATTENTION_KIND_LABEL = {
  approval: 'Approval',
  question: 'Question',
  failed: 'Turn failed',
} as const satisfies Record<AttentionKind, string>

/** A project name is shown whole or with at least this many characters; anything shorter is a stub and drops out. */
export const ATTENTION_META_NAME_MIN = 8

/**
 * What the line still shows, in drop order. `keep="kind"`: everything; without the age; without the project's name (its
 * mark stays; past it the kind truncates). `keep="name"`: everything; without the age; without the kind (the name
 * truncates to its floor); the mark alone.
 */
export type AttentionMetaStep = 'full' | 'no-age' | 'no-name' | 'no-kind' | 'mark'

/**
 * Which word outlasts the other when the line runs short. `kind` (the default): the name goes before the kind (an Inbox
 * card). `name`: the kind goes before the name, where the row already says the kind with its status glyph and its verb
 * (the desktop thread list).
 */
export type AttentionMetaKeep = 'kind' | 'name'

/** The measured parts of one line, in CSS px. Absent parts are 0. */
export interface AttentionMetaWidths {
  /** The content box the line has. */
  readonly available: number
  /** What comes before the name: the inline mark, or the rail seat with its gap; 0 without a project. */
  readonly lead: number
  /** The name with the gap that precedes it. */
  readonly name: number
  /** The narrowest the name may get: its first eight characters and an ellipsis (or the whole name when shorter). */
  readonly nameMin: number
  readonly kind: number
  readonly age: number
  /** One "·" separator with its spacing. */
  readonly sep: number
  /** The mark hangs in a rail: with the name gone, the kind follows the rail without a separator. */
  readonly rail: boolean
  /** Which word outlasts the other; `kind` when left out. */
  readonly keep?: AttentionMetaKeep | undefined
}

/** Sub-pixel rounding slack, so a part that fits exactly is not dropped. */
const FIT_SLACK = 0.5

/**
 * The drop order (council round 14): the age goes first, then the name truncates down to eight characters, then the
 * name goes and the mark alone names the project. With `keep: 'name'` the kind goes right after the age, then the name
 * truncates to its floor, then only the mark is left. Pure, so each step is testable without layout.
 */
export const attentionMetaStep = (widths: AttentionMetaWidths): AttentionMetaStep => {
  const { available, lead, name, nameMin, kind, age, sep, rail, keep = 'kind' } = widths
  const fits = (width: number): boolean => width <= available + FIT_SLACK
  const kindAfter = (nameShown: boolean): number => (kind === 0 ? 0 : kind + (nameShown || (lead > 0 && !rail) ? sep : 0))
  const ageAfter = age === 0 ? 0 : age + sep
  const withName = (nameWidth: number): number => lead + nameWidth + kindAfter(name > 0)
  if (fits(withName(name) + ageAfter)) return 'full'
  if (name === 0) return 'no-age'
  if (keep === 'name') {
    if (fits(withName(name))) return 'no-age'
    const nameFits = fits(lead + Math.min(name, nameMin))
    if (kind === 0) return nameFits ? 'no-age' : 'no-name'
    return nameFits ? 'no-kind' : 'mark'
  }
  if (fits(withName(Math.min(name, nameMin)))) return 'no-age'
  return 'no-name'
}

/** One ResizeObserver for every line on the page (a thread list draws one per row). */
const ResizeWatch = (() => {
  const callbacks = new WeakMap<Element, () => void>()
  let observer: ResizeObserver | undefined
  return {
    observe(elements: readonly Element[], callback: () => void): () => void {
      if (typeof ResizeObserver === 'undefined') return () => undefined
      observer ??= new ResizeObserver(entries => {
        for (const entry of entries) callbacks.get(entry.target)?.()
      })
      for (const element of elements) {
        callbacks.set(element, callback)
        observer.observe(element)
      }
      return () => {
        for (const element of elements) {
          observer?.unobserve(element)
          callbacks.delete(element)
        }
      }
    },
  } as const
})()

const widthOf = (element: Element | null | undefined): number => (element === null || element === undefined ? 0 : element.getBoundingClientRect().width)
const px = (value: string): number => {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : 0
}

const stubOf = (name: string): string => ([...name].length <= ATTENTION_META_NAME_MIN ? name : `${[...name].slice(0, ATTENTION_META_NAME_MIN).join('')}…`)

export interface AttentionMetaProps extends Omit<React.ComponentPropsWithoutRef<'span'>, 'children'> {
  /** The project's display name. Without it the line has no mark and no name. */
  readonly project?: string | undefined
  /** The kind in words: one of `ATTENTION_KIND_LABEL`, or a surface's own word ("Ready to land", "Waiting on 1 subagent"). */
  readonly kind?: string | undefined
  /** The age ("2m"), on surfaces that show one. It is the first part to go. */
  readonly age?: string | undefined
  /**
   * `inline` (default): the mark leads the line, 6px before the name (Inbox cards). `rail`: the mark hangs in a 16px seat
   * in the row's leading glyph column, `--attention-meta-rail-gap` (default 8px) before the name, so every row's mark
   * forms one rail and the name lines up with the title (thread list rows).
   */
  readonly markSeat?: 'inline' | 'rail' | undefined
  /** How the mark is painted: the owner's `tone`, `color` and `palette`, plus any data attribute. */
  readonly mark?: (Omit<ProjectMarkProps, 'name' | 'size' | 'decorative'> & { readonly [data: `data-${string}`]: string | undefined }) | undefined
  /** Extra classes for the kind (a status ink, a weight). */
  readonly kindClassName?: string | undefined
  /**
   * Which word outlasts the other when the line runs short. `kind` (default): age, then name. `name`: age, then the kind,
   * then the name truncates to its eight-character floor, then only the mark is left; for a row whose status glyph and
   * verb already say the kind (the desktop thread list).
   */
  readonly keep?: AttentionMetaKeep | undefined
}

const PART = 'data-measure-part'

/** The muted "·" between parts: 4px each side; assistive tech hears a comma instead. */
const Separator = (): JSX.Element => (
  <span data-attention-meta-part="sep" className="dshx:shrink-0 dshx:px-1">
    <span aria-hidden="true">·</span>
    <span className="dshx:sr-only">, </span>
  </span>
)

/**
 * The attention meta line (council round 14 A1): `ProjectMark project · kind · age`, one formatter for the thread list,
 * the Inbox and the phone. It measures itself: when the line runs out of room the age goes first, then the project's
 * name truncates, and once fewer than eight of its characters would show, the name goes and the mark alone names the
 * project (the dropped words stay for assistive tech). With `keep="name"` the kind goes right after the age instead.
 * The line takes its width from its parent (`flex-1`); 12/16 muted by default.
 */
export const AttentionMeta = React.forwardRef<HTMLSpanElement, AttentionMetaProps>(function AttentionMeta(
  { project, kind, age, markSeat = 'inline', mark, kindClassName, keep = 'kind', className, ...props },
  forwardedRef,
) {
  const rail = markSeat === 'rail'
  const root = React.useRef<HTMLSpanElement | null>(null)
  const lead = React.useRef<HTMLSpanElement | null>(null)
  const layer = React.useRef<HTMLSpanElement | null>(null)
  const [step, setStep] = React.useState<AttentionMetaStep>('full')
  const name = project !== undefined && project.length > 0 ? project : undefined
  const kindText = kind !== undefined && kind.length > 0 ? kind : undefined
  const ageText = age !== undefined && age.length > 0 ? age : undefined

  const setRoot = React.useCallback(
    (element: HTMLSpanElement | null) => {
      root.current = element
      if (typeof forwardedRef === 'function') forwardedRef(element)
      else if (forwardedRef !== null) forwardedRef.current = element
    },
    [forwardedRef],
  )

  const measure = React.useCallback(() => {
    const line = root.current
    const parts = layer.current
    if (line === null || parts === null) return
    const style = getComputedStyle(line)
    const part = (key: string): number => widthOf(parts.querySelector(`[${PART}="${key}"]`))
    const seat = lead.current
    const leadWidth = seat === null ? 0 : widthOf(seat) + (rail ? px(getComputedStyle(seat).marginRight) : 0)
    const next = attentionMetaStep({
      available: widthOf(line) - px(style.paddingLeft) - px(style.paddingRight),
      lead: leadWidth,
      name: name === undefined ? 0 : part('name'),
      nameMin: name === undefined ? 0 : part('name-min'),
      kind: kindText === undefined ? 0 : part('kind'),
      age: ageText === undefined ? 0 : part('age'),
      sep: part('sep'),
      rail,
      keep,
    })
    setStep(current => (current === next ? current : next))
  }, [name, kindText, ageText, rail, keep])

  React.useLayoutEffect(() => {
    measure()
    const line = root.current
    const parts = layer.current
    if (line === null || parts === null) return undefined
    // The layer resizes when the web font arrives; the line when its column does.
    return ResizeWatch.observe([line, parts], measure)
  }, [measure, kindClassName])

  const nameShown = name !== undefined && step !== 'no-name' && step !== 'mark'
  const kindShown = kindText !== undefined && step !== 'no-kind' && step !== 'mark'
  const ageShown = ageText !== undefined && step === 'full'
  const markElement =
    name === undefined ? null : <ProjectMark {...mark} ref={rail ? undefined : lead} name={name} size="dense" data-attention-meta-part="mark" />
  const nameClass = cn('dshx:whitespace-nowrap', !rail && 'dshx:pl-1.5')
  const kindClass = cn('dshx:whitespace-nowrap', kindClassName)

  return (
    <span
      ref={setRoot}
      data-slot="attention-meta"
      data-mark-seat={markSeat}
      data-step={step}
      className={cn(
        'dshx:relative dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:overflow-hidden dshx:text-xs/4 dshx:whitespace-nowrap dshx:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {rail ? (
        <span
          ref={lead}
          data-attention-meta-part="rail"
          className="dshx:mr-[var(--attention-meta-rail-gap,0.5rem)] dshx:inline-flex dshx:w-4 dshx:shrink-0 dshx:justify-center"
        >
          {markElement}
        </span>
      ) : (
        markElement
      )}
      {name === undefined ? null : nameShown ? (
        <span data-attention-meta-part="name" className={cn(nameClass, 'dshx:min-w-0 dshx:truncate')}>
          {name}
        </span>
      ) : (
        <span className="dshx:sr-only">{rail || !kindShown ? `${name}, ` : name}</span>
      )}
      {kindText === undefined ? null : kindShown ? (
        <>
          {nameShown || (name !== undefined && !rail) ? <Separator /> : null}
          <span data-attention-meta-part="kind" className={cn(kindClass, nameShown ? 'dshx:shrink-0' : 'dshx:min-w-0 dshx:truncate')}>
            {kindText}
          </span>
        </>
      ) : (
        <span className="dshx:sr-only">{nameShown ? `, ${kindText}` : kindText}</span>
      )}
      {ageText === undefined ? null : ageShown ? (
        <>
          {name !== undefined || kindText !== undefined ? <Separator /> : null}
          <span data-attention-meta-part="age" className="dshx:shrink-0 dshx:tabular-nums">
            {ageText}
          </span>
        </>
      ) : (
        <span className="dshx:sr-only">, {ageText}</span>
      )}
      {/* The parts at their natural width, measured to pick the step; never seen or read. */}
      <span
        ref={layer}
        aria-hidden="true"
        data-attention-meta-measure=""
        className="dshx:pointer-events-none dshx:invisible dshx:absolute dshx:top-0 dshx:left-0 dshx:flex dshx:w-max dshx:whitespace-nowrap"
      >
        {name === undefined ? null : (
          <>
            <span data-measure-part="name" className={cn(nameClass, 'dshx:shrink-0')}>
              {name}
            </span>
            <span data-measure-part="name-min" className={cn(nameClass, 'dshx:shrink-0')}>
              {stubOf(name)}
            </span>
          </>
        )}
        {kindText === undefined ? null : (
          <span data-measure-part="kind" className={cn(kindClass, 'dshx:shrink-0')}>
            {kindText}
          </span>
        )}
        {ageText === undefined ? null : (
          <span data-measure-part="age" className="dshx:shrink-0 dshx:tabular-nums">
            {ageText}
          </span>
        )}
        <span data-measure-part="sep" className="dshx:shrink-0 dshx:px-1">
          ·
        </span>
      </span>
    </span>
  )
})
