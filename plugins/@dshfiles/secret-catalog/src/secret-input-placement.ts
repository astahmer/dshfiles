export interface ViewportBounds {
  readonly width: number
  readonly height: number
}

export interface AnchorBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface PanelBounds {
  readonly width: number
  readonly height: number
}

export interface PanelPlacement {
  readonly side: 'top' | 'bottom'
  readonly left: number
  readonly top: number
  readonly maxHeight: number
}

export interface ButtonPlacement {
  readonly left: number
  readonly top: number
}

const margin = 8
const gap = 6
const buttonSize = 24
const minimumPanelHeight = 120

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

/**
 * Keeps the alias panel inside the viewport: it opens below the field, flips above when that side has more room, and
 * caps its height to the room left on the chosen side, so the list scrolls instead of leaving the screen.
 */
export const placeSecretPanel = (props: { readonly anchor: AnchorBounds; readonly panel: PanelBounds; readonly viewport: ViewportBounds }): PanelPlacement => {
  const width = Math.min(props.panel.width, Math.max(0, props.viewport.width - margin * 2))
  const left = clamp(props.anchor.right - width, margin, props.viewport.width - margin - width)
  const below = props.viewport.height - margin - props.anchor.bottom - gap
  const above = props.anchor.top - margin - gap
  const fitsBelow = below >= props.panel.height
  const fitsAbove = above >= props.panel.height
  const side = fitsBelow ? 'bottom' : fitsAbove ? 'top' : below >= above ? 'bottom' : 'top'
  const maxHeight = Math.max(0, side === 'bottom' ? below : above)
  // A field can fill nearly the whole viewport. Then no side has usable room, so the panel covers it from the top
  // instead of collapsing to a sliver.
  if (maxHeight < minimumPanelHeight) return { side, left, top: margin, maxHeight: Math.max(0, props.viewport.height - margin * 2) }
  const top =
    side === 'bottom'
      ? props.anchor.bottom + gap
      : clamp(
          props.anchor.top - gap - Math.min(props.panel.height, maxHeight),
          margin,
          props.viewport.height - margin - Math.min(props.panel.height, maxHeight),
        )
  return { side, left, top, maxHeight }
}

/** The key button rides on the field's right edge and stays on screen even when the field is partly scrolled out. */
export const placeSecretButton = (props: { readonly anchor: AnchorBounds; readonly viewport: ViewportBounds }): ButtonPlacement => ({
  left: clamp(props.anchor.right - buttonSize - gap, margin, props.viewport.width - margin - buttonSize),
  top: clamp(props.anchor.top + (props.anchor.bottom - props.anchor.top - buttonSize) / 2, margin, props.viewport.height - margin - buttonSize),
})
