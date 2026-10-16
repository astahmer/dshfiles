import assert from 'node:assert/strict'
import { createServer, request as requestHttp } from 'node:http'
import test from 'node:test'
import { z } from 'zod'
import { startMutationResponseProxy } from './mutation-response-proxy.mjs'

const loopbackAddressSchema = z.object({ port: z.number().int().min(1).max(65_535) })
const sessionListSchema = z.object({
  result: z.object({ ok: z.literal(true), value: z.object({ items: z.array(z.object({ sessionId: z.string() })) }) }),
})

const listenLoopback = async server => {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = loopbackAddressSchema.safeParse(server.address())
  if (!address.success) throw new Error('The loopback upstream did not bind a TCP port.')
  return address.data.port
}

const closeServer = async server => {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise((resolveClose, rejectClose) => {
    server.close(error => (error ? rejectClose(error) : resolveClose()))
  })
}

test('scratch mutation proxy drops one admitted create reply and bounds loopback traffic', { timeout: 30_000 }, async () => {
  const upstreamState = { createRequests: 0, listRequests: 0, handoffRequests: 0, bodyRequests: 0 }
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/?token=scratch-token') {
      upstreamState.handoffRequests += 1
      response
        .writeHead(303, {
          location: 'https://example.invalid/handoff',
          'set-cookie': 'dsh-session=scratch; Path=/; HttpOnly; SameSite=Lax',
        })
        .end()
      return
    }
    if (request.method === 'POST' && request.url === '/api/session/create') {
      upstreamState.createRequests += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ result: { ok: true, value: { sessionId: 'scratch-session' } } }))
      return
    }
    if (request.method === 'POST' && request.url === '/api/session/list') {
      upstreamState.listRequests += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ result: { ok: true, value: { items: [{ sessionId: 'scratch-session' }] } } }))
      return
    }
    if (request.url === '/accept-body') {
      upstreamState.bodyRequests += 1
      request.resume()
      response.writeHead(204).end()
      return
    }
    if (request.url === '/external-redirect') {
      response.writeHead(302, { location: 'https://example.invalid/outside' }).end()
      return
    }
    if (request.url === '/location-hint') {
      response.writeHead(200, { location: 'https://example.invalid/hint' }).end('ok')
      return
    }
    if (request.url === '/oversized') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(Buffer.alloc(4_194_305))
      return
    }
    response.writeHead(404).end()
  })

  try {
    const upstreamPort = await listenLoopback(server)
    const proxy = await startMutationResponseProxy({ upstreamPort })
    try {
      const proxyOrigin = `http://127.0.0.1:${proxy.port}`
      await assert.rejects(fetch(`${proxyOrigin}/api/session/create`, { method: 'POST', body: '{}' }))
      assert.deepEqual(proxy.state(), {
        mutationRequests: 1,
        droppedResponses: 1,
        committedSessionIds: ['scratch-session'],
      })
      assert.equal(upstreamState.createRequests, 1)

      const listResponse = await fetch(`${proxyOrigin}/api/session/list`, { method: 'POST', body: '{}' })
      assert.equal(listResponse.status, 200)
      const sessionList = sessionListSchema.parse(await listResponse.json())
      assert.deepEqual(
        sessionList.result.value.items.map(item => item.sessionId),
        ['scratch-session'],
      )
      assert.equal(upstreamState.listRequests, 1)
      assert.equal(upstreamState.createRequests, 1)

      const handoffResponse = await fetch(`${proxyOrigin}/?token=scratch-token`, { redirect: 'manual' })
      assert.equal(handoffResponse.status, 303)
      assert.deepEqual(handoffResponse.headers.getSetCookie(), ['dsh-session=scratch; Path=/; HttpOnly; SameSite=Lax'])
      assert.equal(handoffResponse.headers.get('location'), null)
      assert.equal(upstreamState.handoffRequests, 1)

      const redirectResponse = await fetch(`${proxyOrigin}/external-redirect`, { redirect: 'manual' })
      assert.equal(redirectResponse.status, 502)
      assert.equal(redirectResponse.headers.get('location'), null)
      const locationHintResponse = await fetch(`${proxyOrigin}/location-hint`, { redirect: 'manual' })
      assert.equal(locationHintResponse.status, 200)
      assert.equal(locationHintResponse.headers.get('location'), null)
      const originProbe = await new Promise((resolveResponse, rejectResponse) => {
        const request = requestHttp({ hostname: '127.0.0.1', port: proxy.port, path: `//127.0.0.1:${upstreamPort}/blocked` }, resolveResponse)
        request.once('error', rejectResponse)
        request.end()
      })
      assert.equal(originProbe.statusCode, 400)
      originProbe.resume()
      assert.equal(upstreamState.bodyRequests, 0)

      await assert.rejects(fetch(`${proxyOrigin}/accept-body`, { method: 'POST', body: Buffer.alloc(1_048_577) }))
      assert.equal(upstreamState.bodyRequests, 0)
      await assert.rejects(fetch(`${proxyOrigin}/oversized`))
      assert.equal(upstreamState.createRequests, 1)
    } finally {
      await proxy.close()
    }
  } finally {
    await closeServer(server)
  }
})
