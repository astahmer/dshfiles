import { annotationTargetSchema, MAX_SELECTOR_CHARS, type AnnotationSurface, type AnnotationTarget } from './schema.js'
import { AnnotationRedaction } from './redact.js'

const MAX_PATH_DEPTH = 4
const MAX_CLASSES_PER_LEVEL = 2
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/

const escapeCss = (value: string): string => {
  const css: { readonly escape?: (text: string) => string } | undefined = globalThis.CSS
  if (css?.escape !== undefined) return css.escape(value)
  return value.replace(/([^A-Za-z0-9_-])/g, '\\$1')
}

const safeClass = (name: string): string | undefined => {
  const trimmed = name.slice(0, 60)
  if (trimmed.length === 0) return undefined
  const escaped = escapeCss(trimmed)
  return escaped.length === 0 ? undefined : escaped
}

const segment = (element: Element): string => {
  const tag = element.tagName.toLowerCase()
  const classes = Array.from(element.classList)
    .slice(0, MAX_CLASSES_PER_LEVEL)
    .map(safeClass)
    .filter((name): name is string => name !== undefined)
  return classes.length === 0 ? tag : `${tag}.${classes.join('.')}`
}

const elementSelector = (element: Element): string => {
  const own = element.getAttribute('id')
  if (own !== null && SAFE_IDENTIFIER.test(own)) return `#${own}`
  const body = element.ownerDocument.body
  const parts: string[] = []
  let current: Element | null = element
  let depth = 0
  while (current !== null && current !== body && depth < MAX_PATH_DEPTH) {
    const id = current.getAttribute('id')
    if (id !== null && SAFE_IDENTIFIER.test(id)) {
      parts.unshift(`#${id}`)
      break
    }
    parts.unshift(segment(current))
    current = current.parentElement
    depth += 1
  }
  const joined = parts.join(' > ')
  return (joined.length === 0 ? element.tagName.toLowerCase() : joined).slice(0, MAX_SELECTOR_CHARS)
}

const MAX_BUBBLE_DEPTH = 6
const INTERACTIVE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary, label'
const DECORATION = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'use', 'img', 'picture', 'source', 'br'])

/**
 * The element a pick should describe: a form field or contenteditable is walked up to
 * its nearest capturable container, because a note about a control belongs to the
 * surface around it. A private subtree is refused outright — never bubbled past.
 */
const pickableElement = (element: Element): Element | null => {
  if (AnnotationRedaction.privateAncestor(element) !== undefined) return null
  const interactive = element.closest(INTERACTIVE)
  if (interactive !== null && AnnotationRedaction.privateAncestor(interactive) === undefined && !AnnotationRedaction.sensitiveField(interactive))
    return interactive
  let current: Element | null = element
  for (let depth = 0; current !== null && depth < MAX_BUBBLE_DEPTH; depth += 1) {
    if (!AnnotationRedaction.sensitiveField(current) && !DECORATION.has(current.tagName.toLowerCase())) return current
    current = current.parentElement
  }
  return null
}

const describeTarget = ({
  element,
  surface,
  url,
}: {
  readonly element: Element
  readonly surface: AnnotationSurface
  readonly url: string
}): AnnotationTarget | null => {
  if (AnnotationRedaction.privateAncestor(element) !== undefined) return null
  if (AnnotationRedaction.sensitiveField(element)) return null
  const rect = element.getBoundingClientRect()
  const target: AnnotationTarget = {
    surface,
    url: AnnotationRedaction.redactUrl(url),
    selector: elementSelector(element),
    tag: element.tagName.toLowerCase(),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
  }
  const text = AnnotationRedaction.elementText(element)
  const attributes = AnnotationRedaction.safeAttributes(element)
  const styles = AnnotationRedaction.safeStyles(element)
  if (text !== undefined) target.text = text
  if (attributes !== undefined) target.attributes = attributes
  if (styles !== undefined) target.styles = styles
  const parsed = annotationTargetSchema.safeParse(target)
  return parsed.success ? parsed.data : null
}

const matchesTarget = ({ element, target }: { readonly element: Element; readonly target: AnnotationTarget }): boolean => {
  if (element.tagName.toLowerCase() !== target.tag) return false
  if (target.text === undefined) return true
  const current = AnnotationRedaction.elementText(element)
  return current !== undefined && current.startsWith(target.text.slice(0, 24))
}

export class ElementDescriptor {
  static readonly elementSelector = elementSelector
  static readonly pickableElement = pickableElement
  static readonly describeTarget = describeTarget
  static readonly matchesTarget = matchesTarget
}
