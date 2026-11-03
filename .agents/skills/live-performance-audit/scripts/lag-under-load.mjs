// Host event-loop lag under a fixed synthetic load: the host-lag probe's 4 ms RPC every 100 ms, next to 0, 4 and 8
// concurrent `session/list` streams that keep the Host busy.
// Usage: node lag-under-load.mjs <launchUrl> [seconds]
const url = process.argv[2]
if (url === undefined) throw new Error('Usage: node lag-under-load.mjs <launchUrl> [seconds]')
const seconds = Number(process.argv[3] ?? 20)

const landing = await fetch(url, { redirect: 'manual' })
const cookie = landing.headers
  .getSetCookie()
  .map(value => value.split(';')[0])
  .join('; ')
const origin = new URL(url).origin

const probeRpc = () =>
  fetch(`${origin}/api/credentials/describe`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: 'credentials/describe',
      payload: { args: { refs: ['DEEPSEEK_API_KEY'] } },
    }),
  }).then(answer => answer.text())

const listSessions = async () => {
  const answer = await fetch(`${origin}/api/session/list`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: 'session/list',
      payload: { args: { _request: {} } },
    }),
  })
  return (await answer.text()).length
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

const probe = async ({ label, concurrency }) => {
  const samples = []
  const end = Date.now() + seconds * 1000
  const loaders = Array.from({ length: concurrency }, async () => {
    while (Date.now() < end) await listSessions()
  })
  while (Date.now() < end) {
    const started = performance.now()
    await probeRpc()
    samples.push(Math.round(performance.now() - started))
    await new Promise(done => setTimeout(done, 100))
  }
  await Promise.all(loaders)
  const sorted = [...samples].sort((left, right) => left - right)
  console.log(
    JSON.stringify({
      label,
      concurrency,
      n: samples.length,
      p50: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      p99: quantile(sorted, 0.99),
      max: sorted.at(-1),
      over250: samples.filter(milliseconds => milliseconds > 250).length,
    }),
  )
}

await probe({ label: 'idle', concurrency: 0 })
await probe({ label: 'list x4', concurrency: 4 })
await probe({ label: 'list x8', concurrency: 8 })
