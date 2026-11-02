import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { Option, Schema } from 'effect'

type ResponseHeaders = Readonly<Record<string, string>>

const decodeNumber = Schema.decodeUnknownOption(Schema.NumberFromString)
const seconds = (value: string): Option.Option<number> => Option.filter(decodeNumber(value), Number.isFinite)

/** `retry-after-ms`, then `retry-after` in seconds or as an HTTP date; undefined when absent or not in the future. */
const fromHeaders = (headers: ResponseHeaders, now: number): number | undefined => {
  const header = (name: string): string | undefined => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
  const millisHeader = header('retry-after-ms')
  const millis = millisHeader === undefined ? undefined : Option.getOrUndefined(seconds(millisHeader.trim()))
  const delay = millis ?? retryAfterMs(header('retry-after'), now)
  return delay !== undefined && Number.isFinite(delay) && delay > 0 ? Math.ceil(delay) : undefined
}

const retryAfterMs = (value: string | undefined, now: number): number | undefined => {
  if (value === undefined || value.trim() === '') return undefined
  const delaySeconds = Option.getOrUndefined(seconds(value.trim()))
  if (delaySeconds !== undefined) return delaySeconds * 1_000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : date - now
}

/**
 * The delay each account route's provider declared on its last rejected HTTP response. pi-ai reads the response
 * through `onResponse` but drops `Retry-After` from the failure it reports, so the adapter puts it back on the
 * failed finish chunk; without it a rate limit with no sibling account always waited the full policy delay.
 */
export class DeclaredRetryAfter {
  private readonly declared = new Map<string, number>()

  /** Remember the delay of a rejected response on `provider`; successful responses declare nothing. */
  readonly observe = (provider: string, response: { readonly status: number; readonly headers: ResponseHeaders }, now: number): void => {
    if (response.status < 400) return
    const delay = fromHeaders(response.headers, now)
    if (delay !== undefined) this.declared.set(provider, delay)
  }

  /** A new attempt starts with no delay inherited from an earlier one on the same route. */
  readonly forget = (provider: string): void => {
    this.declared.delete(provider)
  }

  /** Put the declared delay on a failed finish that names none, consuming it. */
  readonly attach = async function* (this: DeclaredRetryAfter, provider: string, chunks: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    for await (const chunk of chunks) {
      const declared = this.declared.get(provider)
      if (chunk.type !== 'finish' || chunk.reason.kind !== 'error' || chunk.reason.failure.providerRetryAfterMs !== undefined || declared === undefined) {
        yield chunk
        continue
      }
      this.declared.delete(provider)
      yield { ...chunk, reason: { ...chunk.reason, failure: { ...chunk.reason.failure, providerRetryAfterMs: declared } } }
    }
  }
}
