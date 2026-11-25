// Phone-size Threads list -> thread -> Back, per tap: tap->title, tap->first message paint, Back->list paint, long tasks,
// DOM, requests and dshx calls. Taps rows and Back only; never types or sends.
// Usage: RTT=100 CPU=4 ROWS=6 node phone-switch-probe.mjs
//   env: LAUNCH_URL (default ~/.dsh/runtime/web-url), RTT (added latency in ms), CPU (throttle rate), ROWS,
//   JSON=1 (every row), PATHS=1 (requests by endpoint), METHODS=1 (every call by API method, batched calls expanded,
//   with how many distinct Sessions each read), PROFILE_DIR=<dir> (one .cpuprofile per tap and Back)
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../../../../tooling/dshx/package.json', import.meta.url)))
const { chromium } = require('@playwright/test')
const url = process.env.LAUNCH_URL ?? readFileSync(`${process.env.HOME}/.dsh/runtime/web-url`, 'utf8').trim()
const rtt = Number(process.env.RTT ?? 0)
const cpu = Number(process.env.CPU ?? 1)
const rowCount = Number(process.env.ROWS ?? 6)
const channelOwners = process.env.METHODS === '1' ? await (await import('./har-summary.mjs')).buildChannelOwners() : new Map()
const methodLabel = endpoint => {
  const [channel = '', ...rest] = endpoint.split('/').filter(Boolean)
  const owner = channelOwners.get(channel)
  return owner === undefined ? endpoint : `${owner.apiId}/${rest.join('/')}`
}
/** A dshx batch body is `{ entries: [{ endpoint, payload }] }`; the Session a call reads, when it names one. */
const batchCalls = postData => {
  try {
    return JSON.parse(postData).entries.map(entry => ({
      method: methodLabel(entry.endpoint),
      sessionId: entry.payload?.input?.sessionId ?? entry.payload?.sessionId ?? entry.payload?.input?.scope,
    }))
  } catch {
    return [{ method: 'dshx-batch', sessionId: undefined }]
  }
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 393, height: 851 },
  deviceScaleFactor: 2.75,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; 23090RA98G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
})
await context.addInitScript(() => {
  window.__longTasks = []
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) window.__longTasks.push({ at: entry.startTime, ms: entry.duration })
  }).observe({ type: 'longtask', buffered: true })
  const PLACEHOLDER = new Set(['New thread', 'Thread', 'Threads', ''])
  window.__watch = (mode, expected) => {
    const t0 = performance.now()
    const before = (document.querySelector('[data-chat-flow]')?.textContent ?? '').slice(0, 300)
    const result = { mode, titleMs: null, msgMs: null, listMs: null, newThreadFrames: 0, newThreadLastMs: null, firstTitle: null, frames: 0 }
    window.__result = result
    const tick = () => {
      const now = performance.now() - t0
      result.frames += 1
      const header = document.querySelector('header[data-phone-top-bar]')
      const title = document.querySelector('[data-phone-title]')?.textContent?.trim() ?? ''
      const stage = header?.getAttribute('data-phone-stage')
      if (mode === 'open') {
        result.lastTitle = title
        if (stage === 'thread' || stage === 'none') {
          if (title === 'New thread') {
            result.newThreadFrames += 1
            result.newThreadLastMs = now
          }
          if (
            result.titleMs === null &&
            !PLACEHOLDER.has(title) &&
            (expected === '' || expected.startsWith(title.replace(/…$/, '')) || title.startsWith(expected.slice(0, 20)))
          ) {
            result.titleMs = now
            result.firstTitle = title
          }
        }
        const flow = document.querySelector('[data-chat-flow]')
        const flowText = flow === null ? null : (flow.textContent ?? '').slice(0, 300)
        if (
          result.msgMs === null &&
          flow !== null &&
          flow.children.length > 0 &&
          flowText !== before &&
          flow.checkVisibility() &&
          !document.body.innerText.includes('Loading history')
        )
          result.msgMs = now
        if ((result.titleMs !== null && result.msgMs !== null) || now > 30000) return
      } else {
        const rows = [...document.querySelectorAll('button[data-thread-main-action][data-thread-id]')]
        // Drawer mode keeps the stage named in the top bar while the list slides over it: the drawer being open is
        // the "list is on screen" signal there, where the stack has no stage.
        const drawerOpen = document.querySelector('[data-phone-drawer="open"]') !== null
        if (
          result.listMs === null &&
          (stage === null || stage === undefined || drawerOpen) &&
          header !== null &&
          rows.some(row => row.getBoundingClientRect().height > 0 && row.checkVisibility({ visibilityProperty: true }))
        )
          result.listMs = now
        if (result.listMs !== null || now > 30000) return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
})
const page = await context.newPage()
await page.addLocatorHandler(page.getByRole('dialog', { name: /^(Add an API key to get started|Get started|Preview Notice)$/ }), async dialog => {
  for (const name of ['Continue', 'Configure later', 'Close']) {
    const button = dialog.getByRole('button', { name, exact: true })
    if (await button.isVisible().catch(() => false)) return button.click()
  }
})
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
if (rtt > 0)
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: rtt,
    downloadThroughput: (20 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
  })
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
const requests = []
let wsSent = 0
let wsRecvBytes = 0
let httpBytes = 0
cdp.on('Network.requestWillBeSent', event => {
  if (event.request.url.includes('/api/')) {
    const path = new URL(event.request.url).pathname.replace('/api/', '')
    const methods =
      path === 'dshx-batch' && typeof event.request.postData === 'string'
        ? batchCalls(event.request.postData)
        : [{ method: methodLabel(path), sessionId: undefined }]
    requests.push({ path, calls: methods.length, methods })
  }
})
cdp.on('Network.webSocketFrameSent', () => (wsSent += 1))
cdp.on('Network.webSocketFrameReceived', event => (wsRecvBytes += event.response.payloadData.length))
cdp.on('Network.dataReceived', event => (httpBytes += event.dataLength))

