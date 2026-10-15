import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { apiChannel } from '../src/api/common.js'
import { connectMultiHost } from '../src/platform/dshx-channel.js'

let server: Server | undefined

afterEach(async () => {
  if (server === undefined) return
  const closed = once(server.close(), 'close')
  server = undefined
  await closed
})

describe('multi-host headless API client', () => {
  test('authenticates once and calls the versioned API without putting the token in its route', async () => {
    let origin: string | undefined
    let apiCookie: string | undefined
    const apiRequests: unknown[] = []
    const channel = apiChannel('@dshfiles/multi-host', 'multi-host').slice(1)
    server = createServer(async (request, response) => {
      if (request.url === '/?token=launch-token') {
        response.writeHead(302, { location: '/', 'set-cookie': 'dsh-session=synthetic; Path=/; HttpOnly' })
        response.end()
        return
      }
      if (request.url !== `/api/${channel}/list` && request.url !== `/api/${channel}/runtimeUpsert`) {
        response.writeHead(404)
        response.end()
        return
      }
      apiCookie = request.headers.cookie
      const body: Buffer[] = []
      for await (const chunk of request) body.push(Buffer.from(chunk))
      const apiRequest = JSON.parse(Buffer.concat(body).toString('utf8'))
      apiRequests.push(apiRequest)
      const rpcId = typeof apiRequest === 'object' && apiRequest !== null && 'rpcId' in apiRequest ? apiRequest.rpcId : ''
      response.writeHead(200, { 'content-type': 'application/json' })
      const output =
        request.url === `/api/${channel}/runtimeUpsert`
          ? { ok: false, code: 'identity-unavailable', message: 'The connected runtime did not provide the multi-host identity API.' }
          : { hosts: [], runtimes: [] }
      response.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value: { version: 1, output } } }))
    })
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('The synthetic API server did not bind TCP.')
    origin = `http://127.0.0.1:${address.port}`

    const client = await connectMultiHost({ url: `${origin}/?token=launch-token` })
    await expect(client.list()).resolves.toEqual({ hosts: [], runtimes: [] })
    await expect(
      client.runtimeUpsert({
        hostId: 'vps-check',
        name: 'VPS runtime',
        locator: { kind: 'local', launchUrl: 'http://127.0.0.1:40123/?token=synthetic-runtime-token' },
      }),
    ).resolves.toEqual({ ok: false, code: 'identity-unavailable', message: 'The connected runtime did not provide the multi-host identity API.' })

    expect(apiCookie).toBe('dsh-session=synthetic')
    expect(apiRequests[0]).toMatchObject({ type: 'client-request', method: `${channel}/list`, payload: { version: 1 } })
    expect(apiRequests[1]).toMatchObject({ type: 'client-request', method: `${channel}/runtimeUpsert`, payload: { version: 1 } })
  })
})
