export interface AgentAnchorRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export type AgentAnchorMeasurement =
  | { readonly kind: 'rect'; readonly rect: AgentAnchorRect }
  /** The reference scrolled past the viewport, so the card has nothing to point at. */
  | { readonly kind: 'offscreen' }
  | { readonly kind: 'gone' }

const attribute = 'data-dshfiles-agent-preview-anchor'
let nextAnchor = 1

const idOf = (element: Element): number => {
  const existing = element.getAttribute(attribute)
  const parsed = existing === null ? Number.NaN : Number(existing)
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  element.setAttribute(attribute, String(nextAnchor))
  return nextAnchor++
}

const measure = (anchorId: number, viewportHeight: number): AgentAnchorMeasurement => {
  const element = document.querySelector(`[${attribute}="${String(anchorId)}"]`)
  if (element === null) return { kind: 'gone' }
  const rect = element.getBoundingClientRect()
  if (rect.bottom < 0 || rect.top > viewportHeight) return { kind: 'offscreen' }
  return { kind: 'rect', rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
}

export class AgentAnchorModel {
  static readonly attribute = attribute
  static readonly idOf = idOf
  static readonly measure = measure
}
