import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { connectGateway } from '../src/connectors/gateway.js'

const addressSchema = z.object({ port: z.number().int().min(0).max(65_535) })

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
    const address = addressSchema.safeParse(server.address())
    if (!address.success) throw new Error('The loopback fixture did not bind.')
    const launchUrl = `http://127.0.0.1:${address.data.port}/?token=fixture-token-12345678`
    const gateway = await connectGateway({
      launchUrl,
      createTransport: async origin => ({ origin: origin.origin, launchUrl, dispose: async () => {} }),
    })

    await expect(gateway.follow('session/state', {}, 30)).rejects.toMatchObject({ code: 'stream-timeout' })
    await settleTicks()
    await gateway.dispose()
  })
})
