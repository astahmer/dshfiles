import type { Locator } from './reach-model.js'

/** The walk's own overlay (`data-onboarding-walk`): never a target, never evidence. */
const OVERLAY_SELECTOR = '[data-onboarding-walk]'

/**
 * Native elements carrying each implicit role. Selectors are fixed literals: a role from the catalog only picks one of
 * these lists and is compared as a string, never interpolated into a selector.
 */
const IMPLICIT_ROLE_SELECTORS = new Map(
  Object.entries({
    button: 'button, input[type="button"], input[type="submit"], input[type="reset"], input[type="image"], summary',
    link: 'a[href], area[href]',
    textbox:
      'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], textarea, [contenteditable="true"], [contenteditable=""]',
    searchbox: 'input[type="search"]',
    combobox: 'select, input[list]',
    listbox: 'select',
    checkbox: 'input[type="checkbox"]',
    radio: 'input[type="radio"]',
    spinbutton: 'input[type="number"]',
    slider: 'input[type="range"]',
    heading: 'h1, h2, h3, h4, h5, h6',
    img: 'img',
    navigation: 'nav',
    main: 'main',
    dialog: 'dialog',
    list: 'ul, ol',
    listitem: 'li',
    region: 'section',
    table: 'table',
    row: 'tr',
    cell: 'td',
    complementary: 'aside',
    banner: 'header',
    contentinfo: 'footer',
    form: 'form',
    group: 'fieldset, details',
    progressbar: 'progress',
  }),
)

/** Native elements whose tag alone carries a role. */
const TAG_ROLES = new Map(
  Object.entries({
    nav: 'navigation',
    main: 'main',
    dialog: 'dialog',
    ul: 'list',
    ol: 'list',
    li: 'listitem',
    table: 'table',
    tr: 'row',
    td: 'cell',
    aside: 'complementary',
    header: 'banner',
    footer: 'contentinfo',
    form: 'form',
    fieldset: 'group',
    details: 'group',
    progress: 'progressbar',
  }),
)

const TEXT_INPUT_TYPES = new Set(['', 'text', 'email', 'tel', 'url'])

const normalize = (text: string): string => text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase()

/** The role a screen reader announces: an explicit `role`, else the native element's implicit one. */
const roleOf = (element: Element): string | null => {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/u)[0]
  if (explicit !== undefined && explicit !== '') return explicit
  const tag = element.localName
  if (tag === 'button' || tag === 'summary') return 'button'
  if ((tag === 'a' || tag === 'area') && element.hasAttribute('href')) return 'link'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'select') return element.hasAttribute('multiple') || Number(element.getAttribute('size') ?? '0') > 1 ? 'listbox' : 'combobox'
  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? '').toLocaleLowerCase()
    if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button'
    if (type === 'checkbox' || type === 'radio') return type
    if (type === 'search') return element.hasAttribute('list') ? 'combobox' : 'searchbox'
    if (type === 'number') return 'spinbutton'
    if (type === 'range') return 'slider'
    if (TEXT_INPUT_TYPES.has(type)) return element.hasAttribute('list') ? 'combobox' : 'textbox'
    return null
  }
  if (/^h[1-6]$/u.test(tag)) return 'heading'
  if (tag === 'img') return element.getAttribute('alt') === '' ? 'presentation' : 'img'
  const editable = element.getAttribute('contenteditable')
  if (editable === '' || editable === 'true' || editable === 'plaintext-only') return 'textbox'
  if (tag === 'section') return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') ? 'region' : null
  return TAG_ROLES.get(tag) ?? null
}

const isHiddenFromTree = (element: Element): boolean => element.closest('[aria-hidden="true"], [hidden]') !== null

/** Text a screen reader reads from content: hidden subtrees skipped, an image's `alt` and a child's `aria-label` kept. */
const contentText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof Element)) return ''
  if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden')) return ''
  if (node.localName === 'script' || node.localName === 'style') return ''
  if (node.localName === 'img') return node.getAttribute('alt') ?? ''
  const label = node.getAttribute('aria-label')
  if (label !== null && label.trim() !== '') return label
  return Array.from(node.childNodes, child => ` ${contentText(child)} `).join('')
}

const byIds = (element: Element, attribute: string): string | null => {
  const ids = element.getAttribute(attribute)?.trim()
  if (ids === undefined || ids === '') return null
  const text = ids
    .split(/\s+/u)
    .map(id => element.ownerDocument.getElementById(id))
    .filter(referenced => referenced !== null)
    .map(referenced => contentText(referenced))
    .join(' ')
  return text.trim() === '' ? null : text
}

/** `<label for>` and wrapping labels of a form control. */
const labelText = (element: Element): string | null => {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return null
  const labels = Array.from(element.labels ?? [], label => contentText(label)).join(' ')
  return labels.trim() === '' ? null : labels
}

const NAME_FROM_CONTENT = new Set([
  'button',
  'link',
  'tab',
  'option',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'heading',
  'cell',
  'row',
  'treeitem',
  'radio',
  'checkbox',
  'switch',
  'tooltip',
  'columnheader',
  'rowheader',
  'gridcell',
  'listitem',
  'status',
  'note',
])

