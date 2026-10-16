import { createServer } from 'node:http'
import { z } from 'zod'

const boundPortSchema = z.object({ port: z.number().int().min(1).max(65_535) })
const committedSessionSchema = z
  .object({
    result: z.object({
      ok: z.literal(true),
      value: z.object({ sessionId: z.string().min(1) }).passthrough(),
    }),
  })
  .passthrough()
const excludedResponseHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'location',
  'set-cookie',
  'transfer-encoding',
  'upgrade',
])
const excludedRequestHeaders = new Set(['connection', 'content-length', 'host', 'keep-alive', 'transfer-encoding', 'upgrade'])
const maxRequestBytes = 1_048_576
const maxResponseBytes = 4_194_304

const readRequestBody = async request => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxRequestBytes) {
      request.destroy()
      throw new Error('The scratch mutation proxy request exceeded its body limit.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

const readResponseBody = async response => {
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return Buffer.concat(chunks)
      size += chunk.value.byteLength
      if (size > maxResponseBytes) {
        await reader.cancel()
        throw new Error('The scratch mutation proxy response exceeded its body limit.')
      }
      chunks.push(Buffer.from(chunk.value))
    }
  } finally {
    reader.releaseLock()
  }
}

export const startMutationResponseProxy = async ({ upstreamPort }) => {
  const validatedUpstreamPort = z.number().int().min(1).max(65_535).parse(upstreamPort)
  const upstreamOrigin = `http://127.0.0.1:${validatedUpstreamPort}`
  const state = { mutationRequests: 0, droppedResponses: 0, committedSessionIds: [] }
  const server = createServer(async (request, response) => {
    try {
      const proxyAddress = boundPortSchema.safeParse(server.address())
      if (!proxyAddress.success) throw new Error('The scratch mutation proxy is not bound.')
      const proxyOrigin = `http://127.0.0.1:${proxyAddress.data.port}`
      const target = new URL(request.url ?? '/', proxyOrigin)
      if (target.origin !== proxyOrigin) {
        response.writeHead(400).end()
        return
      }

      const method = request.method ?? 'GET'
      const body = await readRequestBody(request)
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined || excludedRequestHeaders.has(name.toLowerCase())) continue
        headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }

      const isSessionCreate = method === 'POST' && target.pathname === '/api/session/create'
      const launchToken = target.searchParams.get('token')
      const isLaunchHandoff = method === 'GET' && target.pathname === '/' && target.searchParams.size === 1 && launchToken !== null && launchToken.length > 0
      if (isSessionCreate) state.mutationRequests += 1
      const upstreamResponse = await fetch(new URL(`${target.pathname}${target.search}`, upstreamOrigin), {
        method,
        headers,
        redirect: 'manual',
        body: method === 'GET' || method === 'HEAD' ? null : body,
      })
      const isExpectedHandoffStatus = isLaunchHandoff && (upstreamResponse.status === 302 || upstreamResponse.status === 303)
      if (upstreamResponse.status >= 300 && upstreamResponse.status < 400 && !isExpectedHandoffStatus) {
        await upstreamResponse.body?.cancel()
        response.writeHead(502).end()
        return
      }
      const upstreamBody = await readResponseBody(upstreamResponse)
      if (isSessionCreate) {
        let responseBody
        try {
          responseBody = committedSessionSchema.safeParse(JSON.parse(upstreamBody.toString('utf8')))
        } catch {
          responseBody = undefined
        }
        if (responseBody?.success === true) {
          state.committedSessionIds.push(responseBody.data.result.value.sessionId)
          if (state.droppedResponses === 0) {
            state.droppedResponses += 1
            response.destroy()
            return
          }
        }
      }

      const responseHeaders = {}
      upstreamResponse.headers.forEach((value, name) => {
        if (!excludedResponseHeaders.has(name.toLowerCase())) responseHeaders[name] = value
      })
      const cookies = upstreamResponse.headers.getSetCookie()
      if (cookies.length > 0) responseHeaders['set-cookie'] = cookies
      response.writeHead(upstreamResponse.status, responseHeaders)
      response.end(upstreamBody)
    } catch {
      response.destroy()
    }
  })

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = boundPortSchema.safeParse(server.address())
  if (!address.success) {
    await new Promise(resolveClose => server.close(resolveClose))
    throw new Error('Could not bind the scratch mutation proxy to loopback.')
  }

  let closed = false
  return {
    port: address.data.port,
    state: () => ({ ...state, committedSessionIds: [...state.committedSessionIds] }),
    async close() {
      if (closed) return
      closed = true
      server.closeAllConnections()
      await new Promise((resolveClose, rejectClose) => {
        server.close(error => (error ? rejectClose(error) : resolveClose()))
      })
    },
  }
}