const profileDir = process.env.PROFILE_DIR
const profiles = []
if (profileDir !== undefined) {
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
}
const reset = () => {
  requests.length = 0
  wsSent = 0
  wsRecvBytes = 0
  httpBytes = 0
}
const loadStart = Date.now()
await page.goto(url)
await page.locator('header[data-phone-top-bar]').waitFor({ timeout: 120_000 })
const rowsLocator = page.locator('button[data-thread-main-action][data-thread-id]')
// The list is a full-screen stack page (Back button) or the owner's thread drawer (Show threads).
const listButton = page.locator('[data-phone-sidebar]')
const backButton = page.locator('[data-phone-back]')
const openList = async () => {
  if (await listButton.isVisible().catch(() => false)) await listButton.tap()
  else if (await backButton.isVisible().catch(() => false)) await backButton.tap()
}
if (
  !(await rowsLocator
    .first()
    .isVisible()
    .catch(() => false))
) {
  await openList()
}
await rowsLocator.first().waitFor({ timeout: 120_000 })
const loadMs = Date.now() - loadStart
await page.waitForTimeout(8000)
const ids = await rowsLocator.evaluateAll(rows =>
  rows.map(row => ({ id: row.getAttribute('data-thread-id'), label: (row.getAttribute('aria-label') ?? row.textContent ?? '').replace(/\s+/g, ' ').trim() })),
)
const picks = ids.filter(pick => !/^(New chat|New thread)/.test(pick.label)).slice(0, rowCount)
const out = []
const summarize = async (longBefore, extra) => {
  const after = await page.evaluate(
    start => ({
      longTasks: window.__longTasks.slice(start).map(task => Math.round(task.ms)),
      dom: document.getElementsByTagName('*').length,
      result: window.__result,
    }),
    longBefore,
  )
  const byPath = {}
  for (const request of requests) byPath[request.path] = (byPath[request.path] ?? 0) + 1
  const byMethod = {}
  for (const call of requests.flatMap(request => request.methods)) {
    const row = (byMethod[call.method] ??= { calls: 0, sessions: new Set() })
    row.calls += 1
    if (typeof call.sessionId === 'string') row.sessions.add(call.sessionId)
  }
  return {
    ...extra,
    ...after.result,
    longTasks: after.longTasks.length,
    longTaskMs: after.longTasks.reduce((a, b) => a + b, 0),
    maxLongTask: Math.max(0, ...after.longTasks),
    dom: after.dom,
    requests: requests.length,
    calls: requests.reduce((a, b) => a + b.calls, 0),
    wsSent,
    kb: Math.round((httpBytes + wsRecvBytes) / 1024),
    byPath,
    byMethod,
  }
}
for (const pick of picks) {
  // Back/openList leaves the list open, but its slide needs a frame before the row is tappable again.
  const row = page.locator(`button[data-thread-main-action][data-thread-id="${pick.id}"]`)
  // The list is virtualized: a row from an earlier snapshot may sit outside the mounted window.
  await row.scrollIntoViewIfNeeded().catch(() => undefined)
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  const expectedTitle = await row.evaluate(row => {
    const titleNode = [...row.querySelectorAll('span')].find(span => span.className.includes('dshx:flex-1') && span.className.includes('dshx:truncate')) ?? row
    return (titleNode.textContent ?? '').replace(/\s+/g, ' ').trim()
  })
  reset()
  let longBefore = await page.evaluate(() => window.__longTasks.length)
  await page.evaluate(expected => window.__watch('open', expected), expectedTitle)
  if (profileDir !== undefined) await cdp.send('Profiler.start')
  await row.tap({ position: { x: 30, y: 12 } })
  await page.waitForFunction(() => window.__result.titleMs !== null && window.__result.msgMs !== null, null, { timeout: 35_000, polling: 100 }).catch(() => {})
  await page.waitForTimeout(3000)
  if (profileDir !== undefined) profiles.push({ kind: 'open', profile: (await cdp.send('Profiler.stop')).profile })
  const open = await summarize(longBefore, { kind: 'open', title: expectedTitle.slice(0, 40) })
  out.push(open)
  reset()
  longBefore = await page.evaluate(() => window.__longTasks.length)
  await page.evaluate(() => window.__watch('back', ''))
  if (profileDir !== undefined) await cdp.send('Profiler.start')
  await openList()
  await rowsLocator.first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => window.__result.listMs !== null, null, { timeout: 35_000, polling: 100 }).catch(() => {})
  await page.waitForTimeout(2000)
  if (profileDir !== undefined) profiles.push({ kind: 'back', profile: (await cdp.send('Profiler.stop')).profile })
  out.push(await summarize(longBefore, { kind: 'back' }))
}
await browser.close()
if (profileDir !== undefined) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(profileDir, { recursive: true })
  profiles.forEach((entry, index) => writeFileSync(`${profileDir}/${index}-${entry.kind}.cpuprofile`, JSON.stringify(entry.profile)))
}
const median = values => {
  const sorted = values.filter(value => value !== null).sort((a, b) => a - b)
  return sorted.length === 0 ? null : Math.round(sorted[Math.floor((sorted.length - 1) / 2)])
}
const opens = out.filter(row => row.kind === 'open')
const backs = out.filter(row => row.kind === 'back')
if (process.env.JSON === '1') console.log(JSON.stringify(out, null, 1))
for (const row of out)
  console.log(
    row.kind.padEnd(5),
    `title=${row.titleMs === null ? '-' : Math.round(row.titleMs)}`.padEnd(11),
    `msg=${row.msgMs === null ? '-' : Math.round(row.msgMs)}`.padEnd(10),
    `list=${row.listMs === null ? '-' : Math.round(row.listMs)}`.padEnd(10),
    `newThreadLast=${row.newThreadLastMs === null ? '-' : Math.round(row.newThreadLastMs)}`.padEnd(18),
    `lt=${row.longTasks}/${Math.round(row.longTaskMs)}ms(max ${row.maxLongTask})`.padEnd(22),
    `dom=${row.dom}`,
    `req=${row.requests} calls=${row.calls} ws>${row.wsSent} kb=${row.kb}`,
  )