/** A pragmatic accessible name: `aria-labelledby`, `aria-label`, a `<label>`, content for roles named by it, `alt`, `title`, placeholder. */
const accessibleName = (element: Element): string => {
  const labelledBy = byIds(element, 'aria-labelledby')
  if (labelledBy !== null) return labelledBy
  const label = element.getAttribute('aria-label')
  if (label !== null && label.trim() !== '') return label
  const labels = labelText(element)
  if (labels !== null) return labels
  const role = roleOf(element)
  if (element.localName === 'img' || element.localName === 'area') {
    const alt = element.getAttribute('alt')
    if (alt !== null && alt.trim() !== '') return alt
  }
  if (role !== null && NAME_FROM_CONTENT.has(role)) {
    const content = contentText(element)
    if (content.trim() !== '') return content
  }
  if (element instanceof HTMLInputElement && (element.type === 'button' || element.type === 'submit' || element.type === 'reset') && element.value !== '')
    return element.value
  const title = element.getAttribute('title')
  if (title !== null && title.trim() !== '') return title
  return element.getAttribute('placeholder') ?? element.getAttribute('aria-placeholder') ?? ''
}

/** What `label` locators read: the control's labelling, never its content. */
const labelName = (element: Element): string =>
  byIds(element, 'aria-labelledby') ?? element.getAttribute('aria-label') ?? labelText(element) ?? element.getAttribute('aria-placeholder') ?? ''

const isRendered = (element: Element): boolean => {
  if (element.getClientRects().length === 0) return false
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return style === undefined || (style.visibility !== 'hidden' && style.visibility !== 'collapse')
}

export interface ResolveInput {
  readonly root: Document
  readonly locator: Locator
  /** Defaults to "has a layout box and is not `visibility: hidden`". */
  readonly isVisible?: ((element: Element) => boolean) | undefined
}

interface Candidate {
  readonly element: Element
  readonly name: string
}

const outsideOverlay = (element: Element): boolean => element.closest(OVERLAY_SELECTOR) === null

const roleCandidates = (root: Document, role: string): readonly Candidate[] => {
  const implicit = IMPLICIT_ROLE_SELECTORS.get(role)
  const selector = implicit === undefined ? '[role]' : `[role], ${implicit}`
  return Array.from(root.querySelectorAll(selector))
    .filter(element => roleOf(element) === role && !isHiddenFromTree(element))
    .map(element => ({ element, name: accessibleName(element) }))
}

/** The innermost elements whose own text holds the name, as `getByText` picks them. */
const textCandidates = (root: Document): readonly Candidate[] => {
  const body = root.body
  if (body === null) return []
  const walker = root.createTreeWalker(body, NodeFilter.SHOW_ELEMENT)
  const found: Candidate[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Element) || node.localName === 'script' || node.localName === 'style') continue
    const hasOwnText = Array.from(node.childNodes).some(child => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() !== '')
    if (hasOwnText) found.push({ element: node, name: node.textContent ?? '' })
  }
  return found
}

const labelCandidates = (root: Document): readonly Candidate[] =>
  Array.from(root.querySelectorAll('input, select, textarea, [aria-label], [aria-labelledby], [contenteditable="true"]')).map(element => ({
    element,
    name: labelName(element),
  }))

const titleCandidates = (root: Document): readonly Candidate[] =>
  Array.from(root.querySelectorAll('[title]')).map(element => ({ element, name: element.getAttribute('title') ?? '' }))

const candidatesOf = (root: Document, locator: Locator): readonly Candidate[] => {
  if (locator.kind === 'role') return locator.role === null ? [] : roleCandidates(root, locator.role)
  if (locator.kind === 'text') return textCandidates(root)
  if (locator.kind === 'label') return labelCandidates(root)
  return titleCandidates(root)
}

/**
 * Resolve a catalog locator in the live document the way the grammar writes it: whitespace collapsed, case ignored,
 * an exact name first, then a substring when the step asks for one (`"Settings*"`); among equals the first visible
 * element in document order wins. A plain name never falls back to a substring: `button "Memory"` must not ring
 * `Keep memory across threads`.
 */
const resolve = (input: ResolveInput): Element | null => {
  const wanted = normalize(input.locator.name)
  const visible = input.isVisible ?? isRendered
  const candidates = candidatesOf(input.root, input.locator)
    .filter(candidate => outsideOverlay(candidate.element))
    .map(candidate => ({ element: candidate.element, name: normalize(candidate.name) }))
  const exact = candidates.find(candidate => candidate.name === wanted && visible(candidate.element))
  if (exact !== undefined || input.locator.match === 'exact') return exact?.element ?? null
  return candidates.find(candidate => candidate.name.includes(wanted) && visible(candidate.element))?.element ?? null
}

export class ReachResolver {
  static readonly resolve = resolve
  static readonly roleOf = roleOf
  static readonly accessibleName = accessibleName
  static readonly normalize = normalize
  static readonly isInsideOverlay = (element: Element): boolean => !outsideOverlay(element)
}
