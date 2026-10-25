import { MAX_ATTRIBUTE_CHARS, MAX_ATTRIBUTES, MAX_STYLES, MAX_TEXT_CHARS, MAX_URL_CHARS } from './schema.js'

export const SAFE_ATTRIBUTE_KEYS: readonly string[] = [
  'data-testid',
  'data-test',
  'data-qa',
  'data-cy',
  'data-component',
  'role',
  'aria-label',
  'aria-describedby',
]

export const SAFE_STYLE_KEYS: readonly string[] = [
  'display',
  'position',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'margin',
  'padding',
  'border-radius',
  'gap',
  'z-index',
  'overflow',
  'flex-direction',
  'align-items',
  'justify-content',
  'width',
]

export const PRIVATE_ATTRIBUTES: readonly string[] = ['data-private', 'data-visual-edit-private']

const MAX_ANCESTOR_WALK = 16

export const redactUrl = (raw: string): string => {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol.slice(0, MAX_URL_CHARS)
    return `${url.origin}${url.pathname}`.slice(0, MAX_URL_CHARS)
  } catch {
    return ''
  }
}

export const collapseText = (raw: string | null | undefined): string | undefined => {
  if (raw === null || raw === undefined) return undefined
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return undefined
  return collapsed.slice(0, MAX_TEXT_CHARS)
}

const attributeOf = (element: Element, name: string): string | undefined => {
  const value = element.getAttribute(name)
  if (value === null) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.slice(0, MAX_ATTRIBUTE_CHARS)
}

export const privateAncestor = (element: Element): Element | undefined => {
  let current: Element | null = element
  let depth = 0
  while (current !== null && depth < MAX_ANCESTOR_WALK) {
    if (PRIVATE_ATTRIBUTES.some(name => current?.hasAttribute(name) === true)) return current
    current = current.parentElement
    depth += 1
  }
  return undefined
}

const SENSITIVE_TAGS = new Set(['input', 'textarea', 'select', 'option'])
const SENSITIVE_EDITABLE = new Set(['true', 'plaintext-only', ''])

export const sensitiveField = (element: Element): boolean => {
  const tag = element.tagName.toLowerCase()
  if (SENSITIVE_TAGS.has(tag)) return true
  const editable = element.getAttribute('contenteditable')
  return editable !== null && SENSITIVE_EDITABLE.has(editable.trim().toLowerCase())
}

export const safeAttributes = (element: Element): Record<string, string> | undefined => {
  const captured: Record<string, string> = {}
  for (const name of SAFE_ATTRIBUTE_KEYS) {
    const value = attributeOf(element, name)
    if (value !== undefined) captured[name] = value
    if (Object.keys(captured).length >= MAX_ATTRIBUTES) break
  }
  return Object.keys(captured).length === 0 ? undefined : captured
}

export const safeStyles = (element: Element): Record<string, string> | undefined => {
  const view = element.ownerDocument.defaultView
  if (view === null) return undefined
  let computed: CSSStyleDeclaration
  try {
    computed = view.getComputedStyle(element)
  } catch {
    return undefined
  }
  const captured: Record<string, string> = {}
  for (const name of SAFE_STYLE_KEYS) {
    const value = computed.getPropertyValue(name).trim()
    if (value.length === 0) continue
    captured[name] = value.slice(0, 120)
    if (Object.keys(captured).length >= MAX_STYLES) break
  }
  return Object.keys(captured).length === 0 ? undefined : captured
}

/**
 * The accessible name first: a control's text content changes with its state (a count
 * badge, a spinner), while its label is the stable way to find it again.
 */
export const elementText = (element: Element): string | undefined =>
  collapseText(element.getAttribute('aria-label')) ?? collapseText(element.getAttribute('title')) ?? collapseText(element.textContent)
