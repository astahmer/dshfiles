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
  readonly address: string
  readonly input: readonly string[]
  readonly maxBytes: number
  readonly retries: number
}): Promise<BoundedSummary> => {
  let shortest: string | undefined
  let previousBytes: number | null = null
  for (let attempt = 0; attempt <= request.retries; attempt++) {
    const budget = Math.max(32, Math.floor(request.maxBytes * (1 - 0.2 * attempt)))
    const raw = await request.summarizer.summarize({
      kind: request.kind,
      stream: request.stream,
      address: request.address,
      maxBytes: budget,
      input: request.input,
      attempt,
      previousBytes,
    })
    const text = raw.replace(addressHead, '').trim()
    if (text.length === 0) throw new Error(`summarizer returned an empty ${request.kind} summary for ${request.address}`)
    const bytes = Utf8.byteLength(text)
    if (shortest === undefined || bytes < Utf8.byteLength(shortest)) shortest = text
    if (bytes <= request.maxBytes) return { text, model: request.summarizer.model, clipped: false, calls: attempt + 1 }
    previousBytes = bytes
  }
  const best = shortest ?? ''
  request.logger.warn('optmem summary clipped after retries', {
    stream: request.stream,
    address: request.address,
    bytes: Utf8.byteLength(best),
    maxBytes: request.maxBytes,
  })
  return { text: Utf8.clip(best, request.maxBytes), model: `clipped:${request.summarizer.model}`, clipped: true, calls: request.retries + 1 }
}
