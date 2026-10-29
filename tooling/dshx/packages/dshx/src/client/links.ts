import { BrowserBroker } from './broker.js'

/** A link a `LinkHandler` claimed: `jj:main` arrives as `{ scheme: 'jj', target: 'main' }`. */
export interface LinkTarget {
  /** The link as written, `scheme:target`. */
  readonly href: string
  readonly scheme: string
  readonly target: string
}

/** Opens links of one custom scheme written in Markdown (`[main](jj:main)`, `<jj:main>`) or passed to `system.openLink`. */
export interface LinkHandlerItem {
  readonly id: string
  /** Lowercase scheme without the colon; `jj` claims `jj:main`. The first handler added for a scheme wins. */
  readonly scheme: string
  open(link: LinkTarget): void
}

export const LinkHandler = BrowserBroker.defineRegistry<LinkHandlerItem>('dshx.link-handler')

const SCHEME = /^[a-z][a-z0-9+.-]{0,31}$/u
// Schemes the Host renders or refuses itself; a plugin must not take them over.
const RESERVED_SCHEMES = new Set(['http', 'https', 'mailto', 'file', 'javascript', 'data', 'vbscript', 'blob', 'about'])

// The Host Markdown renderer keeps only http(s) and mailto hrefs, so a claimed link travels as a URL on this
// reserved, never-resolving origin and turns back into `scheme:target` when it is opened.
const ORIGIN = 'https://dshx-link.invalid'

const claimable = (scheme: string): boolean => SCHEME.test(scheme) && !RESERVED_SCHEMES.has(scheme)

const handlers = (): ReadonlyMap<string, LinkHandlerItem> => {
  const byScheme = new Map<string, LinkHandlerItem>()
  for (const item of BrowserBroker.items(LinkHandler).get()) {
    if (!claimable(item.scheme) || byScheme.has(item.scheme)) continue
    byScheme.set(item.scheme, item)
  }
  return byScheme
}

const parse = (href: string): LinkTarget | undefined => {
  if (href.startsWith(`${ORIGIN}/`)) {
    const rest = href.slice(ORIGIN.length + 1)
    const slash = rest.indexOf('/')
    if (slash <= 0) return undefined
    const scheme = rest.slice(0, slash)
    try {
      const target = decodeURIComponent(rest.slice(slash + 1))
      return SCHEME.test(scheme) ? { href: `${scheme}:${target}`, scheme, target } : undefined
    } catch {
      return undefined
    }
  }
  const colon = href.indexOf(':')
  const scheme = href.slice(0, colon).toLowerCase()
  if (colon <= 0 || !SCHEME.test(scheme)) return undefined
  return { href, scheme, target: href.slice(colon + 1) }
}

const linkUrl = (scheme: string, target: string): string => `${ORIGIN}/${scheme}/${encodeURIComponent(target)}`

const INLINE_DESTINATION = /\]\((\s*)<?([A-Za-z][A-Za-z0-9+.-]*):([^\s()<>]+)>?/gu
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]*):([^\s<>]+)>/gu
const FENCE = /^ {0,3}(`{3,}|~{3,})/u
const CODE_SPAN = /(`+)[\s\S]*?[^`]\1(?!`)/gu

const rewriteProse = (text: string, claimed: ReadonlySet<string>): string =>
  text
    .replace(INLINE_DESTINATION, (written, space: string, scheme: string, target: string) =>
      claimed.has(scheme.toLowerCase()) ? `](${space}${linkUrl(scheme.toLowerCase(), target)}` : written,
    )
    .replace(AUTOLINK, (written, scheme: string, target: string) =>
      claimed.has(scheme.toLowerCase()) ? `[${`${scheme}:${target}`.replace(/[[\]\\]/gu, '\\$&')}](${linkUrl(scheme.toLowerCase(), target)})` : written,
    )

const rewriteOutsideCodeSpans = (text: string, claimed: ReadonlySet<string>): string => {
  let result = ''
  let last = 0
  for (const span of text.matchAll(CODE_SPAN)) {
    result += rewriteProse(text.slice(last, span.index), claimed) + span[0]
    last = span.index + span[0].length
  }
  return result + rewriteProse(text.slice(last), claimed)
}

/**
 * Rewrite links to claimed schemes so the Host Markdown renderer keeps them as anchors; code spans and fenced
 * blocks stay as written. Pass the result to `MarkdownText` and route its `openExternalLink` through `open`.
 */
const rewrite = (text: string, schemes: Iterable<string> = handlers().keys()): string => {
  const claimed = new Set([...schemes].filter(claimable))
  if (claimed.size === 0 || !text.includes(':')) return text
  const lines = text.split('\n')
  const output: string[] = []
  let prose: string[] = []
  let fence: string | undefined
  const flushProse = (): void => {
    if (prose.length > 0) output.push(rewriteOutsideCodeSpans(prose.join('\n'), claimed))
    prose = []
  }
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1]
    if (fence !== undefined) {
      output.push(line)
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
      continue
    }
    if (marker !== undefined) {
      flushProse()
      output.push(line)
      fence = marker
      continue
    }
    prose.push(line)
  }
  flushProse()
  return output.join('\n')
}

/** Run the handler that claims this link (`jj:main`, or a rewritten Markdown href); false when none does. */
const open = (href: string): boolean => {
  const link = parse(href)
  if (link === undefined) return false
  const handler = handlers().get(link.scheme)
  if (handler === undefined) return false
  try {
    handler.open(link)
  } catch (error) {
    console.error(`dshx: link handler ${handler.id} failed`, error)
  }
  return true
}

/** True for an href `rewrite` produced, so a click handler can keep a modified click from opening it as a page. */
const isRewritten = (href: string): boolean => href.startsWith(`${ORIGIN}/`)

/**
 * A click-capture handler for a Markdown root: a plain, modified or middle click on a rewritten link opens its
 * handler instead of the placeholder URL. Capture runs before the Host anchor's own handler.
 */
const openFromClick = (event: { readonly target: EventTarget | null; preventDefault(): void; stopPropagation(): void }): void => {
  if (typeof Element === 'undefined' || !(event.target instanceof Element)) return
  const href = event.target.closest('a[href]')?.getAttribute('href')
  if (href === null || href === undefined || !isRewritten(href)) return
  event.preventDefault()
  event.stopPropagation()
  open(href)
}

export class MarkdownLinks {
  static readonly rewrite = rewrite
  static readonly open = open
  static readonly isRewritten = isRewritten
  static readonly openFromClick = openFromClick
  /** Schemes with a live handler; read it with `useRegistry(LinkHandler)` to follow changes. */
  static readonly schemes = (): readonly string[] => [...handlers().keys()]
}
