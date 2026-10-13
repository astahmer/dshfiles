import { describe, expect, it } from 'vitest'
import { HostTimeoutError, runHostRequest } from './host-request.js'

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
