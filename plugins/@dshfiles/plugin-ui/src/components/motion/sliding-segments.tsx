import * as React from 'react'
import { animate, motionSafe, springs } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'

export interface SlidingSegmentOption<V extends string> {
  readonly value: V
  readonly label: React.ReactNode
  readonly icon?: React.ReactNode
  /** Accessible name when `label` is visual only. */
  readonly ariaLabel?: string
}

export interface SlidingSegmentsProps<V extends string> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  readonly options: readonly SlidingSegmentOption<V>[]
  readonly value: V
  readonly onValueChange: (value: V) => void
  readonly 'aria-label': string
  readonly size?: 'sm' | 'default'
}

/**
 * A segmented control whose selection pill glides (snappy spring) to the chosen segment instead of jumping. Filters,
 * Cost/Tokens toggles, Staging/Production switches. Arrow keys move the selection; it is a radio group to assistive tech.
 */
export function SlidingSegments<V extends string>({ options, value, onValueChange, size = 'default', className, ...props }: SlidingSegmentsProps<V>) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const pillRef = React.useRef<HTMLSpanElement>(null)
  const buttons = React.useRef(new Map<V, HTMLButtonElement>())
  const placed = React.useRef(false)

  const place = React.useCallback(
    (animated: boolean) => {
      const pill = pillRef.current
      const button = buttons.current.get(value)
      if (pill == null || button == null) return null
      const left = `${button.offsetLeft}px`
      const width = `${button.offsetWidth}px`
      if (!animated || !placed.current) {
        pill.style.left = left
        pill.style.width = width
        placed.current = true
        return null
      }
      return animate(pill, { left, width }, motionSafe(springs.snappy))
    },
    [value],
  )

  React.useLayoutEffect(() => {
    const controls = place(true)
    return () => controls?.stop()
  }, [place, options.length])

  React.useEffect(() => {
    const root = rootRef.current
    if (root == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => place(false))
    observer.observe(root)
    return () => observer.disconnect()
  }, [place])

  const move = (delta: number) => {
    const index = options.findIndex(option => option.value === value)
    const next = options[(index + delta + options.length) % options.length]
    if (next === undefined) return
    onValueChange(next.value)
    buttons.current.get(next.value)?.focus()
  }

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      className={cn('dshx:relative dshx:inline-flex dshx:w-fit dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:bg-muted dshx:p-0.5', className)}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        }
      }}
      {...props}
    >
      <span
        ref={pillRef}
        aria-hidden
        className="dshx:pointer-events-none dshx:absolute dshx:top-0.5 dshx:bottom-0.5 dshx:left-0 dshx:rounded-[5px] dshx:bg-background dshx:shadow-xs dshx:ring-1 dshx:ring-border"
      />
      {options.map(option => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={element => {
              if (element) buttons.current.set(option.value, element)
              else buttons.current.delete(option.value)
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            tabIndex={checked ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'dshx:relative dshx:z-10 dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:justify-center dshx:gap-1.5 dshx:rounded-[5px] dshx:font-medium dshx:whitespace-nowrap dshx:text-muted-foreground dshx:transition-colors dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:aria-checked:text-foreground dshx:[&_svg]:size-3.5 dshx:[&_svg]:shrink-0',
              size === 'sm' ? 'dshx:h-6 dshx:px-2 dshx:text-xs' : 'dshx:h-7 dshx:px-3 dshx:text-sm',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
