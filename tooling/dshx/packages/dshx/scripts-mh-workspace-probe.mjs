const origin = process.env.MH_ORIGIN
const res = await fetch(`${origin}/?token=${process.env.MH_TOKEN}`, { redirect: 'manual' })
const cookie = res.headers
  .getSetCookie()
  .map(c => c.split(';', 1)[0])
  .join('; ')
const raw = async (ns, m, args) => {
  const r = await fetch(`${origin}/api/${encodeURIComponent(ns)}/${encodeURIComponent(m)}`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `${ns}/${m}`, payload: { args } }),
  })
  const text = await r.text()
  return { status: r.status, text: text.slice(0, 640) }
}
for (const [ns, m, argsEnc] of [
  ['workspace', 'create', { request: { path: process.env.MH_WS } }],
  ['workspace', 'list', { request: {} }],
  ['workspace', 'follow', {}],
  ['workspace', 'rename', { request: { workspaceId: 'x', title: 't' } }],
]) {
  const out = await raw(ns, m, argsEnc)
  if (out.status !== 404) console.log(ns, m, JSON.stringify(out).slice(0, 400))
}
