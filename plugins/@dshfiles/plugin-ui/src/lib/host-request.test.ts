import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { HostTimeoutError, retryOnceUnlessTimedOut, runHostRequest } from './host-request.js'

describe('runHostRequest', () => {
  it('aborts Host requests that do not respond before the timeout', async () => {
    let observedSignal: AbortSignal | undefined
    const result = runHostRequest({
      timeoutMs: 5,
      request: signal => {
        observedSignal = signal
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    })

    await expect(result).rejects.toBeInstanceOf(HostTimeoutError)
    expect(observedSignal?.aborted).toBe(true)
  })
})

describe('retryOnceUnlessTimedOut', () => {
  const attempts = async (failure: () => Error): Promise<number> => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: retryOnceUnlessTimedOut, retryDelay: 0 } } })
    let calls = 0
    await client
      .fetchQuery({
        queryKey: ['read'],
        queryFn: () => {
          calls += 1
          return Promise.reject(failure())
        },
      })
      .catch(() => undefined)
    return calls
  }

  it('retries a refused read once', async () => {
    expect(await attempts(() => new Error('refused'))).toBe(2)
  })

  it('does not send a read that timed out in the browser queue to the back of it again', async () => {
    expect(await attempts(() => new HostTimeoutError(15_000))).toBe(1)
  })
})
