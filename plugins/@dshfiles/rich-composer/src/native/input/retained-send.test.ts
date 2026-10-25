import { describe, expect, it } from 'vitest'
import { whileSessionRetained } from './retained-send.js'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('whileSessionRetained', () => {
  it('holds the exact session until send admission settles', async () => {
    const session = { sessionId: 'session-1' }
    const request = deferred<string>()
    let retained = false
    let releases = 0
    const sessions = {
      binding: () => ({ session }),
      retain: () => {
        retained = true
        return { release: () => { retained = false; releases += 1 } }
      },
    }

    const send = whileSessionRetained({ sessions, session, operation: () => request.promise })
    expect(retained).toBe(true)
    expect(releases).toBe(0)

    request.resolve('admitted')
    await expect(send).resolves.toBe('admitted')
    expect(retained).toBe(false)
    expect(releases).toBe(1)
  })

  it('releases the session when admission fails', async () => {
    const session = { sessionId: 'session-1' }
    let retained = false
    const sessions = {
      binding: () => ({ session }),
      retain: () => {
        retained = true
        return { release: () => { retained = false } }
      },
    }

    await expect(whileSessionRetained({
      sessions,
      session,
      operation: async () => { throw new Error('rejected') },
    })).rejects.toThrow('rejected')
    expect(retained).toBe(false)
  })

  it('does not retain a replaced session identity', async () => {
    const session = { sessionId: 'session-1' }
    let retainCalls = 0
    const sessions = {
      binding: () => ({ session: { sessionId: 'replacement' } }),
      retain: () => {
        retainCalls += 1
        return { release: () => undefined }
      },
    }

    await expect(whileSessionRetained({
      sessions,
      session,
      operation: async () => 'unreachable',
    })).rejects.toThrow('Session binding was replaced')
    expect(retainCalls).toBe(0)
  })
})
