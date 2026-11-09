import { createEnrollmentFixture } from './enrollment.mjs'

// Fixture boundary only: the caller must authenticate TLS termination and construct the request URL itself.
export const createPairingSessionAdapter = ({ core, origin, trustedTlsTermination }) => {
  const allowed = new URL(origin)
  if (
    trustedTlsTermination !== true ||
    allowed.protocol !== 'https:' ||
    allowed.username ||
    allowed.password ||
    allowed.pathname !== '/' ||
    allowed.search ||
    allowed.hash
  )
    throw new Error('Explicit trusted TLS termination and secure origin required')
  const enrollment = createEnrollmentFixture({ core, origin: allowed.origin })
  const respond = (status, headers = {}) =>
    new Response(null, {
      status,
      headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers },
    })
  const handle = async request => {
    const url = new URL(request.url)
    if (url.origin !== allowed.origin || request.headers.get('host') !== allowed.host || request.headers.get('origin') !== allowed.origin || url.search)
      return respond(403)
    if (url.pathname === '/pair/claim' || url.pathname === '/pair/redeem') return enrollment.handle(request)
    if (url.pathname !== '/pair/session') return respond(404)
    if (request.method !== 'POST') return respond(405, { allow: 'POST' })
    if (request.body || (request.headers.has('content-length') && request.headers.get('content-length') !== '0') || request.headers.has('transfer-encoding'))
      return respond(400)
    const cookies = (request.headers.get('cookie') || '').split(';').map(cookie => cookie.trim())
    const devices = cookies.filter(cookie => cookie.startsWith('__Host-pairing_device='))
    if (devices.length !== 1) return respond(403)
    const value = devices[0].slice('__Host-pairing_device='.length)
    const match = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(value)
    if (!match) return respond(403)
    try {
      const session = await core.openSession({ deviceId: match[1], credential: match[2] })
      if (!session) return respond(403)
      const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000))
      return respond(204, { 'set-cookie': `pairing_session=${session.secret}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict` })
    } catch {
      return respond(503)
    }
  }
  return { desktop: enrollment.desktop, handle }
}
