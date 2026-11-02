import { createServer, type Server } from 'node:http'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { Effect, Exit, Layer, Scope, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { afterEach, describe, expect, it } from 'vitest'
import { connectGateway } from './gateway.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

const portSchema = Schema.Struct({ port: Schema.Number.check(Schema.isInt()) })

/** A loopback runtime that hands out a session cookie and rejects every API call as expired. */
const startRuntime = async (): Promise<string> => {
  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.writeHead(303, { location: '/', 'set-cookie': 'dsh-session=synthetic; HttpOnly' }).end()
      return
    }
    response.writeHead(401).end()
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${String(Schema.decodeUnknownSync(portSchema)(server.address()).port)}`
}

describe('multi-host connector spans', () => {
  it('records one <namespace>/<method> gateway span with the outcome code, never the arguments', async () => {
    const origin = await startRuntime()
    const scope = Effect.runSync(Scope.make())
    const services = Layer.mergeAll(FetchHttpClient.layer, tracerLayer)
    const gateway = await Effect.runPromise(
      Scope.provide(scope)(
        connectGateway({ launchUrl: `${origin}/?token=synthetic-token`, transport: () => Effect.succeed({ origin, closed: Effect.never }) }),
      ).pipe(Effect.provide(services)),
    )
    using recorder = recordSpans()
    const failure = await Effect.runPromise(
      Effect.flip(gateway.run({ namespace: 'session', method: 'list', args: { secretArgument: 'synthetic-argument' } })).pipe(Effect.provide(services)),
    )
    expect(failure._tag).toBe('AuthenticationExpired')
    const span = recorder.span('session/list')
    expect(span.kind).toBe('client')
    expect(span.attributes).toMatchObject({ 'rpc.service': 'session', 'rpc.method': 'list', 'multi_host.outcome': 'authentication-expired' })
    expect(span.status.code).toBe('error')
    expect(JSON.stringify(span.attributes)).not.toMatch(/synthetic-argument|synthetic-token/)
    await Effect.runPromise(Scope.close(scope, Exit.void))
  })
})
