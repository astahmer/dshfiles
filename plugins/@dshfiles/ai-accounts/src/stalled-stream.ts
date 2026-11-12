import type { LlmFailure } from '@deepseek-ai/dsh-llm'

/** pi-ai's watchdog wording: `pi-ai stream idle timeout after 120000ms`. */
const STREAM_IDLE_TIMEOUT = /\bstream idle timeout after (\d+)\s?ms\b/i

const silenceLabel = (ms: number): string => {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`
  return `${Math.round(ms / 1_000)} s`
}

/** A model request whose stream sent no data until the adapter's idle watchdog gave up. */
export class StalledStream {
  /** How long the stream stayed silent, or `undefined` for any other failure. */
  static readonly silentMs = (failure: Pick<LlmFailure, 'message'>): number | undefined => {
    const silence = STREAM_IDLE_TIMEOUT.exec(failure.message)?.[1]
    return silence === undefined ? undefined : Number(silence)
  }

  static readonly silenceLabel = silenceLabel

  /** What a turn that stopped on a silent stream tells the user to do next; the retry rows above it name the route. */
  static readonly turnAdvice = (input: { readonly silentMs: number; readonly fallbackOn: boolean }): string => {
    const stopped = `The model sent no data for ${silenceLabel(input.silentMs)}, so this turn stopped after its retries (see the retry rows above for the route). Resume to retry it, or pick another model in the composer first.`
    if (input.fallbackOn)
      return `${stopped} No fallback in this thread's model fallback chain could take it; add one from the model picker's Fallbacks section.`
    return `${stopped} To move to the thread's model fallback chain automatically next time, turn on Fall back on stalled streams in Settings › AI Accounts › Failure recovery.`
  }
}
