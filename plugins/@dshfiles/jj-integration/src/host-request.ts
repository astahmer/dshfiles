interface HostRequestOptions<Value> {
  readonly request: (signal: AbortSignal) => Promise<Value>
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

export const runHostRequest = <Value>({ request, signal, timeoutMs = DEFAULT_TIMEOUT_MS }: HostRequestOptions<Value>): Promise<Value> => {
  const controller = new AbortController()
  const abortFromCaller = (): void => controller.abort(signal?.reason)
  if (signal?.aborted === true) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error('Host request timed out.')), timeoutMs)
  return Promise.resolve()
    .then(() => request(controller.signal))
    .finally(() => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromCaller)
    })
}
