/**
 * `b:<id>` is how every surface writes an item number (the capture grammar, the mention chip, the tool descriptions),
 * so an Agent's markdown needs no other syntax. The leading boundary keeps `rb:12` and `/b:12` out, and the digit
 * shape keeps `b:0` or an oversized number from becoming a link to an item that cannot exist.
 */
const itemReference = /(?<![\w/])b:([1-9]\d*)\b/gu

/** The Host's ids are positive 32-bit integers; anything longer could never name an item. */
const MAX_ITEM_ID = 2_147_483_647

export interface BacklogReferenceMatch {
  readonly id: number
  /** Offset of the leading `b` in the scanned text. */
  readonly start: number
  readonly end: number
}

/** The item number a written `b:<id>` token names, or undefined when it cannot name an item. */
const backlogReferenceId = (raw: string | undefined): number | undefined => {
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_ITEM_ID ? id : undefined
}

const backlogReferenceMatches = (text: string): readonly BacklogReferenceMatch[] =>
  [...text.matchAll(itemReference)].flatMap(match => {
    const id = backlogReferenceId(match[1])
    if (id === undefined) return []
    const start = match.index ?? 0
    return [{ id, start, end: start + match[0].length }]
  })

/** How a rendered reference finds the item it names, for the card's header and accessible name. */
const backlogReferenceLabel = (id: number): string => `b:${String(id)}`

export class BacklogReference {
  static readonly id = backlogReferenceId
  static readonly matches = backlogReferenceMatches
  static readonly label = backlogReferenceLabel
  /** The kind backlog registers in input-trigger's entity registry; the shared reference card is keyed by it. */
  static readonly entityKind = 'backlog'
}
