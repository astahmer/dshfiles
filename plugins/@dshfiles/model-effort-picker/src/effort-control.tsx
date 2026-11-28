import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ModelPickerModel } from './model-picker-model.js'
import { InfoHint } from './picker-atoms.js'

interface Effort {
  readonly id: string
  readonly name: string
}

/** One segment: a level, or the provider's default (`id` undefined). */
interface Segment {
  readonly id: string | undefined
  readonly label: string
  readonly name: string
}

/** How long arrowing has to rest on a level before it applies (round 3 R6). */
export const EFFORT_SETTLE_MS = 600

/**
 * Round 3 R6: arrowing through the levels previews each one and applies only the level it settles on (after
 * EFFORT_SETTLE_MS, or at once on Enter, Space or leaving the group), so walking from Off to Max does not commit every
 * level in between. A click applies at once. `schedule` is injectable so the rule is testable without a DOM.
 */
export const createEffortCommitter = (input: {
  readonly commit: (effort: string | undefined) => void
  readonly schedule: (run: () => void, ms: number) => () => void
}) => {
  let pending: { readonly value: string | undefined } | null = null
  let cancel: (() => void) | null = null
  const clear = (): void => {
    cancel?.()
    cancel = null
  }
  const flush = (): void => {
    clear()
    if (pending === null) return
    const { value } = pending
    pending = null
    input.commit(value)
  }
  return {
    /** An arrow key landed on `value`: show it, apply it once arrowing rests. */
    preview: (value: string | undefined): void => {
      clear()
      pending = { value }
      cancel = input.schedule(flush, EFFORT_SETTLE_MS)
    },
    /** A click, Enter or Space: apply now. */
    commitNow: (value: string | undefined): void => {
      clear()
      pending = null
      input.commit(value)
    },
    /** Focus left the group: apply what was previewed. */
    flush,
    dispose: clear,
  }
}

/**
 * Council picker round 1, C1, and round 3, R6: reasoning effort as one radio group that always has a checked option. The
 * first segment is "Auto" (named "Provider default"), then one per level the model supports with short labels, 28 px tall
 * (44 px on touch, four to a row when the levels would not fit). The heading names the state ("Provider default" or the
 * level). A model without levels shows nothing.
 */
export const EffortControl = (props: {
  readonly efforts: readonly Effort[]
  /** The chosen effort id; undefined leaves it to the provider. */
  readonly selected: string | undefined
  readonly onChange: (effort: string | undefined) => void
}) => {
  const group = useRef<HTMLDivElement>(null)
  const headingId = useId()
  const [preview, setPreview] = useState<{ readonly value: string | undefined } | null>(null)
  const onChange = useRef(props.onChange)
  onChange.current = props.onChange
  const committer = useMemo(
    () =>
      createEffortCommitter({
        commit: value => {
          setPreview(null)
          onChange.current(value)
        },
        schedule: (run, ms) => {
          const timer = setTimeout(run, ms)
          return () => clearTimeout(timer)
        },
      }),
    [],
  )
  useEffect(() => () => committer.dispose(), [committer])
  if (props.efforts.length === 0) return null

  const segments: readonly Segment[] = [
    // Round 4 T4: the accessible name contains the visible word (WCAG 2.5.3).
    { id: undefined, label: 'Auto', name: 'Auto, provider default' },
    ...props.efforts.map(effort => ({ id: effort.id, label: ModelPickerModel.effortShortLabel(effort), name: effort.name })),
  ]
  const shown = preview === null ? props.selected : preview.value
  const found = segments.findIndex(segment => segment.id === shown)
  const checkedIndex = found < 0 ? 0 : found
  const heading = checkedIndex === 0 ? 'Provider default' : (segments[checkedIndex]?.name ?? 'Provider default')

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      committer.commitNow(segments[index]?.id)
      return
    }
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? segments.length - 1 : undefined
    if (step === 0 && edge === undefined) return
    event.preventDefault()
    const next = edge ?? Math.min(segments.length - 1, Math.max(0, index + step))
    const segment = segments[next]
    if (segment === undefined) return
    setPreview({ value: segment.id })
    committer.preview(segment.id)
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <section aria-label="Reasoning effort" className="dshx:@container/effort dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1.5" data-model-effort>
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
        <h3 className="dshx:truncate dshx:text-xs dshx:font-medium" id={headingId}>
          Reasoning effort · <span className="dshx:font-normal dshx:text-muted-foreground">{heading}</span>
        </h3>
        <InfoHint description="Higher effort lets the model think for longer before it answers." label="About reasoning effort" />
      </div>
      <div
        // Round 4 T4: a stable group name; the chosen value is in the heading and on the checked radio.
        aria-label="Reasoning effort"
        className={cn(
          'dshx:grid dshx:grid-cols-[repeat(auto-fit,minmax(2rem,1fr))] dshx:gap-0.5 dshx:rounded-lg dshx:bg-segment-track dshx:p-0.5',
          // Round 4 T8: on touch a wrapping row with no empty cell. Up to seven segments share one row while the track is
          // 324 px or wider (each at least 44 pt); eight, or a narrower track, wrap four to a row and the last row stretches.
          'dshx:pointer-coarse:flex dshx:pointer-coarse:flex-wrap',
        )}
        data-model-effort-options
        onBlur={event => {
          if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) committer.flush()
        }}
        ref={group}
        role="radiogroup"
      >
        {segments.map((segment, index) => {
          const checked = index === checkedIndex
          return (
            <button
              aria-checked={checked}
              aria-label={segment.name}
              className={cn(
                'dshx:h-7 dshx:min-w-0 dshx:rounded-md dshx:px-1 dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-11',
                'dshx:pointer-coarse:min-w-11 dshx:pointer-coarse:flex-1',
                segments.length > 7
                  ? 'dshx:pointer-coarse:basis-[calc(25%-0.125rem)]'
                  : 'dshx:pointer-coarse:basis-0 dshx:@max-[20.25rem]/effort:pointer-coarse:basis-[calc(25%-0.125rem)]',
                checked && 'dshx:segment-thumb dshx:font-selected dshx:text-foreground',
              )}
              data-model-effort-default={segment.id === undefined || undefined}
              data-model-effort-option
              key={segment.id ?? '(provider default)'}
              onClick={() => committer.commitNow(segment.id)}
              onKeyDown={event => onKeyDown(event, index)}
              role="radio"
              tabIndex={checked ? 0 : -1}
              type="button"
            >
              {segment.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
