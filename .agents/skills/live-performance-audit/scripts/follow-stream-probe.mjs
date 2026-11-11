// Bytes per live update and per thread open on the `/api/remote.mux` socket, grouped by stream endpoint.
// Usage: node follow-stream-probe.mjs updates [seconds=60]   open the first running thread (or MATCH) and record
//        node follow-stream-probe.mjs switch [threads=6] [rounds=3]   cycle sidebar threads, count cache hits
// env: LAUNCH_URL (default ~/.dsh/runtime/web-url), MATCH=<title regexp>, EXPAND=1 (show child threads first). Prints sizes and endpoint names only.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../../../../tooling/dshx/package.json', import.meta.url)))
const { chromium } = require('@playwright/test')
const url = process.env.LAUNCH_URL ?? readFileSync(`${process.env.HOME}/.dsh/runtime/web-url`, 'utf8').trim()
const match = process.env.MATCH === undefined ? undefined : new RegExp(process.env.MATCH)
const mode = process.argv[2] ?? 'updates'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addLocatorHandler(page.getByRole('dialog', { name: /^(Add an API key to get started|Get started|Preview Notice)$/ }), async dialog => {
  for (const name of ['Continue', 'Configure later', 'Close']) {
    const button = dialog.getByRole('button', { name, exact: true })
    if (await button.isVisible().catch(() => false)) return button.click()
  }
})
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
const muxSockets = new Set()
const endpointByStream = new Map()
let received = []
let opened = []
const snapshots = []
const projectionKeys = []
cdp.on('Network.webSocketCreated', event => {
  if (new URL(event.url).pathname === '/api/remote.mux') muxSockets.add(event.requestId)
})
cdp.on('Network.webSocketFrameSent', event => {
  if (!muxSockets.has(event.requestId)) return
  const frame = JSON.parse(event.response.payloadData)
  if (frame.type !== 'open') return
  endpointByStream.set(frame.streamId, frame.endpoint)
  opened.push(frame.endpoint)
})
cdp.on('Network.webSocketFrameReceived', event => {
  if (!muxSockets.has(event.requestId)) return
  const data = event.response.payloadData
  const frame = JSON.parse(data)
  const endpoint = endpointByStream.get(frame.streamId) ?? `?${frame.type}`
  const kind =
    frame.value?.type === 'event'
      ? `event ${frame.value.event?.type}`
      : frame.value?.type === 'assistant-stream'
        ? `assistant-stream ${frame.value.frame?.type}`
        : (frame.value?.type ?? frame.type)
  received.push({ endpoint, kind, bytes: Buffer.byteLength(data) })
  if (process.env.DUMP !== undefined && kind === 'snapshot' && endpoint === 'session/follow') snapshots.push(data)
  if (kind === 'projection')
    projectionKeys.push(
      ...Object.keys(frame.value?.values ?? frame.value?.value ?? {}).map(key => [
        key,
        Buffer.byteLength(JSON.stringify((frame.value?.values ?? frame.value?.value)[key])),
      ]),
    )
})

const quantile = (values, q) => (values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(q * values.length))])
const summarize = frames => {
  const groups = new Map()
  for (const frame of frames) {
    const key = `${frame.endpoint} ${frame.kind}`
    groups.set(key, [...(groups.get(key) ?? []), frame.bytes])
  }
  return [...groups]
    .sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0))
    .map(([key, sizes]) => ({
      key,
      count: sizes.length,
      totalKB: +(sizes.reduce((s, v) => s + v, 0) / 1024).toFixed(1),
      p50B: quantile(sizes, 0.5),
      p95B: quantile(sizes, 0.95),
      maxB: Math.max(...sizes),
    }))
}

await page.goto(url, { waitUntil: 'commit', timeout: 120_000 })
const rows = page.locator('[data-thread-main-action]')
await rows.first().waitFor({ timeout: 120_000 })
await page.waitForTimeout(5000)
if (process.env.EXPAND !== undefined) {
  for (const toggle of await page.getByRole('button', { name: /^Show child threads/ }).all()) await toggle.click().catch(() => {})
  await page.waitForTimeout(1000)
}
const labelOf = async row => ((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim()
const clickRow = async row => {
  await row.scrollIntoViewIfNeeded()
  await row.click({ position: { x: 30, y: 10 } })
  await page
    .waitForFunction(
      () => !document.body.innerText.includes('Loading history') && (document.querySelector('[data-chat-flow]')?.children.length ?? 0) > 0,
      null,
      { timeout: 60_000 },
    )
    .catch(() => {})
}

if (mode === 'updates') {
  const count = await rows.count()
  let target
  for (let index = 0; index < count && target === undefined; index++) {
    const label = await labelOf(rows.nth(index))
    if (match === undefined ? /Working/.test(label) : match.test(label)) target = rows.nth(index)
  }
  if (target === undefined) throw new Error('no running thread row')
  received = []
  opened = []
  await clickRow(target)
  await page.waitForTimeout(1500)
  const opening = summarize(received)
  received = []
  await page.waitForTimeout(Number(process.argv[3] ?? 60) * 1000)
  const byKey = new Map()
  for (const [key, bytes] of projectionKeys) byKey.set(key, [...(byKey.get(key) ?? []), bytes])
  const projectionValues = [...byKey]
    .map(([key, sizes]) => ({ key, count: sizes.length, p50B: quantile(sizes, 0.5), maxB: Math.max(...sizes) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
  if (process.env.DUMP !== undefined && snapshots.length > 0) writeFileSync(process.env.DUMP, snapshots.sort((a, b) => b.length - a.length)[0])
  console.log(JSON.stringify({ mode, opened, opening, updates: summarize(received), projectionValues }, null, 1))
}

if (mode === 'switch') {
  const wanted = Number(process.argv[3] ?? 6)
  const rounds = Number(process.argv[4] ?? 3)
  const targets = []
  for (let index = 0; index < (await rows.count()) && targets.length < wanted; index++) {
    if (match === undefined || match.test(await labelOf(rows.nth(index)))) targets.push(index)
  }
  const visits = []
  for (let round = 0; round < rounds; round++) {
    for (const index of targets) {
      received = []
      opened = []
      await clickRow(rows.nth(index))
      await page.waitForTimeout(1000)
      const follows = opened.filter(endpoint => endpoint === 'session/follow').length
      const bytes = received.reduce((sum, frame) => sum + frame.bytes, 0)
      visits.push({ round, row: index, follows, pages: opened.filter(endpoint => endpoint === 'session/page').length, KB: +(bytes / 1024).toFixed(1) })
    }
  }
  const later = visits.filter(visit => visit.round > 0)
  const hits = later.filter(visit => visit.follows === 0).length
  console.log(JSON.stringify({ mode, threads: targets.length, rounds, hitRate: `${hits}/${later.length}`, visits }, null, 1))
}
await browser.close()
