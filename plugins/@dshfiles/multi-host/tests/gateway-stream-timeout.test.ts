import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { exitCode } from './fixtures/ssh-runtime.js'
import { openGateway } from './fixtures/gateway-runtime.js'

const addressSchema = Schema.Struct({ port: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65_535)) })

const settleTicks = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 20))
}

describe('runtime stream follow', () => {
  const held: Socket[] = []
  let server: Server | undefined

  afterEach(async () => {
    for (const socket of held) socket.destroy()
    held.length = 0
    await new Promise<void>(resolve => (server === undefined ? resolve() : server.close(() => resolve())))
    server = undefined
  })

  test('times out a stream whose handshake never completes without an unhandled socket error', async () => {
    server = createServer((request, response) => {
      response.writeHead(303, { location: '/', 'set-cookie': 'dsh-session=test; Path=/; HttpOnly' })
      response.end()
    })
    server.on('upgrade', (_request, socket: Socket) => {
      held.push(socket)
    })
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
    const address = Schema.decodeUnknownResult(addressSchema)(server.address())
    if (address._tag === 'Failure') throw new Error('The loopback fixture did not bind.')
    const launchUrl = `http://127.0.0.1:${address.success.port}/?token=fixture-token-12345678`
    const opened = await openGateway(launchUrl)

    expect(exitCode(await Effect.runPromiseExit(opened.gateway.follow({ endpoint: 'session/state', args: {}, timeout: 30 })))).toBe('stream-timeout')
    await settleTicks()
    await opened.close()
  })
})
