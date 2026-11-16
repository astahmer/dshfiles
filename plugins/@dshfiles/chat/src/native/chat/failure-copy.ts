/**
 * dshfiles (unslop T8, T9): the sentence a failed Turn shows.
 *
 * The Host hands the provider's failure as it arrived: `400: {"message":"…","type":"…","code":"…"}`, or a library
 * string such as `pi-ai stream idle timeout after 300000ms`. The card shows one plain sentence and keeps the original
 * and the failure code under "Details".
 */

/** What the card shows: a keyed sentence with its parameters, or the provider's own words. */
export type FailureSentence =
  | { readonly kind: 'stalled'; readonly minutes: number }
  | { readonly kind: 'tooLong' }
  | { readonly kind: 'provider'; readonly text: string }
  | { readonly kind: 'unknown' }

const STATUS_PAYLOAD = /^\s*\d{3}\s*:\s*(\{[\s\S]*\})\s*$/
/** A status line or JSON body with no sentence in it: nothing a person can read. */
const BARE_PAYLOAD = /^(\d{3}\s*:\s*)?[{[]/
const IDLE_TIMEOUT = /idle timeout after (\d+)\s*ms/i
const CONTEXT_LENGTH = /maximum context length|context window|context length exceeded/i

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The human message inside a provider's JSON error body, when the body carries one. */
function payloadMessage(raw: string): string | undefined {
  const body = STATUS_PAYLOAD.exec(raw)?.[1] ?? (raw.trim().startsWith('{') ? raw.trim() : undefined)
  if (body === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const nested = isRecord(parsed.error) ? parsed.error.message : undefined
  const message = typeof parsed.message === 'string' ? parsed.message : typeof nested === 'string' ? nested : undefined
  return message === undefined || message.trim() === '' ? undefined : message.trim()
}

/** End a provider's words like a sentence, without touching text that already ends one. */
function asSentence(text: string): string {
  return /[.!?…。]$/.test(text) ? text : `${text}.`
}

/**
 * Choose the sentence for a terminal failure.
 * @param message - the failure text the Host retained.
 * @param code - the failure code the Host retained, when it set one.
 * @returns the sentence to show in place of the raw text.
 */
export function failureSentence(message: string, code: string | undefined): FailureSentence {
  const stalled = IDLE_TIMEOUT.exec(message)
  if (stalled !== null) return { kind: 'stalled', minutes: Math.max(1, Math.round(Number(stalled[1]) / 60_000)) }
  const text = payloadMessage(message) ?? message.trim()
  if (code === 'CONTEXT_WINDOW_EXCEEDED' || CONTEXT_LENGTH.test(text)) return { kind: 'tooLong' }
  if (text === '' || BARE_PAYLOAD.test(text)) return { kind: 'unknown' }
  return { kind: 'provider', text: asSentence(text) }
}

/**
 * What "Details" holds: the failure code and the original text, or null when the sentence already says all of it.
 * @param message - the failure text the Host retained.
 * @param code - the failure code the Host retained, when it set one.
 * @param shown - the sentence the card shows.
 * @returns the code and the original text to disclose.
 */
export function failureDetails(
  message: string,
  code: string | undefined,
  shown: string,
): { readonly code: string | undefined; readonly raw: string | undefined } | null {
  const raw = message.trim()
  const rawAdds = raw !== '' && raw !== shown && asSentence(raw) !== shown
  if (code === undefined && !rawAdds) return null
  return { code, raw: rawAdds ? raw : undefined }
}
