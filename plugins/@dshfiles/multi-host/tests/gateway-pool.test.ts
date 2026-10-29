import { describe, expect, test } from 'vitest'
import type { Gateway } from '../src/connectors/gateway.js'
import { createServer, type Server } from 'node:http'
import { decodeJson } from '@dshfiles/dshx/json'
import { z } from 'zod'
import { connectGateway, GatewayUnavailableError } from '../src/connectors/gateway.js'
import { createGatewayPool } from '../src/gateway-pool.js'
import { NativeRpcModel } from '../src/native-rpc.js'

const fakeGateway = () => {
  let close = (): void => {}
  const state = { disposed: 0 }
  const unused = async (): Promise<never> => {
    throw new Error('The pool never calls the gateway itself.')
  }
  const gateway: Gateway = {
    origin: 'http://127.0.0.1:0',
    launchUrl: 'http://127.0.0.1:0/',
    closed: new Promise<void>(resolve => (close = resolve)),
    run: unused,
    runSafe: unused,
    api: unused,
    pluginApi: () => unused,
    follow: unused,
    dispose: async () => {
      state.disposed += 1
    },
  }
  return { gateway, state, drop: () => close() }
}

describe('gateway pool', () => {
  test('reuses one connection per runtime until it is invalidated or its transport drops', async () => {
    const opened: ReturnType<typeof fakeGateway>[] = []
    const pool = createGatewayPool({
      isTransportFailure: () => false,
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
      isTransportFailure: () => false,
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
      isTransportFailure: () => false,
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

/** A loopback runtime that speaks the DSH launch handoff and native RPC envelope, and can drop sockets on demand. */
const startRuntimeFixture = async () => {
  const calls: string[] = []
  const state = { dropNext: 0 }
  const server: Server = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.startsWith('/?token=')) {
      response.writeHead(303, { location: '/', 'set-cookie': 'dsh-auth-fixture=1; Path=/; HttpOnly' })
      response.end()
      return
    }
    const body: string[] = []
    request.setEncoding('utf8')
    request.on('data', chunk => body.push(chunk))
    request.on('end', () => {
      calls.push(request.url ?? '')
      if (state.dropNext > 0) {
        state.dropNext -= 1
        response.destroy()
        return
      }
      const rpcId = decodeJson(z.object({ rpcId: z.string() }).passthrough(), body.join('')).rpcId
      const value = request.url === '/api/session/create' ? { sessionId: 'session-1' } : { items: [] }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = z.object({ port: z.number() }).parse(server.address()).port
  const launchUrl = `http://127.0.0.1:${port}/?token=fixture-token-12345678`
  return {
    calls,
    state,
    connect: () => connectGateway({ launchUrl, createTransport: async origin => ({ origin: origin.origin, launchUrl, dispose: async () => {} }) }),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

const transportCodes = new Set(['gateway-unreachable'])

describe('gateway pool against a loopback runtime', () => {
  test('a read whose connection drops retries once on a fresh connection', async () => {
    const runtime = await startRuntimeFixture()
    let connections = 0
    const pool = createGatewayPool({
      isTransportFailure: error => error instanceof GatewayUnavailableError && transportCodes.has(error.code),
      connect: async () => {
        connections += 1
        return runtime.connect()
      },
    })
    try {
      runtime.state.dropNext = 1
      const value = await pool.run('runtime', gateway => gateway.run('session', 'list', { _request: {} }), { mutation: false })
      expect(value).toEqual({ items: [] })
      expect(connections).toBe(2)
      expect(runtime.calls.filter(url => url === '/api/session/list')).toHaveLength(2)
    } finally {
      await pool.close()
      await runtime.close()
    }
  })

  test('a mutation whose reply is lost is reported once, retires the connection, and is never replayed', async () => {
    const runtime = await startRuntimeFixture()
    let connections = 0
    const pool = createGatewayPool({
      isTransportFailure: () => false,
      connect: async () => {
        connections += 1
        return runtime.connect()
      },
    })
    try {
      runtime.state.dropNext = 1
      const result = await pool.run(
        'runtime',
        gateway => NativeRpcModel.call(gateway, { namespace: 'session', method: 'create', args: { request: { cwd: '/tmp/fixture' } } }),
        { mutation: true, broken: outcome => !outcome.ok && outcome.code === 'unknown-mutation-outcome' },
      )
      expect(result).toMatchObject({ ok: false, code: 'unknown-mutation-outcome' })
      expect(runtime.calls.filter(url => url === '/api/session/create')).toHaveLength(1)
      expect(pool.status('runtime')).toBeUndefined()
      await pool.run('runtime', gateway => gateway.run('session', 'list', { _request: {} }), { mutation: false })
      expect(connections).toBe(2)
    } finally {
      await pool.close()
      await runtime.close()
    }
  })
})
