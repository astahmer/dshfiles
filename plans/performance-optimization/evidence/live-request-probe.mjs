import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

// Resolve Playwright from the main checkout's pnpm store; the probe never writes to the instance.
const require = createRequire('/Users/astahmer/dev/dshfiles/node_modules/.pnpm/playwright@1.56.1/node_modules/')
const { chromium } = require('playwright')

const url = readFileSync('/Users/astahmer/.dsh/runtime/web-url', 'utf8').trim()
const settleMs = Number(process.argv[2] ?? 30000)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')

const requests = new Map()
cdp.on('Network.requestWillBeSent', event => {
  requests.set(event.requestId, {
    url: event.request.url,
    method: event.request.method,
    postData: event.request.postData,
    initiator: event.initiator?.stack?.callFrames?.slice(0, 3).map(frame => `${frame.url.split('/').pop()}:${frame.lineNumber + 1}`),
    startTs: event.timestamp,
    wallTime: event.wallTime,
  })
})
cdp.on('Network.responseReceived', event => {
  const row = requests.get(event.requestId)
  if (!row) return
  row.status = event.response.status
  row.mimeType = event.response.mimeType
  row.headersAt = event.response.headers
  row.timing = event.response.timing
})
cdp.on('Network.loadingFinished', event => {
  const row = requests.get(event.requestId)
  if (!row) return
  row.encodedBytes = event.encodedDataLength
  row.totalMs = (event.timestamp - row.startTs) * 1000
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(settleMs)

const resources = await page.evaluate(() =>
  performance.getEntriesByType('resource').map(entry => ({
    name: entry.name,
    initiatorType: entry.initiatorType,
    startTime: Math.round(entry.startTime),
    requestStart: Math.round(entry.requestStart),
    responseStart: Math.round(entry.responseStart),
    responseEnd: Math.round(entry.responseEnd),
    durationMs: Math.round(entry.duration),
    serverMs: Math.round(entry.responseStart - entry.requestStart),
    transferBytes: entry.transferSize,
    decodedBytes: entry.decodedBodySize,
  })),
)

const byName = new Map()
for (const entry of resources) {
  const key = entry.name
  byName.set(key, (byName.get(key) ?? 0) + 1)
}

writeFileSync('/tmp/dsh-net-resources.json', JSON.stringify(resources, null, 1))
writeFileSync('/tmp/dsh-net-requests.json', JSON.stringify([...requests.values()], null, 1))

const api = resources.filter(entry => entry.name.includes('/api/') || entry.name.includes('/open-in-app/'))
const rows = api.map(entry => ({ ...entry, path: new URL(entry.name).pathname, repeats: byName.get(entry.name) })).sort((a, b) => b.durationMs - a.durationMs)

console.log(`resources=${resources.length} api=${api.length} settleMs=${settleMs}`)
console.log('durationMs serverMs transfer decoded path repeats')
for (const row of rows.slice(0, 45)) {
  console.log(
    `${String(row.durationMs).padStart(7)} ${String(row.serverMs).padStart(8)} ${String(row.transferBytes).padStart(9)} ${String(row.decodedBytes).padStart(9)} ${row.path}${row.repeats > 1 ? ` x${row.repeats}` : ''}`,
  )
}

await browser.close()
