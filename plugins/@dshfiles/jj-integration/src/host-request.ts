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
  constructor(readonly timeoutMs: number) {
    super(`The Host did not answer within ${Math.round(timeoutMs / 1000)}s. It may still be starting; retry in a moment.`)
    this.name = 'HostTimeoutError'
  }
}

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
