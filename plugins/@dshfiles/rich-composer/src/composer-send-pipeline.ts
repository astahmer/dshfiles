import type { ComposerSendPreparer } from './composer-send.ts'

/** A preparer that takes longer is skipped, so a slow Host never holds a send for long. */
export const PREPARE_TIMEOUT_MS = 8_000

type Source = () => readonly ComposerSendPreparer[]

let source: Source = () => []

const settleWithin = async (
  preparer: ComposerSendPreparer,
  input: { readonly sessionId: string; readonly text: string; readonly signal: AbortSignal },
  timeoutMs: number,
): Promise<string> => {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
  const aborted = new Promise<undefined>(resolve => {
    if (signal.aborted) resolve(undefined)
    signal.addEventListener('abort', () => resolve(undefined), { once: true })
  })
  try {
    const result = await Promise.race([preparer.prepare({ sessionId: input.sessionId, text: input.text, signal }), aborted])
    return result?.text ?? input.text
  } catch (cause) {
    console.warn(`rich-composer: send preparer ${preparer.id} failed; the message is sent as typed`, cause)
    return input.text
  }
}

/**
 * Runs the {@link ComposerSendPreparers} a new thread's first message passes through. The client entry binds the
 * registry's live list once; the input hub calls {@link ComposerSendPipeline.prepare} from its send path.
 */
export const ComposerSendPipeline = {
  bind: (next: Source): (() => void) => {
    source = next
    return () => {
      if (source === next) source = () => []
    }
  },
  /** The text to send: each preparer in order, a failing or slow one skipped. Rejects only when `signal` aborted. */
  prepare: async (input: { readonly sessionId: string; readonly text: string; readonly signal: AbortSignal }, timeoutMs = PREPARE_TIMEOUT_MS): Promise<string> => {
    const preparers = [...source()].sort((left, right) => (left.order ?? 100) - (right.order ?? 100))
    let text = input.text
    for (const preparer of preparers) {
      input.signal.throwIfAborted()
      text = await settleWithin(preparer, { sessionId: input.sessionId, text, signal: input.signal }, timeoutMs)
    }
    input.signal.throwIfAborted()
    return text
  },
}
