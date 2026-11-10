// Experimental fixture only. Do not register this with a production listener.
const script = `(() => {
  const fragment = location.hash.slice(1)
  history.replaceState(null, '', location.pathname + location.search)
  const parameters = new URLSearchParams(fragment)
  let id = parameters.get('id')
  let secret = parameters.get('secret')
  let claimSecret = null
  const status = document.querySelector('#status')
  const button = document.querySelector('#redeem')
  const clear = () => { id = null; secret = null; claimSecret = null }
  const fail = () => { clear(); button.hidden = true; status.textContent = 'Pairing failed. Start again on your desktop.' }
  const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
  const commitment = async claim => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dsh-pairing-claim-v1:' + claim))
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }
  const post = (path, body) => fetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if ([...parameters.keys()].sort().join(',') !== 'id,secret' || !id || !secret) { fail(); return }
  claimSecret = base64url(crypto.getRandomValues(new Uint8Array(32)))
  commitment(claimSecret).then(value => post('/pair/claim', { id, secret, commitment: value })).then(response => {
    if (!response.ok) { fail(); return }
    status.textContent = 'Waiting for approval on your desktop.'
    button.hidden = false
  }).catch(fail)
  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      const redeemed = await post('/pair/redeem', { id, secret, claimSecret })
      clear()
      if (!redeemed.ok) { fail(); return }
      status.textContent = 'Opening session…'
      const session = await post('/pair/session')
      if (!session.ok) { fail(); return }
      location.assign('/')
    } catch { fail() }
  }, { once: true })
})()`

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair phone</title></head>
<body><main><h1>Pair phone</h1><p id="status" role="status">Starting pairing…</p><button id="redeem" type="button" hidden>Continue after approval</button></main><script src="/pair/landing.js" defer></script></body></html>`

export const handleLandingFixture = request => {
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.search || !['/pair', '/pair/landing.js'].includes(url.pathname)) return new Response(null, { status: 404 })
  return new Response(url.pathname === '/pair' ? html : script, {
    headers: {
      'content-type': url.pathname === '/pair' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  })
}
