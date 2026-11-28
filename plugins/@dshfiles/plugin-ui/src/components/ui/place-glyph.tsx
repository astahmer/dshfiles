import * as React from 'react'
import { cn } from '../../lib/utils.js'

/** The places that carry a navigation tone (`--dshx-nav-tone-<id>`, color-roles.css). */
export type PlaceTone = 'threads' | 'inbox' | 'land' | 'work' | 'agents' | 'observe' | 'knowledge' | 'settings'

/** The `nav-tone-<id>` class of each place, as complete strings so Tailwind sees them. */
export const PLACE_TONE_CLASS = {
  threads: 'dshx:nav-tone-threads',
  inbox: 'dshx:nav-tone-inbox',
  land: 'dshx:nav-tone-land',
  work: 'dshx:nav-tone-work',
  agents: 'dshx:nav-tone-agents',
  observe: 'dshx:nav-tone-observe',
  knowledge: 'dshx:nav-tone-knowledge',
  settings: 'dshx:nav-tone-settings',
} as const satisfies Record<PlaceTone, string>

/** The inline style that gives an element any CSS colour as its place tone: a Settings group's identity tone, say. */
export const placeToneStyle = (color: string): React.CSSProperties & Record<'--dshx-nav-tone', string> => ({ '--dshx-nav-tone': color })

export interface PlaceGlyphProps extends Omit<React.ComponentPropsWithoutRef<'span'>, 'color'> {
  /** A navigation place's tone. */
  readonly tone?: PlaceTone | undefined
  /** Any CSS colour as the tone (`var(--dshx-identity-7)`, a Settings group's mix); wins over `tone`. */
  readonly toneColor?: string | undefined
  /**
   * `true` shows the tile, `false` never does; leave it out to follow the row or tab around the seat (`aria-current`,
   * `aria-selected="true"`, Dockview's `.dv-active-tab`).
   */
  readonly selected?: boolean | undefined
  /** `default`: a 24px seat for a 16px glyph (rows, tabs); `lg`: a 28px seat for an 18px glyph. */
  readonly size?: 'default' | 'lg' | undefined
}

/**
 * A place's glyph seat (DESIGN.md › Colour roles, the selected-place tile; council round 9 A1): the glyph in the place's
 * tone and, while the place is selected, the 14% tile of that tone behind it, as on the rail. Decorative: the row or tab
 * beside it carries the name. The seat keeps its size either way, so selecting a row never shifts it.
 */
export const PlaceGlyph = React.forwardRef<HTMLSpanElement, PlaceGlyphProps>(function PlaceGlyph(
  { tone, toneColor, selected, size = 'default', className, style, children, ...props },
  ref,
) {
  const custom = toneColor !== undefined && toneColor.length > 0
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="place-glyph"
      data-size={size}
      data-selected={selected === undefined ? undefined : String(selected)}
      className={cn(
        'dshx:place-seat dshx:rounded-md',
        size === 'lg' ? 'dshx:size-7 dshx:[&_svg]:size-4.5' : 'dshx:size-6 dshx:[&_svg]:size-4',
        custom || tone === undefined ? undefined : PLACE_TONE_CLASS[tone],
        className,
      )}
      style={custom ? { ...style, ...placeToneStyle(toneColor) } : style}
      {...props}
    >
      {children}
    </span>
  )
})
