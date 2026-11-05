/**
 * `b:<ref>` is how every surface writes an item (the capture grammar, the mention chip, the tool descriptions), so an
 * Agent's markdown needs no other syntax. A ref is either a legacy number (`b:12`, digits only, items created before
 * short aliases) or a short alias (`b:k3f9`: 4 or 5 lowercase Crockford base32 characters with at least one letter).
 * Digit-only means legacy and anything with a letter means a short alias, so the two never collide.
 *
 * The leading boundary keeps `rb:12` and `/b:12` out, the trailing one keeps `b:12ties` out, and the shapes keep `b:0`,
 * an oversized number or a word with letters Crockford leaves out (`b:todo`) from becoming a link.
 */
const itemReference = /(?<![\w/])b:([0-9A-Za-z]{1,12})(?!\w)/gu

/** The Host's numeric ids are positive 32-bit integers; anything longer could never name an item. */
const MAX_ITEM_ID = 2_147_483_647

/** Crockford base32 in lowercase: no `i`, `l`, `o` or `u`. */
const SHORT_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const shortAlias = /^[0-9a-hjkmnp-tv-z]{4,5}$/
const legacyNumber = /^[1-9]\d*$/

export interface BacklogReferenceMatch {
  /** The normalized ref: `12` or `k3f9`. */
  readonly ref: string
  /** Offset of the leading `b` in the scanned text. */
  readonly start: number
  readonly end: number
}

/**
 * The normalized ref a written token names (with or without its `b:` prefix, any case), or undefined when it cannot
 * name an item.
 */
const parseReference = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined
  const token = raw.trim().replace(/^b:/u, '')
  if (legacyNumber.test(token)) return Number(token) <= MAX_ITEM_ID ? token : undefined
  const lower = token.toLowerCase()
  return shortAlias.test(lower) && /[a-z]/u.test(lower) ? lower : undefined
}

const isLegacy = (ref: string): boolean => legacyNumber.test(ref)

const backlogReferenceMatches = (text: string): readonly BacklogReferenceMatch[] =>
  [...text.matchAll(itemReference)].flatMap(match => {
    const ref = parseReference(match[1])
    if (ref === undefined) return []
    const start = match.index ?? 0
    return [{ ref, start, end: start + match[0].length }]
  })

/** How a rendered reference names the item, for chips, cards, headers and accessible names. */
const backlogReferenceLabel = (ref: string): string => `b:${ref}`

/** The ref an item shows: its short alias, or its number for an item created before short aliases. */
const refOf = (item: { readonly id: number; readonly ref?: string | undefined }): string => item.ref ?? String(item.id)

/**
 * The value a Client sends as an item id: a legacy ref as its number, so a Host that predates short aliases still
 * answers it, and a short alias as its string.
 */
const requestId = (ref: string): number | string => (isLegacy(ref) ? Number(ref) : ref)

export class BacklogReference {
  static readonly parse = parseReference
  static readonly matches = backlogReferenceMatches
  static readonly label = backlogReferenceLabel
  static readonly refOf = refOf
  static readonly labelOf = (item: { readonly id: number; readonly ref?: string | undefined }): string => backlogReferenceLabel(refOf(item))
  static readonly isLegacy = isLegacy
  static readonly requestId = requestId
  static readonly shortAlphabet = SHORT_ALPHABET
  /** The kind backlog registers in input-trigger's entity registry; the shared reference card is keyed by it. */
  static readonly entityKind = 'backlog'
}
