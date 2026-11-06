/** A gesture the mirror view sends, in page viewport pixels; the same shape the Host replays. */
export type MirrorGesture =
  | { readonly kind: 'click'; readonly x: number; readonly y: number }
  | { readonly kind: 'wheel'; readonly x: number; readonly y: number; readonly deltaY: number }
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'text'; readonly text: string }

/** Keys Playwright presses by name; anything else that is one character is typed as text. */
const NAMED_KEYS = new Set([
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

/**
 * Map a point on the shown frame to the page viewport: the image is scaled to fit the panel, the page is not.
 * @param input - the pointer offset inside the shown image, its shown size and the frame's page size.
 * @returns the page point, rounded and clamped inside the viewport.
 */
const point = (input: {
  readonly offsetX: number
  readonly offsetY: number
  readonly shownWidth: number
  readonly shownHeight: number
  readonly frameWidth: number
  readonly frameHeight: number
}) => {
  const scale = (offset: number, shown: number, frame: number): number =>
    shown <= 0 ? 0 : Math.min(frame - 1, Math.max(0, Math.round((offset / shown) * frame)))
  return { x: scale(input.offsetX, input.shownWidth, input.frameWidth), y: scale(input.offsetY, input.shownHeight, input.frameHeight) }
}

/**
 * The gesture one key press becomes, or undefined for a press the view leaves to the browser (shortcuts, modifiers).
 * @param input - the keyboard event's key and modifier state.
 */
const fromKey = (input: {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
}): MirrorGesture | undefined => {
  if (input.ctrlKey || input.metaKey || input.altKey) return undefined
  if (NAMED_KEYS.has(input.key)) return { kind: 'key', key: input.key }
  if (input.key.length === 1) return { kind: 'text', text: input.key }
  return undefined
}

export class MirrorGestures {
  static readonly point = point
  static readonly fromKey = fromKey
}
