import { createServer } from 'node:http'
import { once } from 'node:events'
import { Effect, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { openGateway } from './fixtures/gateway-runtime.js'
import { multiHostApi } from '../src/api.js'

const addressSchema = Schema.Struct({ port: Schema.Number })
const requestSchema = Schema.fromJsonString(Schema.Struct({ rpcId: Schema.String }))

describe('remote plugin failures', () => {
  test('preserves bounded redacted JSON details across the gateway', async () => {
    let details: Record<string, unknown> = { revision: 42, secret: 'private', nested: { token: 'private' } }
    const server = createServer((request, response) => {
      if (request.method === 'GET') {
        response.writeHead(302, { location: '/', 'set-cookie': 'session=fixture; HttpOnly' }).end()
        return
      }
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => {
        body += chunk
      })
      request.on('end', () => {
        const input = Schema.decodeUnknownSync(requestSchema)(body)
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            type: 'server-response',
            rpcId: input.rpcId,
            result: { ok: false, error: { code: 'conflict', message: 'Conflict', details } },
          }),
        )
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = Schema.decodeUnknownSync(addressSchema)(server.address())
    const opened = await openGateway(`http://127.0.0.1:${address.port}/?token=fixture-token-12345678`)
    try {
      const error = await opened.call(Effect.flip(opened.gateway.pluginApi({ packageId: '@dshfiles/example', apiId: 'example', version: 1 })('read')))
      expect(error).toMatchObject({ code: 'conflict', details: { revision: 42, secret: '[redacted]', nested: { token: '[redacted]' } } })
      if (!('details' in error)) throw new Error('Expected remote error details')
      const output = Schema.decodeUnknownSync(multiHostApi.methods.runtimePeerRead.output)({
        ok: false,
        code: 'conflict',
        message: 'Conflict',
        details: error.details,
      })
      expect(output).toMatchObject({ details: { revision: 42, secret: '[redacted]' } })
      details = { text: 'x'.repeat(9000) }
      const oversized = await opened.call(Effect.flip(opened.gateway.pluginApi({ packageId: '@dshfiles/example', apiId: 'example', version: 1 })('read')))
      expect(oversized).not.toHaveProperty('details')
    } finally {
      await opened.close()
      server.close()
      await once(server, 'close')
    }
  })
})
