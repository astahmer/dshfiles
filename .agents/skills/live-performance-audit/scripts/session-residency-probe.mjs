// SCRATCH ONLY: visit N sidebar threads like a long-lived tab, then report the Session Controller's resident instances
// by retain source, open `session/follow` streams, page heap after GC, and what one reconnect (offline, then online)
// sends. It takes a heap snapshot of its own headless page to find the controller, so it refuses the live web URL.
// Usage: LAUNCH_URL=<scratch launch url> node session-residency-probe.mjs [visits=20]   env: ASIDE=1 also opens the next
//   row "in side panel" from each visited thread; TOP=<n> adds the n largest node types by self size in the snapshot;
//   EXPAND=<group label> first opens a collapsed sidebar group (seeded logs without a checkpoint list as "Empty drafts").
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../../../../tooling/dshx/package.json', import.meta.url)))
const { chromium } = require('@playwright/test')
const url = process.env.LAUNCH_URL
const liveUrlFile = `${process.env.HOME}/.dsh/runtime/web-url`
if (url === undefined) throw new Error('Set LAUNCH_URL to a scratch DSH launch URL (dshx dev up writes it to its state.json).')
if (existsSync(liveUrlFile) && new URL(readFileSync(liveUrlFile, 'utf8').trim()).origin === new URL(url).origin) {
  throw new Error('Refusing the live DSH: this probe snapshots its page heap. Point LAUNCH_URL at a scratch instance.')
}
const visits = Number(process.argv[2] ?? 20)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addLocatorHandler(page.getByRole('dialog', { name: /^(Add an API key to get started|Get started|Preview Notice)$/ }), async dialog => {
  for (const name of ['Continue', 'Configure later', 'Close']) {
    const button = dialog.getByRole('button', { name, exact: true })
    if (await button.isVisible().catch(() => false)) return button.click()
  }
  await page.keyboard.press('Escape')
})
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
const streams = new Map()
let sent = []
cdp.on('Network.webSocketFrameSent', event => {
  let frame
  try {
    frame = JSON.parse(event.response.payloadData)
  } catch {
    return
  }
  if (frame.type === 'open') {
    streams.set(frame.streamId, frame.endpoint)
    sent.push(`ws ${frame.endpoint}`)
  } else if (frame.streamId !== undefined) {
    if (['close', 'cancel', 'abort'].includes(frame.type)) streams.delete(frame.streamId)
  }
})
cdp.on('Network.webSocketFrameReceived', event => {
  let frame
  try {
    frame = JSON.parse(event.response.payloadData)
  } catch {
    return
  }
  if (frame.streamId !== undefined && ['end', 'error', 'done', 'complete'].includes(frame.type)) streams.delete(frame.streamId)
})
cdp.on('Network.webSocketClosed', () => streams.clear())
cdp.on('Network.requestWillBeSent', event => {
  if (event.request.url.includes('/api/')) sent.push(`http ${new URL(event.request.url).pathname.replace('/api/', '')}`)
})
const openFollows = () => [...streams.values()].filter(endpoint => endpoint === 'session/follow').length

