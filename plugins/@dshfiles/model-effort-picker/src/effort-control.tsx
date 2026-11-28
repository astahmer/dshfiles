import { useId, useRef, type KeyboardEvent } from 'react'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { ModelPickerModel } from './model-picker-model.js'
import { InfoHint } from './picker-atoms.js'

interface Effort {
  readonly id: string
  readonly name: string
}

/**
 * Council picker round 1, C1: reasoning effort as a discrete choice. One radio per level the model supports, with short
 * labels, 28 px tall (44 px on touch); the chosen level is named in the heading. "Provider default" is its own option
 * under the levels, so an effort the thread left to the provider never reads as the first level. Arrow keys move
 * between levels (one tab stop). A model without levels shows nothing.
 */
export const EffortControl = (props: {
  readonly efforts: readonly Effort[]
  /** The chosen effort id; undefined leaves it to the provider. */
  readonly selected: string | undefined
  readonly onChange: (effort: string | undefined) => void
}) => {
  const group = useRef<HTMLDivElement>(null)
  const headingId = useId()
  if (props.efforts.length === 0) return null
  const selectedIndex = props.efforts.findIndex(effort => effort.id === props.selected)
  const heading = selectedIndex < 0 ? 'Provider default' : (props.efforts[selectedIndex]?.name ?? 'Provider default')

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? props.efforts.length - 1 : undefined
    if (step === 0 && edge === undefined) return
    event.preventDefault()
    const next = edge ?? Math.min(props.efforts.length - 1, Math.max(0, index + step))
    const effort = props.efforts[next]
    if (effort === undefined) return
    props.onChange(effort.id)
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <section aria-label="Reasoning effort" className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1.5" data-model-effort>
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-2">
        <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
          <h3 className="dshx:truncate dshx:text-xs dshx:font-medium" id={headingId}>
            Reasoning effort · <span className="dshx:font-normal dshx:text-muted-foreground">{heading}</span>
          </h3>
          <InfoHint description="Higher effort lets the model think for longer before it answers." label="About reasoning effort" />
        </span>
      </div>
      <div
        aria-labelledby={headingId}
        className="dshx:grid dshx:grid-cols-[repeat(auto-fit,minmax(2rem,1fr))] dshx:pointer-coarse:grid-cols-[repeat(auto-fit,minmax(2.75rem,1fr))] dshx:gap-0.5 dshx:rounded-lg dshx:bg-segment-track dshx:p-0.5"
        data-model-effort-options
        ref={group}
        role="radiogroup"
      >
        {props.efforts.map((effort, index) => {
          const checked = index === selectedIndex
          return (
            <button
              aria-checked={checked}
              aria-label={effort.name}
              className={cn(
                'dshx:h-7 dshx:min-w-0 dshx:rounded-md dshx:px-1 dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-11',
                checked && 'dshx:segment-thumb dshx:font-selected dshx:text-foreground',
              )}
              data-model-effort-option
              key={effort.id}
              onClick={() => props.onChange(effort.id)}
              onKeyDown={event => move(event, index)}
              role="radio"
              tabIndex={checked || (selectedIndex < 0 && index === 0) ? 0 : -1}
              type="button"
            >
              {ModelPickerModel.effortShortLabel(effort)}
            </button>
          )
        })}
      </div>
      <div className="dshx:flex dshx:justify-end">
        <button
          aria-pressed={selectedIndex < 0}
          className={cn(
            'dshx:h-7 dshx:shrink-0 dshx:rounded-md dshx:px-1.5 dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-11',
            selectedIndex < 0 && 'dshx:font-selected dshx:text-foreground',
          )}
          data-model-effort-default
          onClick={() => props.onChange(undefined)}
          type="button"
        >
          Provider default
        </button>
      </div>
    </section>
  )
}
