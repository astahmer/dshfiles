import { createServer } from 'node:http'
import { describe, expect, test } from 'vitest'
import * as Schema from 'effect/Schema'
import { SchemaFields } from '../src/schema.js'
import type { NativeRpcRequest } from '../src/api.js'
import { openGateway } from './fixtures/gateway-runtime.js'
import { NativeRpc } from '../src/native-rpc.js'
import { Effect } from 'effect'

const decodeValue = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown): S['Type'] => Schema.decodeUnknownSync(schema)(input)

/** Decode unknown input strictly: a decoded value, or a failure the test asserts on. */
const decodeStrict = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown) => {
  const result = Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(input)
  return result._tag === 'Success' ? { success: true as const, data: result.success } : { success: false as const, error: new Error(result.failure.message) }
}

/** Decode unknown input with Effect Schema's own defaults (excess properties ignored). */
const decodeLoose = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown) => {
  const result = Schema.decodeUnknownResult(schema)(input)
  return result._tag === 'Success' ? { success: true as const, data: result.success } : { success: false as const, error: new Error(result.failure.message) }
}

describe('native mutation outcome recovery', () => {
  const requestEnvelopeSchema = Schema.Struct({ rpcId: Schema.String }).pipe(SchemaFields.passthrough)
  const addressSchema = Schema.Struct({ port: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65_535)) })

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
          requestId = decodeValue(requestEnvelopeSchema, JSON.parse(body.join(''))).rpcId
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
    const address = Schema.decodeUnknownResult(addressSchema)(server.address())
    if (address._tag === 'Failure') throw new Error('The loopback fixture did not bind.')
    const launchUrl = `http://127.0.0.1:${address.success.port}/?token=fixture-token-12345678`
    const opened = await openGateway(launchUrl)
    const gateway = opened.gateway
    try {
      const createRequest: NativeRpcRequest = {
        namespace: 'session',
        method: 'create',
        args: { request: { cwd: '/tmp/multi-host-outcome-fixture' } },
      }
      const result = await opened.call(NativeRpc.call(gateway, createRequest).pipe(Effect.catch(error => Effect.succeed(NativeRpc.failureResult({ request: createRequest, error })))))
      expect(result).toEqual({
        ok: false,
        code: 'unknown-mutation-outcome',
        message: 'The connection failed after the mutation was sent. Outcome is unknown; inspect runtime state before retrying.',
      })
      expect(admittedSessionCount).toBe(1)
      const reconciled = await opened.call(gateway.run({ namespace: 'session', method: 'list', args: { _request: {} } }))
      expect(reconciled).toMatchObject({ items: [{ sessionId: 'admitted-session' }] })
      expect(admittedSessionCount).toBe(1)
    } finally {
      await opened.close()
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    }
  })
})
