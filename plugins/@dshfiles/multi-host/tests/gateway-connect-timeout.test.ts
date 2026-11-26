import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { Duration, Effect } from 'effect'
import { FetchHttpClient } from 'effect/http'
import * as Schema from 'effect/Schema'
import { connectGateway } from '../src/connectors/gateway.js'

const addressSchema = Schema.Struct({ port: Schema.Number })

describe('gateway connect', () => {
  const held: Socket[] = []
  let server: Server | undefined

  afterEach(async () => {
    for (const socket of held) socket.destroy()
    held.length = 0
    await new Promise<void>(resolve => (server === undefined ? resolve() : server.close(() => resolve())))
    server = undefined
  })

  test('a runtime that accepts the connection but never answers fails as unreachable within the connect timeout', async () => {
    server = createServer(socket => {
      held.push(socket)
    })
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
    const port = Schema.decodeUnknownSync(addressSchema)(server.address()).port
    const launchUrl = `http://127.0.0.1:${port}/?token=fixture-token-12345678`
    const startedAt = Date.now()

    const error = await Effect.runPromise(
      Effect.flip(
        Effect.scoped(
          connectGateway({
            launchUrl,
            connectTimeout: Duration.millis(200),
            transport: origin => Effect.succeed({ origin: origin.origin, launchUrl, closed: Effect.never }),
          }),
        ),
      ).pipe(Effect.provide(FetchHttpClient.layer)),
    )

    expect(error._tag).toBe('GatewayUnreachable')
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })
})
