import type { MemoryLogger, StreamId, Summarizer } from './types.ts'
import { Utf8 } from './utf8.ts'

const addressHead = /^\s*\d+\+\d+\|\s*/

export type BoundedSummary = { readonly text: string; readonly model: string; readonly clipped: boolean; readonly calls: number }

/**
 * Asks for ≤ maxBytes, verifies, retries with a stricter budget, keeps the shortest answer,
 * and clips deterministically only when every attempt overshoots.
 */
export const boundedSummary = async (request: {
  readonly summarizer: Summarizer
  readonly logger: MemoryLogger
  readonly kind: 'leaf' | 'merge'
  readonly stream: StreamId
  readonly conversationId: string
  readonly address: string
  readonly input: readonly string[]
  readonly maxBytes: number
  readonly retries: number
}): Promise<BoundedSummary> => {
  let shortest: { readonly text: string; readonly model: string } | undefined
  let previousBytes: number | null = null
  let attempts = 0
  for (let attempt = 0; attempt <= request.retries; attempt++) {
    attempts = attempt + 1
    const budget = Math.max(32, Math.floor(request.maxBytes * (1 - 0.2 * attempt)))
    const result = await request.summarizer.summarize({
      kind: request.kind,
      stream: request.stream,
      conversationId: request.conversationId,
      address: request.address,
      maxBytes: budget,
      input: request.input,
      attempt,
      previousBytes,
    })
    const text = result.text.replace(addressHead, '').trim()
    if (text.length === 0) throw new Error(`summarizer returned an empty ${request.kind} summary for ${request.address}`)
    const bytes = Utf8.byteLength(text)
    if (shortest === undefined || bytes < Utf8.byteLength(shortest.text)) shortest = { text, model: result.model }
    if (bytes <= request.maxBytes) return { text, model: result.model, clipped: false, calls: attempts }
    previousBytes = bytes
    // A merge input is already two at-ceiling nodes, so re-asking with a slightly tighter budget cannot produce a
    // faithful fusion; that retry loop measured as over half of all summary calls at depth. Leaf inputs still differ
    // enough in size that a stricter budget genuinely helps, so only merges stop early.
    if (request.kind === 'merge') break
  }
  const best = shortest ?? { text: '', model: 'none' }
  request.logger.warn('optmem summary clipped after retries', {
    stream: request.stream,
    address: request.address,
    bytes: Utf8.byteLength(best.text),
    maxBytes: request.maxBytes,
    calls: attempts,
  })
  return { text: Utf8.clip(best.text, request.maxBytes), model: `clipped:${best.model}`, clipped: true, calls: attempts }
}
