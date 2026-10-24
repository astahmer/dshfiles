/** The canonical spelling of one Backlog mention in a sent message, and the parser that reads it back. */
import { z } from 'zod'

import { BacklogReference } from './backlog-reference.js'

const SUFFIX = ' (backlog item; backlog_get has its details)'
const titleSchema = z.string()

/** A serialized mention, or a bare item number written in prose. */
export interface BacklogMentionMatch {
  readonly id: number
  readonly title: string | null
  /** Offset of the leading `b` in the scanned text. */
  readonly start: number
  readonly end: number
}

const itemReference = /b:([1-9]\d*)(?![\w])/uy
const quotedTitle = / ("(?:[^"\\]|\\.)*")/uy

/** A word, slash or another colon before the token means the writer did not mean an item number. */
const opensReference = (text: string, start: number): boolean => start === 0 || !/[\w/]/u.test(text.charAt(start - 1))

const titleOf = (quoted: string | undefined): string | null => {
  if (quoted === undefined) return null
  try {
    const parsed = titleSchema.safeParse(JSON.parse(quoted))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The full serialized mention the composer sends; the Agent reads the id, the title and where to learn more. */
export const formatBacklogMention = (value: { readonly id: number; readonly title: string }): string =>
  `b:${String(value.id)} ${JSON.stringify(value.title)}${SUFFIX}`

/**
 * The nearest mention at or after `from`, including the serialized title when this is exactly what the composer wrote.
 * A suffix that is not our serialization stays visible, so only the `b:<id>` token becomes a chip.
 */
export const nextBacklogMention = (text: string, from: number): BacklogMentionMatch | undefined => {
  for (let start = text.indexOf('b:', from); start >= 0; start = text.indexOf('b:', start + 1)) {
    if (!opensReference(text, start)) continue
    itemReference.lastIndex = start
    const match = itemReference.exec(text)
    if (match === null) continue
    const id = BacklogReference.id(match[1])
    if (id === undefined) continue
    const tokenEnd = start + match[0].length
    quotedTitle.lastIndex = tokenEnd
    const quoted = quotedTitle.exec(text)
    if (quoted === null) return { id, title: null, start, end: tokenEnd }
    const title = titleOf(quoted[1])
    const tail = tokenEnd + quoted[0].length
    if (title === null || !text.startsWith(SUFFIX, tail)) return { id, title: null, start, end: tokenEnd }
    return { id, title, start, end: tail + SUFFIX.length }
  }
  return undefined
}
