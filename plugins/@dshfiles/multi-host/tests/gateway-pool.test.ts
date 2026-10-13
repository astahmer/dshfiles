import { describe, expect, test } from 'vitest'
import type { Gateway } from '../src/connectors/gateway.js'
import { createGatewayPool } from '../src/gateway-pool.js'

const fakeGateway = () => {
  let close = (): void => {}
  const state = { disposed: 0 }
  const gateway = {
    closed: new Promise<void>(resolve => (close = resolve)),
    dispose: async () => {
      state.disposed += 1
    },
  } as unknown as Gateway
  return { gateway, state, drop: () => close() }
}

describe('gateway pool', () => {
  test('reuses one connection per runtime until it is invalidated or its transport drops', async () => {
    const opened: ReturnType<typeof fakeGateway>[] = []
    const pool = createGatewayPool({
      connect: async () => {
        const next = fakeGateway()
        opened.push(next)
        return next.gateway
      },
    })
    const first = await pool.acquire('runtime-a')
    const second = await pool.acquire('runtime-a')
    expect(opened).toHaveLength(1)
    expect(second.generation).toBe(first.generation)
    first.release()
    second.release()

    pool.invalidate('runtime-a', first.generation)
    const third = await pool.acquire('runtime-a')
    expect(opened).toHaveLength(2)
    expect(third.generation).toBeGreaterThan(first.generation)
    pool.invalidate('runtime-a', first.generation)
    expect(pool.status('runtime-a')?.generation).toBe(third.generation)

    opened[1]?.drop()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(pool.status('runtime-a')).toBeUndefined()
    third.release()
    await pool.close()
  })

  test('closes an idle connection after its TTL but not while a lease holds it', async () => {
    const opened: ReturnType<typeof fakeGateway>[] = []
    const pool = createGatewayPool({
      idleMs: 20,
      connect: async () => {
        const next = fakeGateway()
        opened.push(next)
        return next.gateway
      },
    })
    const held = await pool.acquire('runtime-b')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(pool.status('runtime-b')).toBeDefined()
    held.release()
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(pool.status('runtime-b')).toBeUndefined()
    expect(opened[0]?.state.disposed).toBe(1)
  })

  test('forgets a failed connect so the next call retries', async () => {
    let attempts = 0
    const pool = createGatewayPool({
      connect: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('unreachable')
        return fakeGateway().gateway
      },
    })
    await expect(pool.acquire('runtime-c')).rejects.toThrow('unreachable')
    await new Promise(resolve => setTimeout(resolve, 0))
    await expect(pool.acquire('runtime-c')).resolves.toBeDefined()
    expect(attempts).toBe(2)
    await pool.close()
  })
})
