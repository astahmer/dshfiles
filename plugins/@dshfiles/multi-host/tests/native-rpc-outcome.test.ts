import { createServer } from 'node:http'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import type { NativeRpcRequest } from '../src/api.js'
import { connectGateway } from '../src/connectors/gateway.js'
import { callNativeRpc } from '../src/native-rpc.js'

describe('native mutation outcome recovery', () => {
  const requestEnvelopeSchema = z.object({ rpcId: z.string() }).passthrough()
  const addressSchema = z.object({ port: z.number().int().min(0).max(65_535) })

  test('reports an admitted create as unknown after its reply is lost and reconciles without replay', async () => {
    let admittedSessionCount = 0
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url?.startsWith('/?token=')) {
        response.writeHead(303, { location: '/', 'set-cookie': 'dsh-session=test; Path=/; HttpOnly' })
        response.end()
        return
      }
      const body: string[] = []
      request.setEncoding('utf8')
      request.on('data', chunk => body.push(chunk))
      request.on('end', () => {
        let requestId: string
        try {
          requestId = requestEnvelopeSchema.parse(JSON.parse(body.join(''))).rpcId
        } catch {
          response.writeHead(400).end()
          return
        }
        if (request.url === '/api/session/create') {
          admittedSessionCount += 1
          response.destroy()
          return
        }
        if (request.url === '/api/session/list') {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(
            JSON.stringify({
              type: 'server-response',
              rpcId: requestId,
              result: {
                ok: true,
                value: {
                  items: [{ sessionId: 'admitted-session', updatedAt: 1, running: false, blank: true }],
                },
              },
            }),
          )
          return
        }
        response.writeHead(404).end()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = addressSchema.safeParse(server.address())
    if (!address.success) throw new Error('The loopback fixture did not bind.')
    const launchUrl = `http://127.0.0.1:${address.data.port}/?token=fixture-token-12345678`
    const gateway = await connectGateway({
      launchUrl,
      createTransport: async origin => ({ origin: origin.origin, launchUrl, dispose: async () => {} }),
    })
    try {
      const createRequest: NativeRpcRequest = {
        namespace: 'session',
        method: 'create',
        args: { request: { cwd: '/tmp/multi-host-outcome-fixture' } },
      }
      const result = await callNativeRpc(gateway, createRequest)
      expect(result).toEqual({
        ok: false,
        code: 'unknown-mutation-outcome',
        message: 'The connection failed after the mutation was sent. Outcome is unknown; inspect runtime state before retrying.',
      })
      expect(admittedSessionCount).toBe(1)
      const reconciled = await gateway.runSafe('session', 'list', { _request: {} })
      expect(reconciled.ok).toBe(true)
      if (reconciled.ok) expect(reconciled.value).toMatchObject({ items: [{ sessionId: 'admitted-session' }] })
      expect(admittedSessionCount).toBe(1)
    } finally {
      await gateway.dispose()
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    }
  })
})
