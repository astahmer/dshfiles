/** The forwarded `user-questions/request` listener's claim and waterfall lifetime as one explicit state. */
import type { QuestionAnswer, QuestionWaterfallChannel, QuestionWaterfallRequest } from './native/contract/slots.ts'

/** One frame of an open Host claim: how long its foreground wait still has. */
export interface ClaimFrame {
  readonly remainingMs: number
}

/** The open Host claim stream this Client holds: its frames and the one cancel that releases it. */
export interface ClaimHandle {
  readonly [Symbol.asyncIterator]: () => AsyncIterator<ClaimFrame>
  readonly dispose: () => void
}

/** The foreground claim a forwarded request may hold, opened and released on the owning fiber. */
export interface ClaimPorts {
  readonly attach: (signal: AbortSignal) => ClaimHandle
  readonly own: (body: () => () => Promise<void>, label: string) => () => Promise<void>
}

/** What one forwarded request holds right now. */
type RequestState =
  /** The claim is attached; its opening frame has not been read yet. */
  | { readonly kind: 'claiming'; readonly handle: ClaimHandle; readonly frames: AsyncIterator<ClaimFrame> }
  /** No claim to hold: a blocking question's waterfall is the whole request. */
  | { readonly kind: 'unclaimed' }
  /** The waterfall is presented; `claim` is the Host stream it also holds, when it holds one. */
  | { readonly kind: 'presenting'; readonly claim: HeldClaim | undefined; readonly delegate: () => void }
  /** The claim is released; the request holds nothing. */
  | { readonly kind: 'released' }

/** One Host claim the listener waits on, and the end that says the claim is no longer its own. */
interface HeldClaim {
  readonly handle: ClaimHandle
  readonly ended: Promise<never>
}

/** What one forwarded request needs from its plugin, its card and the Host. */
export interface ForegroundRequestPorts {
  /** Tool call identity; a blocking request has none, so its card ends with its waterfall. */
  readonly callId: string | undefined
  /** Cancellation lifetime of the forwarded request. */
  readonly signal: AbortSignal | undefined
  /** The claim to hold, when this request is a timed wait on a named tool call. */
  readonly claim: ClaimPorts | undefined
  /** Hand the request to the next waterfall listener. */
  readonly next: () => Promise<QuestionAnswer>
  /** Build the card's waterfall for this request. */
  readonly createWaterfall: (input: { readonly remainingMs: number | undefined; readonly signal: AbortSignal }) => QuestionWaterfallRequest
  readonly card: {
    readonly attachWaterfall: (channel: QuestionWaterfallChannel) => void
    readonly remove: () => void
    readonly trackRequest: (completion: Promise<void>) => () => void
  }
}

const CLAIM_EFFECT_LABEL = 'ui-user-questions: foreground claim'

/**
 * Present one forwarded request through its card until its waterfall settles, then release its claim exactly once.
 *
 * Release ordering is the Host protocol, not a preference: a timered wait belongs to the Host until it accepts the
 * waterfall outcome, so only its own claim end may release it. Delegation is the exception the listener drives: it
 * hands the request on and releases before `next()`.
 * @param ports - the request's card, Host claim, waterfall and next listener.
 * @returns the listener body: settles with the answer or rejection the Host sees.
 */
export const createForegroundRequest = (ports: ForegroundRequestPorts): (() => Promise<QuestionAnswer>) => {
  const lifetime = new AbortController()
  const signal = ports.signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, ports.signal])
  const card = ports.card
  const next = ports.next
  const callId = ports.callId
  let state: RequestState = { kind: 'unclaimed' }

  const releaseClaim = async (): Promise<void> => {
    if (state.kind === 'released') return
    /* oxlint-disable-next-line antislop/no-passthrough-variable -- the release unwinds the parts it held before the state says so. */
    const held = state
    state = { kind: 'released' }
    if (held.kind === 'presenting') held.delegate()
    lifetime.abort()
    if (held.kind === 'claiming') held.handle.dispose()
    else if (held.kind === 'presenting' && held.claim !== undefined) held.claim.handle.dispose()
    if (held.kind === 'presenting' && held.claim !== undefined) await Promise.allSettled([held.claim.ended])
  }
  /** Drop a request that holds no claim: only its local lifetime remains to cancel. */
  const releaseLifetime = (): undefined => {
    state = { kind: 'released' }
    lifetime.abort()
    return undefined
  }
  const release = (): Promise<void> | undefined => {
    if (state.kind === 'released') return undefined
    if (state.kind === 'unclaimed') return releaseLifetime()
    if (state.kind === 'claiming') return disposeClaim?.()
    if (state.claim === undefined) return releaseLifetime()
    // The Host closes the claim after accepting the waterfall outcome.
    // A local return precedes transmission and cannot release that claim.
    void Promise.allSettled([state.claim.ended]).then(() => {
      void disposeClaim?.()
    })
    return undefined
  }
  const releaseAwaited = (): Promise<void> | undefined => {
    if (state.kind === 'released') return undefined
    if (state.kind === 'unclaimed' || (state.kind === 'presenting' && state.claim === undefined)) return releaseLifetime()
    return disposeClaim?.()
  }
  const claimPorts = ports.claim
  const disposeClaim =
    claimPorts === undefined
      ? undefined
      : claimPorts.own(() => {
          const handle = claimPorts.attach(signal)
          state = { kind: 'claiming', handle, frames: handle[Symbol.asyncIterator]() }
          return releaseClaim
        }, CLAIM_EFFECT_LABEL)

  const openClaim = async (): Promise<IteratorResult<ClaimFrame> | undefined> => (state.kind === 'claiming' ? state.frames.next() : undefined)
  const watchClaimEnd = (frames: AsyncIterator<ClaimFrame>): Promise<never> =>
    (async () => {
      await frames.next()
      throw new Error('the foreground question wait ended')
    })()
  const present = (waterfall: QuestionWaterfallRequest): void => {
    const delegate = (): void => {
      waterfall.channel.delegate()
    }
    card.attachWaterfall(waterfall.channel)
    state = {
      kind: 'presenting',
      delegate,
      claim: state.kind === 'claiming' ? { handle: state.handle, ended: watchClaimEnd(state.frames) } : undefined,
    }
  }
  const settle = (waterfall: QuestionWaterfallRequest): Promise<QuestionAnswer> => {
    const ended = state.kind === 'presenting' ? state.claim?.ended : undefined
    return ended === undefined ? waterfall.result : Promise.race([waterfall.result, ended])
  }

  return async (): Promise<QuestionAnswer> => {
    const completed = Promise.withResolvers<void>()
    const finishRequest = card.trackRequest(completed.promise)
    try {
      const opening = await openClaim()
      if (opening?.done === true) return await next()
      const waterfall = ports.createWaterfall({
        remainingMs: opening === undefined ? undefined : opening.value.remainingMs,
        signal,
      })
      // Cancellation may win between the first claim frame and this continuation.
      // The request has already settled, so its channel must never reach the card.
      if (signal.aborted) return await waterfall.result
      present(waterfall)
      try {
        return await settle(waterfall)
      } catch (error) {
        if (waterfall.isDelegation(error)) {
          await releaseAwaited()
          return await next()
        }
        throw error
      }
    } finally {
      await release()
      // A blocking request without a call id is not in the projection; its card ends with its waterfall.
      if (callId === undefined) card.remove()
      completed.resolve()
      finishRequest()
    }
  }
}
