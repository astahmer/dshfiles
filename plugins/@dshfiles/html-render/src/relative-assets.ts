const IMAGE_MEDIA_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['svg', 'image/svg+xml'],
  ['ico', 'image/x-icon'],
  ['bmp', 'image/bmp'],
])

export const RelativeAssetLimits = { maxAssets: 32 } as const

const ASSET_TAG = /<(link|script|img)\b([^>]*)>/gi
const ATTRIBUTE = /([^\s"'<>/=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export type AssetKind = 'stylesheet' | 'script' | 'image'

export interface AssetReader {
  /** Bytes of a path relative to the page, or a reason it cannot be inlined (outside the workspace, missing, too large). */
  read(input: {
    readonly path: string
    readonly kind: AssetKind
    readonly maxBytes: number
  }): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly reason: string }>
}

export interface InlineResult {
  readonly html: string
  readonly inlined: readonly string[]
  readonly skipped: readonly string[]
}

interface Attribute {
  readonly name: string
  readonly value: string
  readonly source: string
}

const attributesOf = (source: string): Attribute[] =>
  [...source.matchAll(ATTRIBUTE)].map(match => ({ name: (match[1] ?? '').toLowerCase(), value: match[3] ?? match[4] ?? match[5] ?? '', source: match[0] }))

/** A same-folder or sub-folder file reference: no scheme, no protocol-relative or root-absolute path, no bare fragment. */
const relativePath = (reference: string): string | undefined => {
  const trimmed = reference.trim()
  if (trimmed === '' || SCHEME.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('\\')) return undefined
  const path = trimmed.split(/[?#]/, 1)[0] ?? ''
  if (path === '') return undefined
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

const assetKind = (tag: string, attributes: readonly Attribute[]): { readonly kind: AssetKind; readonly attribute: Attribute } | undefined => {
  const named = (name: string) => attributes.find(attribute => attribute.name === name)
  if (tag === 'link') {
    const rel = named('rel')?.value.toLowerCase().split(/\s+/) ?? []
    const href = named('href')
    return rel.includes('stylesheet') && href !== undefined ? { kind: 'stylesheet', attribute: href } : undefined
  }
  const src = named('src')
  if (src === undefined) return undefined
  return { kind: tag === 'script' ? 'script' : 'image', attribute: src }
}

const imageMediaType = (path: string): string | undefined => IMAGE_MEDIA_TYPES.get(path.split('.').pop()?.toLowerCase() ?? '')

const utf8 = new TextDecoder('utf-8', { fatal: false })

/** Inline code cannot close the element it lands in. */
const neutralize = (text: string, element: 'style' | 'script'): string => text.replace(new RegExp(`</${element}`, 'gi'), `<\\/${element}`)

const replacement = (input: {
  readonly kind: AssetKind
  readonly tagSource: string
  readonly attribute: Attribute
  readonly path: string
  readonly bytes: Uint8Array
}): string => {
  if (input.kind === 'stylesheet')
    return `<style data-dsh-source="${input.path.replaceAll('"', '&quot;')}">${neutralize(utf8.decode(input.bytes), 'style')}</style>`
  if (input.kind === 'script') return `${input.tagSource.replace(input.attribute.source, '')}${neutralize(utf8.decode(input.bytes), 'script')}`
  const dataUri = `data:${imageMediaType(input.path) ?? 'application/octet-stream'};base64,${Buffer.from(input.bytes).toString('base64')}`
  return input.tagSource.replace(input.attribute.source, `src="${dataUri}"`)
}

/**
 * Inline the page's simple relative references: `<link rel="stylesheet" href>`, `<script src>` and `<img src>`. Anything
 * else (CSS `url()`, `@import`, `srcset`, fonts, fetches, root-absolute or remote URLs) stays as written and is blocked
 * by the card's no-network policy.
 */
const inline = async (input: { readonly html: string; readonly reader: AssetReader; readonly maxBytes: number }): Promise<InlineResult> => {
  const inlined: string[] = []
  const skipped: string[] = []
  let budget = input.maxBytes - Buffer.byteLength(input.html, 'utf8')
  const parts: string[] = []
  let cursor = 0
  for (const match of input.html.matchAll(ASSET_TAG)) {
    const tag = (match[1] ?? '').toLowerCase()
    const asset = assetKind(tag, attributesOf(match[2] ?? ''))
    const path = asset === undefined ? undefined : relativePath(asset.attribute.value)
    if (asset === undefined || path === undefined) continue
    if (asset.kind === 'image' && imageMediaType(path) === undefined) {
      skipped.push(`${path}: not a known image type`)
      continue
    }
    if (inlined.length >= RelativeAssetLimits.maxAssets) {
      skipped.push(`${path}: more than ${String(RelativeAssetLimits.maxAssets)} assets`)
      continue
    }
    const read = await input.reader.read({ path, kind: asset.kind, maxBytes: Math.max(0, budget) })
    if (!read.ok) {
      skipped.push(`${path}: ${read.reason}`)
      continue
    }
    const text = replacement({ kind: asset.kind, tagSource: match[0], attribute: asset.attribute, path, bytes: read.bytes })
    budget -= Buffer.byteLength(text, 'utf8') - Buffer.byteLength(match[0], 'utf8')
    parts.push(input.html.slice(cursor, match.index), text)
    cursor = match.index + match[0].length
    inlined.push(path)
  }
  parts.push(input.html.slice(cursor))
  return { html: parts.join(''), inlined, skipped }
}

export class RelativeAssets {
  static readonly inline = inline
  static readonly relativePath = relativePath
}
