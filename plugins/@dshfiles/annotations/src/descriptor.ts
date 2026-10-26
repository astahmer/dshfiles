import { annotationTargetSchema, MAX_SELECTOR_CHARS, type AnnotationSurface, type AnnotationTarget } from './schema.js'
import { elementText, privateAncestor, redactUrl, safeAttributes, safeStyles, sensitiveField } from './redact.js'

const MAX_PATH_DEPTH = 4
const MAX_CLASSES_PER_LEVEL = 2
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/

const escapeCss = (value: string): string => {
  const css = Reflect.get(globalThis, 'CSS')
  if (typeof css === 'object' && css !== null && 'escape' in css && typeof css.escape === 'function') return css.escape(value)
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

export const elementSelector = (element: Element): string => {
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
export const pickableElement = (element: Element): Element | null => {
  if (privateAncestor(element) !== undefined) return null
  const interactive = element.closest(INTERACTIVE)
  if (interactive !== null && privateAncestor(interactive) === undefined && !sensitiveField(interactive)) return interactive
  let current: Element | null = element
  for (let depth = 0; current !== null && depth < MAX_BUBBLE_DEPTH; depth += 1) {
    if (!sensitiveField(current) && !DECORATION.has(current.tagName.toLowerCase())) return current
    current = current.parentElement
  }
  return null
}

export const describeTarget = ({
  element,
  surface,
  url,
}: {
  readonly element: Element
  readonly surface: AnnotationSurface
  readonly url: string
}): AnnotationTarget | null => {
  if (privateAncestor(element) !== undefined) return null
  if (sensitiveField(element)) return null
  const rect = element.getBoundingClientRect()
  const target: AnnotationTarget = {
    surface,
    url: redactUrl(url),
    selector: elementSelector(element),
    tag: element.tagName.toLowerCase(),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
  }
  const text = elementText(element)
  const attributes = safeAttributes(element)
  const styles = safeStyles(element)
  const parsed = annotationTargetSchema.safeParse({
    ...target,
    ...(text === undefined ? {} : { text }),
    ...(attributes === undefined ? {} : { attributes }),
    ...(styles === undefined ? {} : { styles }),
  })
  return parsed.success ? parsed.data : null
}

export const matchesTarget = ({ element, target }: { readonly element: Element; readonly target: AnnotationTarget }): boolean => {
  if (element.tagName.toLowerCase() !== target.tag) return false
  if (target.text === undefined) return true
  const current = elementText(element)
  return current !== undefined && current.startsWith(target.text.slice(0, 24))
}
