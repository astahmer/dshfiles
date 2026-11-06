interface HostRequestOptions<Value> {
  readonly request: (signal: AbortSignal) => Promise<Value>
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export const HOST_REQUEST_TIMEOUT_MS = 15_000

/**
 * A slow Host is a distinct state from a refused one: the transport reports its
 * own abort wording ("API request was aborted"), which hides whether the caller
 * navigated away, the request timed out, or the Host rejected it.
 */
export class HostTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`The Host did not answer within ${Math.round(timeoutMs / 1000)}s. It may still be starting; retry in a moment.`)
    this.timeoutMs = timeoutMs
    this.name = 'HostTimeoutError'
  }
}

/**
 * Query `retry` for Host reads: once, except after a client timeout. The timer starts when the read is issued, not
 * when it leaves the browser, so a timeout usually means the six HTTP/1.1 sockets were busy and the read never reached
 * the Host; a retry would only rejoin the back of that queue.
 */
export const retryOnceUnlessTimedOut = (failureCount: number, error: unknown): boolean => !(error instanceof HostTimeoutError) && failureCount < 1

export const runHostRequest = <Value>({ request, signal, timeoutMs = HOST_REQUEST_TIMEOUT_MS }: HostRequestOptions<Value>): Promise<Value> => {
  const controller = new AbortController()
  const abortFromCaller = (): void => controller.abort(signal?.reason)
  if (signal?.aborted === true) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => controller.abort(new HostTimeoutError(timeoutMs)), timeoutMs)
  return Promise.resolve()
    .then(() => request(controller.signal))
    .catch((error: unknown) => {
      if (!controller.signal.aborted) throw error
      const reason: unknown = controller.signal.reason
      throw reason instanceof Error ? reason : error
    })
    .finally(() => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromCaller)
    })
}
