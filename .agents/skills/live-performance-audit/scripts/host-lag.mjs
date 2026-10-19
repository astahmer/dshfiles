// Ping a ~4 ms Host RPC every 100 ms; a slow answer means the Host event loop was blocked, whatever the endpoint.
// Usage: node host-lag.mjs [seconds=60]   (reads ~/.dsh/runtime/web-url, or LAUNCH_URL)
import { readFileSync } from 'node:fs'

const url = process.env.LAUNCH_URL ?? readFileSync(`${process.env.HOME}/.dsh/runtime/web-url`, 'utf8').trim()
const response = await fetch(url, { redirect: 'manual' })
const cookie = response.headers
  .getSetCookie()
  .map(value => value.split(';')[0])
  .join('; ')
const end = Date.now() + Number(process.argv[2] ?? 60) * 1000
const samples = []
while (Date.now() < end) {
  const started = performance.now()
  const answer = await fetch(`${new URL(url).origin}/api/credentials/describe`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: 'credentials/describe',
      payload: { args: { refs: ['DEEPSEEK_API_KEY'] } },
    }),
  })
  await answer.text()
  samples.push({ at: new Date().toISOString().slice(11, 19), ms: Math.round(performance.now() - started) })
  await new Promise(resolve => setTimeout(resolve, 100))
}
const sorted = samples.map(sample => sample.ms).sort((left, right) => left - right)
const quantile = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
console.log(`n=${samples.length} p50=${quantile(0.5)} p90=${quantile(0.9)} p99=${quantile(0.99)} max=${sorted.at(-1)}`)
console.log(
  'stalls >250 ms:',
  samples
    .filter(sample => sample.ms > 250)
    .map(sample => `${sample.at}:${sample.ms}`)
    .join(' '),
)
