import { describe, expect, test } from 'vitest'
import type { Gateway } from '../src/connectors/gateway.js'
import { createGatewayPool } from '../src/gateway-pool.js'

// Pins the pool contract beyond gateway-pool.test.ts before it becomes an RcMap-backed `RuntimePool`.

class TransportDropped extends Error {}

const fakeGateway = () => {
  const state = { disposed: 0 }
  const unused = async (): Promise<never> => {
    throw new Error('The pool never calls the gateway itself.')
  }
  const gateway: Gateway = {
    origin: 'http://127.0.0.1:0',
    launchUrl: 'http://127.0.0.1:0/',
    closed: new Promise<void>(() => undefined),
    run: unused,
    runSafe: unused,
    api: unused,
    pluginApi: () => unused,
    follow: unused,
    dispose: async () => {
      state.disposed += 1
    },
  }
  return { gateway, state }
}

const countingPool = () => {
  const opened: ReturnType<typeof fakeGateway>[] = []
  let releaseConnect: () => void = () => undefined
  let connectGate: Promise<void> = Promise.resolve()
  const pool = createGatewayPool({
    isTransportFailure: error => error instanceof TransportDropped,
    connect: async () => {
      await connectGate
      const next = fakeGateway()
      opened.push(next)
      return next.gateway
    },
  })
  const holdConnects = () => {
    connectGate = new Promise(resolve => {
      releaseConnect = resolve
    })
  }
  return { pool, opened, holdConnects, releaseConnects: () => releaseConnect() }
}

describe('gateway pool characterization', () => {
  test('concurrent callers arriving while the first connect is in flight share that one connection', async () => {
    const { pool, opened, holdConnects, releaseConnects } = countingPool()
    holdConnects()
    const leases = Promise.all([pool.acquire('runtime'), pool.acquire('runtime'), pool.acquire('runtime')])
    releaseConnects()
    const acquired = await leases
    expect(opened).toHaveLength(1)
    expect(new Set(acquired.map(lease => lease.generation)).size).toBe(1)
    for (const lease of acquired) lease.release()
    await pool.close()
  })

  test('different runtimes get different connections', async () => {
    const { pool, opened } = countingPool()
    const first = await pool.acquire('runtime-a')
    const second = await pool.acquire('runtime-b')
    expect(opened).toHaveLength(2)
    expect(second.generation).not.toBe(first.generation)
    first.release()
    second.release()
    await pool.close()
  })

  test('a read retries exactly once: a second transport failure reaches the caller', async () => {
    const { pool, opened } = countingPool()
    let attempts = 0
    await expect(
      pool.run(
        'runtime',
        async () => {
          attempts += 1
          throw new TransportDropped('dropped')
        },
        { mutation: false },
      ),
    ).rejects.toBeInstanceOf(TransportDropped)
    expect(attempts).toBe(2)
    expect(opened).toHaveLength(2)
    expect(pool.status('runtime')).toBeUndefined()
  })

  test('a mutation that hits a transport failure is not retried and retires its connection', async () => {
    const { pool, opened } = countingPool()
    let attempts = 0
    await expect(
      pool.run(
        'runtime',
        async () => {
          attempts += 1
          throw new TransportDropped('dropped')
        },
        { mutation: true },
      ),
    ).rejects.toBeInstanceOf(TransportDropped)
    expect(attempts).toBe(1)
    expect(opened).toHaveLength(1)
    expect(opened[0]?.state.disposed).toBe(1)
    expect(pool.status('runtime')).toBeUndefined()
  })

  test('a non-transport failure keeps the connection and is never retried', async () => {
    const { pool, opened } = countingPool()
    let attempts = 0
    await expect(
      pool.run(
        'runtime',
        async () => {
          attempts += 1
          throw new Error('request rejected')
        },
        { mutation: false },
      ),
    ).rejects.toThrow('request rejected')
    expect(attempts).toBe(1)
    expect(pool.status('runtime')).toMatchObject({ connected: true })
    expect(opened[0]?.state.disposed).toBe(0)
    await pool.close()
  })

  test('a broken read result retries once on a fresh connection, then returns the second result as is', async () => {
    const { pool, opened } = countingPool()
    const results: string[] = []
    const value = await pool.run(
      'runtime',
      async () => {
        results.push('broken')
        return 'broken'
      },
      { mutation: false, broken: result => result === 'broken' },
    )
    expect(value).toBe('broken')
    expect(results).toHaveLength(2)
    expect(opened).toHaveLength(2)
    expect(pool.status('runtime')).toBeUndefined()
  })

  test('a broken mutation result is returned once and retires the connection', async () => {
    const { pool, opened } = countingPool()
    let attempts = 0
    const value = await pool.run(
      'runtime',
      async () => {
        attempts += 1
        return 'lost'
      },
      { mutation: true, broken: result => result === 'lost' },
    )
    expect(value).toBe('lost')
    expect(attempts).toBe(1)
    expect(opened[0]?.state.disposed).toBe(1)
  })

  test('releasing a lease twice counts once, so the idle timer still waits for the other holder', async () => {
    const opened: ReturnType<typeof fakeGateway>[] = []
    const pool = createGatewayPool({
      isTransportFailure: () => false,
      idleMs: 20,
      connect: async () => {
        const next = fakeGateway()
        opened.push(next)
        return next.gateway
      },
    })
    const first = await pool.acquire('runtime')
    const second = await pool.acquire('runtime')
    first.release()
    first.release()
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(pool.status('runtime')).toBeDefined()
    second.release()
    await expect.poll(() => pool.status('runtime')).toBeUndefined()
    expect(opened[0]?.state.disposed).toBe(1)
  })

  test('close(runtimeId) disposes only that runtime; close() disposes every one', async () => {
    const { pool, opened } = countingPool()
    ;(await pool.acquire('runtime-a')).release()
    ;(await pool.acquire('runtime-b')).release()
    await pool.close('runtime-a')
    expect(pool.status('runtime-a')).toBeUndefined()
    expect(pool.status('runtime-b')).toBeDefined()
    await pool.close()
    expect(pool.status('runtime-b')).toBeUndefined()
    expect(opened.every(entry => entry.state.disposed >= 1)).toBe(true)
  })
})
