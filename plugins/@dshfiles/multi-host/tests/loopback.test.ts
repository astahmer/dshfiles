import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { createLoopbackForward, reserveLoopbackEndpoint } from '../src/connectors/loopback.js'

const servers: Server[] = []
const forwards: Array<{ dispose(): Promise<void> }> = []
const serverAddressSchema = z.object({ address: z.string(), port: z.number().int().min(0).max(65_535) })

const listen = async (server: Server): Promise<{ readonly host: string; readonly port: number }> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = serverAddressSchema.safeParse(server.address())
  if (!address.success) throw new Error('The synthetic runtime did not bind TCP.')
  return { host: '127.0.0.1', port: address.data.port }
}

afterEach(async () => {
  await Promise.all(forwards.splice(0).map(forward => forward.dispose()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('multi-host loopback origin isolation', () => {
  test('forwards runtime traffic through distinct loopback origins', async () => {
    const requests: Array<{ readonly host: string | undefined; readonly cookie: string | undefined }> = []
    const runtime = createServer((request, response) => {
      requests.push({ host: request.headers.host, cookie: request.headers.cookie })
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('runtime response')
    })
    servers.push(runtime)
    const runtimeAddress = await listen(runtime)
    const target = new URL(`http://${runtimeAddress.host}:${runtimeAddress.port}`)
    const firstOrigin = await reserveLoopbackEndpoint()
    const first = await createLoopbackForward({ target, originPort: firstOrigin.port })
    const second = await createLoopbackForward({ target })
    forwards.push(first, second)

    const firstUrl = new URL(`http://${first.address}:${first.port}`)
    const secondUrl = new URL(`http://${second.address}:${second.port}`)
    expect(firstUrl.origin).not.toBe(secondUrl.origin)
    expect(firstUrl.hostname).toBe('127.0.0.1')
    expect(secondUrl.hostname).toBe('127.0.0.1')
    expect(firstUrl.port).not.toBe(secondUrl.port)
    expect(firstUrl.port).toBe(String(firstOrigin.port))

    const responses = await Promise.all([
      fetch(new URL('/?runtime=first', firstUrl), { headers: { cookie: 'runtime=first' } }),
      fetch(new URL('/?runtime=second', secondUrl), { headers: { cookie: 'runtime=second' } }),
    ])
    expect(await Promise.all(responses.map(response => response.text()))).toEqual(['runtime response', 'runtime response'])
    expect(requests).toHaveLength(2)
    expect(requests.map(request => request.cookie).sort()).toEqual(['runtime=first', 'runtime=second'])
    expect(new Set(requests.map(request => request.host)).size).toBe(2)

    await first.dispose()
    const reconnected = await createLoopbackForward({ target, originPort: firstOrigin.port })
    forwards.push(reconnected)
    expect(new URL(`http://${reconnected.address}:${reconnected.port}`).origin).toBe(firstUrl.origin)
  })
})
