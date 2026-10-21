import { z } from 'zod'

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

export const backlogReferenceMatches = (text: string): readonly BacklogReferenceMatch[] =>
  [...text.matchAll(itemReference)].flatMap(match => {
    const id = Number(match[1])
    if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_ITEM_ID) return []
    const start = match.index ?? 0
    return [{ id, start, end: start + match[0].length }]
  })

const coordinate = z.number().finite().min(-100_000).max(100_000)

export const backlogReferencePreviewEvent = 'dshfiles:backlog-reference-preview'

export const backlogReferencePreviewRequestSchema = z
  .object({
    id: z.number().int().positive().max(MAX_ITEM_ID),
    /** The decorated element the card follows: it re-measures this anchor instead of closing when the page scrolls. */
    anchorId: z.number().int().positive(),
    anchor: z
      .object({
        left: coordinate,
        top: coordinate,
        width: z.number().finite().min(0).max(100_000),
        height: z.number().finite().min(0).max(100_000),
      })
      .strict(),
  })
  .strict()

export type BacklogReferencePreviewRequest = z.infer<typeof backlogReferencePreviewRequestSchema>

/** How a rendered reference finds the item it names, for the card's header and accessible name. */
export const backlogReferenceLabel = (id: number): string => `b:${String(id)}`
