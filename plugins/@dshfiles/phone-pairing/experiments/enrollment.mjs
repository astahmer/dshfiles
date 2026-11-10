// Experimental fixture only: never register these handlers in the DSH host.
// A phone binds its own claim secret; the QR bearer alone cannot redeem after approval.
export const createEnrollmentFixture = ({ core, origin }) => {
  const allowed = new URL(origin)
  if (allowed.protocol !== 'https:' || allowed.username || allowed.password || allowed.pathname !== '/' || allowed.search || allowed.hash)
    throw new Error('Invalid secure origin')

  const desktop = Object.freeze({
    begin: ({ name }) => {
      const enrollment = core.beginEnrollment({ name })
      const url = new URL('/pair', allowed.origin)
      url.hash = new URLSearchParams({ id: enrollment.id, secret: enrollment.secret }).toString()
      return { url: url.href, id: enrollment.id, expiresAt: enrollment.expiresAt }
    },
    pending: () => core.pendingEnrollments().filter(entry => entry.commitment),
    approve: ({ id, commitment }) => core.approveEnrollment({ id, commitment }),
  })

  const respond = (status, headers = {}) =>
    new Response(null, {
      status,
      headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers },
    })

  const fields = (input, expected) =>
    !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== [...expected].sort().join(',')

  const handle = async request => {
    const url = new URL(request.url)
    if (
      url.origin !== allowed.origin ||
      !['/pair/claim', '/pair/redeem'].includes(url.pathname) ||
      url.search ||
      request.headers.get('origin') !== allowed.origin
    )
      return respond(403)
    if (request.method !== 'POST') return respond(405, { allow: 'POST' })
    if (request.headers.get('content-type') !== 'application/json') return respond(415)
    const declared = request.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024)) return respond(413)
    if (!request.body) return respond(400)
    const reader = request.body.getReader()
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 1024) {
          await reader.cancel()
          return respond(413)
        }
        chunks.push(value)
      }
      const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      if (url.pathname === '/pair/claim') {
        if (fields(input, ['commitment', 'id', 'secret'])) return respond(400)
        if (typeof input.id !== 'string' || typeof input.secret !== 'string' || typeof input.commitment !== 'string') return respond(400)
        return core.claimEnrollment(input) ? respond(204) : respond(403)
      }
      if (fields(input, ['claimSecret', 'id', 'secret'])) return respond(400)
      if (typeof input.id !== 'string' || typeof input.secret !== 'string' || typeof input.claimSecret !== 'string') return respond(400)
      const result = await core.redeemEnrollment(input)
      if (!result) return respond(403)
      return respond(204, {
        'set-cookie': `__Host-pairing_device=${result.deviceId}.${result.credential}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict`,
      })
    } catch {
      return respond(400)
    } finally {
      reader.releaseLock()
    }
  }
  return { desktop, handle }
}
