import assert from 'node:assert/strict'

const origin = process.env.MH_ORIGIN
const token = process.env.MH_TOKEN
const res = await fetch(`${origin}/?token=${token}`, { redirect: 'manual' })
const cookie = res.headers.getSetCookie().map(c => c.split(';', 1)[0]).join('; ')
assert.ok(cookie, 'exchange must authenticate')
const api = async (ns, m, a) => {
  const r = await fetch(`${origin}/api/${encodeURIComponent(ns)}/${encodeURIComponent(m)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `${ns}/${m}`, payload: { args: a } }),
  })
  return r.json()
}
const catalog = await api('pluginManager', 'listPlugins', {})
const rows = catalog.result?.value ?? []
const plugin = rows.find(row => String(row.entryId ?? '').includes('ai-accounts'))
console.log('plugin', JSON.stringify(plugin))

const stableHash = value => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
for (const packageId of ['@dshfiles/ai-accounts']) {
  const channel = `/dshx-${stableHash(`${packageId}\0ai-accounts`)}`
  const raw = await fetch(`${origin}${channel}/read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `${channel.slice(1)}/read`, payload: { args: {} } }),
  })
  const text = await raw.text()
  console.log(packageId, channel, raw.status, text.slice(0, 700))
}