// Runs on the ClientSessions object found in the heap; reads its private bookkeeping, changes nothing.
const residencyOf = function () {
  const bySource = {}
  let referenced = 0
  for (const [, record] of this.scopes) {
    if (record.retention.referenceCount > 0) referenced += 1
    for (const [source, count] of Object.entries(record.retention.retainedBy)) bySource[source] = (bySource[source] ?? 0) + count
  }
  return { instances: this.manager.sessions.size, scopes: this.scopes.size, referenced, parked: this.parked.size, bySource }
}
const residency = async () => {
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  const chunks = []
  const onChunk = event => chunks.push(event.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk)
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk)
  const snapshot = JSON.parse(chunks.join(''))
  const { node_fields: nodeFields, edge_fields: edgeFields, edge_types: [edgeTypes], node_types: [nodeTypes] } = snapshot.snapshot.meta
  const top = Number(process.env.TOP ?? 0)
  const bySelfSize = new Map()
  for (let node = 0; top > 0 && node < snapshot.nodes.length; node += nodeFields.length) {
    const type = nodeTypes[snapshot.nodes[node + nodeFields.indexOf('type')]]
    const name = type === 'object' || type === 'native' ? snapshot.strings[snapshot.nodes[node + nodeFields.indexOf('name')]] : type
    const entry = bySelfSize.get(name) ?? { count: 0, bytes: 0 }
    entry.count += 1
    entry.bytes += snapshot.nodes[node + nodeFields.indexOf('self_size')]
    bySelfSize.set(name, entry)
  }
  const largest = [...bySelfSize].sort((left, right) => right[1].bytes - left[1].bytes).slice(0, top)
    .map(([name, entry]) => ({ name: name.slice(0, 60), count: entry.count, MB: Math.round(entry.bytes / 1e5) / 10 }))
  const property = edgeTypes.indexOf('property')
  const wanted = ['scopes', 'parked', 'manager', 'drafts']
  let serviceId
  for (let node = 0, edge = 0; node < snapshot.nodes.length && serviceId === undefined; node += nodeFields.length) {
    const names = new Set()
    for (let index = 0; index < snapshot.nodes[node + nodeFields.indexOf('edge_count')]; index++, edge += edgeFields.length) {
      if (snapshot.edges[edge + edgeFields.indexOf('type')] === property) names.add(snapshot.strings[snapshot.edges[edge + edgeFields.indexOf('name_or_index')]])
    }
    if (wanted.every(name => names.has(name))) serviceId = snapshot.nodes[node + nodeFields.indexOf('id')]
  }
  const sizes = top > 0 ? { largest } : {}
  if (serviceId === undefined) return { heapMB: Math.round(usedSize / 1e5) / 10, controller: 'not found', ...sizes }
  const { result } = await cdp.send('HeapProfiler.getObjectByHeapObjectId', { objectId: String(serviceId) })
  const { result: value } = await cdp.send('Runtime.callFunctionOn', {
    objectId: result.objectId,
    functionDeclaration: residencyOf.toString(),
    returnByValue: true,
  })
  return { heapMB: Math.round(usedSize / 1e5) / 10, ...value.value, ...sizes }
}

await page.goto(url)
const rows = page.locator('[data-thread-main-action]')
if (process.env.EXPAND !== undefined) {
  const group = page.getByText(process.env.EXPAND, { exact: false }).first()
  await group.waitFor({ timeout: 90_000 })
  await group.click()
}
await rows.first().waitFor({ timeout: 90_000 })
await page.waitForTimeout(4000)
for (let index = 0; index < visits; index++) {
  const count = Math.max(await rows.count(), 1)
  const row = rows.nth(index % count)
  await row.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
  // The hover action strip covers the row's centre.
  await row.click({ position: { x: 30, y: 10 }, timeout: 5000 }).catch(error => console.error('click', String(error).slice(0, 120)))
  if (process.env.ASIDE === '1') {
    await rows.nth((index + 1) % count).click({ button: 'right', position: { x: 30, y: 10 }, timeout: 5000 }).catch(() => {})
    await page
      .getByRole('menuitem', { name: 'Open in side panel' })
      .filter({ visible: true })
      .first()
      .click({ timeout: 5000 })
      .catch(error => console.error('aside', String(error).slice(0, 120)))
  }
  await page.waitForTimeout(1400)
}
await page.waitForTimeout(5000)
const resident = await residency()
const follows = openFollows()
sent = []
const offline = offline => cdp.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await offline(true)
await page.waitForTimeout(4000)
await offline(false)
await page.waitForTimeout(15000)
console.log(
  JSON.stringify(
    {
      visits,
      ...resident,
      openFollows: follows,
      reconnectRequests: sent.length,
      reconnectFollows: sent.filter(entry => entry === 'ws session/follow').length,
      followsAfterReconnect: openFollows(),
    },
    null,
    1,
  ),
)
await browser.close()