console.log(
  JSON.stringify({
    rtt,
    rows: ids.length,
    cpu,
    loadMs,
    open: {
      titleP50: median(opens.map(r => r.titleMs)),
      msgP50: median(opens.map(r => r.msgMs)),
      newThreadShown: opens.filter(r => r.newThreadFrames > 0).length,
      reqP50: median(opens.map(r => r.requests)),
      callsP50: median(opens.map(r => r.calls)),
      longTaskP50: median(opens.map(r => r.longTaskMs)),
    },
    back: {
      listP50: median(backs.map(r => r.listMs)),
      reqP50: median(backs.map(r => r.requests)),
      callsP50: median(backs.map(r => r.calls)),
      longTaskP50: median(backs.map(r => r.longTaskMs)),
    },
  }),
)
if (process.env.PATHS === '1') {
  const merged = {}
  for (const row of opens) for (const [path, n] of Object.entries(row.byPath)) merged[path] = (merged[path] ?? 0) + n
  console.log('open paths', JSON.stringify(merged))
  const mergedBack = {}
  for (const row of backs) for (const [path, n] of Object.entries(row.byPath)) mergedBack[path] = (mergedBack[path] ?? 0) + n
  console.log('back paths', JSON.stringify(mergedBack))
}
if (process.env.METHODS === '1') {
  for (const kind of ['open', 'back']) {
    const merged = {}
    const rows = out.filter(row => row.kind === kind)
    for (const row of rows)
      for (const [method, entry] of Object.entries(row.byMethod)) {
        const total = (merged[method] ??= { calls: 0, sessions: 0 })
        total.calls += entry.calls
        total.sessions += entry.sessions.size
      }
    console.log(`${kind} calls per tap (sessions read per tap), ${rows.length} taps:`)
    for (const [method, total] of Object.entries(merged).sort((a, b) => b[1].calls - a[1].calls))
      console.log(`  ${(total.calls / rows.length).toFixed(1).padStart(5)}  (${(total.sessions / rows.length).toFixed(1)})  ${method}`)
  }
}
