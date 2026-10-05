const origin = process.env.MH_ORIGIN
const token = process.env.MH_TOKEN
const res = await fetch(`${origin}/?token=${token}`, { redirect: 'manual' })
const cookie = res.headers.getSetCookie().map(c => c.split(';', 1)[0]).join('; ')
console.log('cookie bytes', cookie.length)
const body = JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'dshx-2c5a0dae/read', payload: { version: 1, input: {} } })
for (const ct of ['application/json', 'application/json; charset=utf-8']) {
  const r = await fetch(`${origin}/api/dshx-2c5a0dae/read`, { method: 'POST', headers: { 'content-type': ct, cookie }, body })
  console.log(ct, r.status, (await r.text()).slice(0, 200))
}
