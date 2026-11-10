import http from 'node:http'

// Experimental test fixture only. It is not wired into the DSH host.
export const createTestProxy = ({ core, upstream, upstreamCookie, origin, trustedTlsTermination, websocketPath = '/api/remote.mux' }) => {
  const target = new URL(upstream)
  const allowed = new URL(origin)
  if (
    typeof websocketPath !== 'string' ||
    !/^\/(?!\/)[^?#\\\x00-\x20\x7f]*$/.test(websocketPath) ||
    target.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.pathname !== '/' ||
    target.search ||
    target.hash ||
    (allowed.protocol !== 'http:' && !(allowed.protocol === 'https:' && trustedTlsTermination === true)) ||
    target.username ||
    target.password ||
    allowed.username ||
    allowed.password ||
    allowed.pathname !== '/' ||
    allowed.search ||
    allowed.hash ||
    typeof upstreamCookie !== 'string' ||
    !upstreamCookie ||
    /[\r\n]/.test(upstreamCookie)
  )
    throw new Error('Invalid proxy configuration')
  const active = new Set()
  const revoking = new Map()
  const authorized = request => {
    if (request.headers.host !== allowed.host || (request.headers.origin && request.headers.origin !== allowed.origin)) return null
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== allowed.origin) return null
    const cookies = (request.headers.cookie || '').split(';').map(entry => entry.trim())
    const sessions = cookies.filter(entry => entry.startsWith('pairing_session='))
    if (sessions.length !== 1) return null
    const secret = sessions[0].slice('pairing_session='.length)
    const session = core.authenticateSession({ secret })
    return session && !revoking.has(session.deviceId) && { secret, ...session }
  }
  const validPath = path => {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\#\x00-\x20\x7f]/.test(path)) return false
    return ![...new URLSearchParams(path.split('?').slice(1).join('?')).keys()].some(name => name.toLowerCase() === 'token')
  }
  const stripHopHeaders = headers => {
    const connectionHeaders = (headers.connection || '').split(',').map(name => name.trim().toLowerCase())
    for (const name of [
      ...connectionHeaders,
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
    ])
      delete headers[name]
  }
  const headersFor = (request, upgrade = false) => {
    const headers = { ...request.headers }
    stripHopHeaders(headers)
    for (const name of Object.keys(headers)) {
      if (
        name === 'authorization' ||
        name === 'referer' ||
        name === 'forwarded' ||
        name === 'x-real-ip' ||
        name === 'x-original-url' ||
        name === 'x-rewrite-url' ||
        name.startsWith('x-forwarded-') ||
        name.startsWith('proxy-')
      )
        delete headers[name]
    }
    headers.host = target.host
    headers.cookie = upstreamCookie
    if (headers.origin) headers.origin = target.origin
    if (upgrade) {
      headers.connection = 'Upgrade'
      headers.upgrade = 'websocket'
    }
    return headers
  }
  const track = (session, sockets) => {
    const entry = { ...session, sockets }
    active.add(entry)
    const timer = setTimeout(() => sockets.forEach(socket => socket.destroy()), Math.max(0, session.expiresAt - Date.now()))
    timer.unref()
    sockets[0].once('close', () => {
      clearTimeout(timer)
      active.delete(entry)
      sockets.slice(1).forEach(socket => socket.destroy())
    })
    return entry
  }
  const previousRevoke = core.revokeDevice
  const previousRedeem = core.redeemEnrollment
  const previousClose = core.closeSession
  core.redeemEnrollment = async input => {
    try {
      return await previousRedeem(input)
    } catch (error) {
      for (const entry of active) entry.sockets.forEach(socket => socket.destroy())
      throw error
    }
  }
  core.revokeDevice = async input => {
    revoking.set(input.deviceId, (revoking.get(input.deviceId) || 0) + 1)
    for (const entry of active) if (entry.deviceId === input.deviceId) entry.sockets.forEach(socket => socket.destroy())
    try {
      return await previousRevoke(input)
    } catch (error) {
      for (const entry of active) entry.sockets.forEach(socket => socket.destroy())
      throw error
    } finally {
      const remaining = revoking.get(input.deviceId) - 1
      if (remaining) revoking.set(input.deviceId, remaining)
      else revoking.delete(input.deviceId)
    }
  }
  core.closeSession = input => {
    const result = previousClose(input)
    if (result) for (const entry of active) if (entry.secret === input.secret) entry.sockets.forEach(socket => socket.destroy())
    return result
  }
  const server = http.createServer((request, response) => {
    const session = authorized(request)
    if (!session || !validPath(request.url)) {
      response.writeHead(403).end()
      return
    }
    const outgoing = http.request(
      { hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port, method: request.method, path: request.url, headers: headersFor(request) },
      incoming => {
        if (!core.authenticateSession(session)) {
          incoming.destroy()
          response.destroy()
          return
        }
        const headers = { ...incoming.headers }
        delete headers['set-cookie']
        stripHopHeaders(headers)
        response.writeHead(incoming.statusCode, headers)
        incoming.pipe(response)
      },
    )
    track(session, [response, outgoing])
    outgoing.on('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    request.pipe(outgoing)
  })
  server.on('upgrade', (request, socket, head) => {
    const session = authorized(request)
    if (
      !session ||
      request.headers.origin !== allowed.origin ||
      request.method !== 'GET' ||
      !validPath(request.url) ||
      request.url.split('?')[0] !== websocketPath ||
      request.headers.upgrade?.toLowerCase() !== 'websocket'
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const outgoing = http.request({
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port,
      method: request.method,
      path: request.url,
      headers: headersFor(request, true),
    })
    track(session, [socket, outgoing])
    outgoing.on('upgrade', (incoming, upstreamSocket, upstreamHead) => {
      if (!core.authenticateSession(session)) {
        upstreamSocket.destroy()
        socket.destroy()
        return
      }
      const entry = [...active].find(candidate => candidate.sockets[0] === socket)
      if (!entry) {
        upstreamSocket.destroy()
        return
      }
      entry.sockets.push(upstreamSocket)
      const headers = Object.entries(incoming.headers)
        .filter(([name]) => name !== 'set-cookie')
        .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}\r\n`))
        .join('')
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`)
      if (upstreamHead.length) socket.write(upstreamHead)
      if (head.length) upstreamSocket.write(head)
      upstreamSocket.pipe(socket).pipe(upstreamSocket)
      upstreamSocket.on('error', () => socket.destroy())
      upstreamSocket.on('close', () => socket.destroy())
    })
    outgoing.on('response', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'))
    outgoing.on('error', () => socket.destroy())
    socket.on('error', () => outgoing.destroy())
    outgoing.end()
  })
  server.on('close', () => {
    for (const entry of active) entry.sockets.forEach(socket => socket.destroy())
    if (core.revokeDevice === wrappedRevoke) core.revokeDevice = previousRevoke
    if (core.redeemEnrollment === wrappedRedeem) core.redeemEnrollment = previousRedeem
    if (core.closeSession === wrappedClose) core.closeSession = previousClose
  })
  const wrappedRevoke = core.revokeDevice
  const wrappedRedeem = core.redeemEnrollment
  const wrappedClose = core.closeSession
  return server
}
