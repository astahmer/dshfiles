/** Where draft annotations point in the rendered transcript, and where their markers and cards sit. */
import type { ComposerAnnotation } from '@dshfiles/dshx/client'
import { SelectionAnnotation } from '../../annotate-selection.ts'
import type { AnnotationMarks } from '../../chat-settings.ts'

export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** One annotation resolved onto the paragraph it quotes. */
export interface AnnotationAnchor {
  readonly annotation: ComposerAnnotation
  /** The paragraph the marker sits beside; its step owns the locator. */
  readonly block: Element
  /** Viewport bounds of that paragraph. */
  readonly bounds: Box
  /** Viewport bounds of the quoted text; the paragraph's own bounds when that text no longer renders. */
  readonly text: Box
  /** The line the marker anchors to: the quote's last line (inline) or the paragraph's first line (gutter). */
  readonly marker: Box
}

const boxOf = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height })
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

/**
 * Resolve every annotation onto its paragraph and quoted-text bounds, dropping the ones the window has not mounted.
 * @param input - the chat column, the draft annotations, and the chosen inline shape.
 * @returns one anchor per rendered annotation, in annotation order.
 */
export const annotationAnchors = (input: {
  readonly container: Element
  readonly annotations: readonly ComposerAnnotation[]
  readonly mode: AnnotationMarks
}): readonly AnnotationAnchor[] => {
  if (input.mode === 'off') return []
  return input.annotations.flatMap((annotation) => {
    const block = SelectionAnnotation.targetOf({ container: input.container, text: annotation.text, source: annotation.source })
    if (block === undefined) return []
    const range = SelectionAnnotation.rangeOf({ block, text: annotation.text })
    const blockBox = boxOf(block.getBoundingClientRect())
    if (range === undefined) return [{ annotation, block, bounds: blockBox, text: blockBox, marker: blockBox }]
    const text = boxOf(range.getBoundingClientRect())
    const lines = [...range.getClientRects()]
    const last = lines.at(-1)
    const marker = input.mode === 'inline' && last !== undefined ? boxOf(last) : blockBox
    return [{ annotation, block, bounds: blockBox, text, marker }]
  })
}

/** Marker size on the transcript, in px. */
export const MARKER_SIZE_PX = 18

export interface MarkerPlacement {
  readonly left: number
  readonly top: number
}

/**
 * Where one annotation marker sits: just past the quoted passage's end in inline shape, just outside the column's
 * right edge in gutter shapes; clamped to the transcript band so the composer never covers it.
 * @param input - the anchor, the shape, the column bounds, the marker size and the usable vertical band.
 * @returns the marker's fixed-position top-left corner.
 */
export const markerPlacement = (input: {
  readonly anchor: AnnotationAnchor
  readonly mode: Exclude<AnnotationMarks, 'off'>
  readonly column: Box
  readonly bound: { readonly top: number; readonly bottom: number }
  readonly windowWidth: number
  readonly size?: number
}): MarkerPlacement => {
  const size = input.size ?? MARKER_SIZE_PX
  const left = input.mode === 'inline'
    ? input.anchor.marker.right + 4
    : Math.min(input.anchor.bounds.right + 10, input.column.right + 6)
  return {
    left: clamp(left, 8, input.windowWidth - size - 8),
    top: clamp(input.anchor.marker.top + 1, input.bound.top + 4, input.bound.bottom - size - 4),
  }
}

/**
 * The comments column's left edge, when the transcript pane leaves room for it beside the quoted paragraphs.
 * @param input - the widest quoted paragraph's right edge, the card width, the pane's right edge and the gap.
 * @returns its fixed-position left edge, or undefined when the column would not fit.
 */
export const columnLeft = (input: {
  readonly contentRight: number
  readonly width: number
  readonly boundRight: number
  readonly gap: number
}): number | undefined => {
  const left = input.contentRight + input.gap
  return left + input.width + 8 <= input.boundRight ? left : undefined
}

/**
 * Vertical positions for the comments column: each card follows its paragraph when it can, pushed below the card
 * above it so comments never overlap, and kept above the composer.
 * @param input - desired tops and measured heights in annotation order, the gap and the usable vertical band.
 * @returns each card's fixed-position top, in input order.
 */
export const stackTops = (input: {
  readonly tops: readonly number[]
  readonly heights: readonly number[]
  readonly gap: number
  readonly bound: { readonly top: number; readonly bottom: number }
}): readonly number[] => {
  const order = input.tops.map((top, index) => ({ top, index })).sort((a, b) => a.top - b.top)
  const placed = new Map<number, number>()
  let previousBottom = input.bound.top + 4
  for (const entry of order) {
    const height = input.heights[entry.index] ?? 0
    const top = clamp(Math.max(entry.top, previousBottom), input.bound.top + 4, input.bound.bottom - height - 4)
    placed.set(entry.index, top)
    previousBottom = top + height + input.gap
  }
  return input.tops.map((_top, index) => placed.get(index) ?? input.bound.top + 4)
}
