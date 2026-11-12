/**
 * What the phone sees on the pairing origin: the pairing page, the "already paired" page, the recovery page
 * for a cookie that no longer pairs, and the words for every refused code. Static HTML, one external script, no inline
 * script, so the gateway's CSP stays `script-src 'self'`.
 */
import type { RedeemRefusal } from './store.ts'

/** A redeem the gateway refused before it reached the store. */
export type GatewayRefusal = RedeemRefusal | 'invalid'

/** What the phone page says for each refused code, with what to do next. */
export const refusalMessage = {
  used: 'This code was already used to pair a device. Open Pair a phone on your computer again for a new code, then type it.',
  expired: 'This code expired. Open Pair a phone on your computer again for a new code, then type it.',
  replaced: 'A newer code replaced this one. Type the code Pair a phone shows now on your computer.',
  wrong: 'That code does not match. Check the 6 digits in Pair a phone on your computer and try again.',
  'rate-limited': 'Too many tries in the last minute. Wait a minute, then type the code again.',
  'device-limit':
    'This DSH already has the most paired devices it allows. On your computer, ask the agent to list them (phone_pairing_status) and revoke one, then try again.',
  invalid: 'Pairing failed. Scan the QR code in Pair a phone again, or type its 6-digit code.',
} as const satisfies Readonly<Record<GatewayRefusal, string>>

/** HTTP status for each refusal: 403 for a code that does not pair, 429 and 409 for the two limits. */
const refusalStatusCode = {
  used: 403,
  expired: 403,
  replaced: 403,
  wrong: 403,
  'rate-limited': 429,
  'device-limit': 409,
  invalid: 400,
} as const satisfies Record<GatewayRefusal, number>

export const refusalStatus = (reason: GatewayRefusal): number => refusalStatusCode[reason]

const shell = (title: string, body: string, script = ''): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:3rem 1.25rem;max-width:26rem;margin-inline:auto}input{font:inherit;letter-spacing:.4em;padding:.75rem;width:100%;box-sizing:border-box;text-align:center}button,.action{display:block;box-sizing:border-box;font:inherit;margin-top:1rem;padding:.75rem 1.25rem;width:100%;min-height:44px;text-align:center;border-radius:.5rem;border:1px solid currentColor;color:inherit;background:none;text-decoration:none}#status{margin-top:1rem}[hidden]{display:none!important}[data-reason]{font-weight:600}</style>
</head><body><main>${body}</main>${script}</body></html>`

/** The pairing page: the QR link redeems by itself, the form takes the typed code. */
export const pairPage = shell(
  'Pair phone',
  `<h1>Pair this phone</h1><p id="status" role="status">Enter the 6-digit code shown in Pair a phone on your computer.</p>
<form id="form"><input id="code" aria-label="Pairing code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button type="submit">Pair</button></form>
<a id="open" class="action" href="/" hidden>Open DSH</a>`,
  '<script src="/pair/landing.js" defer></script>',
)

/** A phone whose device cookie still works: no code to type, one way in. */
export const pairedPage = shell(
  'Phone paired',
  `<h1>This phone is already paired</h1><p role="status">It stays signed in to this DSH. You do not need a new code.</p><a class="action" href="/">Open DSH</a>`,
)

/** A request with a device cookie this DSH no longer accepts (revoked, expired, or paired with another DSH home). */
export const unpairedPage = shell(
  'Pair phone again',
  `<h1>Pair this phone again</h1><p role="alert">This phone's pairing is no longer valid: it was revoked, expired, or made by another DSH.</p><p>On your computer, open Pair a phone, then scan its QR code or type its 6-digit code here.</p><a class="action" href="/pair">Pair this phone</a>`,
)

export const landingScript = `(() => {
  const status = document.querySelector('#status')
  const form = document.querySelector('#form')
  const input = document.querySelector('#code')
  const open = document.querySelector('#open')
  const fragment = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const parameters = new URLSearchParams(fragment)
  const id = parameters.get('id')
  const secret = parameters.get('secret')
  const say = (text, reason) => {
    status.textContent = text
    if (reason === undefined) status.removeAttribute('data-reason')
    else status.setAttribute('data-reason', reason)
  }
  const done = async response => {
    const body = await response.json().catch(() => ({}))
    if (response.ok && body.paired === true) {
      say(body.message || 'Paired. Opening DSH…')
      form.hidden = true
      open.hidden = false
      location.replace('/')
      return
    }
    say(body.message || 'Pairing failed. Scan the QR code in Pair a phone again, or type its 6-digit code.', body.reason || 'failed')
    input.value = ''
    input.focus()
  }
  const submit = body => {
    say('Pairing…')
    return fetch('/pair/redeem', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
      .then(done)
      .catch(() => say('Could not reach DSH. Check this phone can reach your computer (Tailscale on), then try again.', 'offline'))
  }
  if (id && secret && [...parameters.keys()].sort().join(',') === 'id,secret') { submit({ id, secret }); return }
  form.addEventListener('submit', event => { event.preventDefault(); if (/^[0-9]{6}$/.test(input.value)) submit({ code: input.value }) })
})()`

/** A top-level page load, as opposed to a fetch, script or socket: only those get an HTML recovery page. */
export const wantsPage = (
  headers: { readonly accept?: string | undefined; readonly 'sec-fetch-dest'?: string | string[] | undefined },
  method: string | undefined,
): boolean => {
  if (method !== 'GET' && method !== 'HEAD') return false
  const dest = headers['sec-fetch-dest']
  if (typeof dest === 'string') return dest === 'document'
  return (headers.accept ?? '').includes('text/html')
}
