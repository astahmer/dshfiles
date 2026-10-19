// Click sidebar threads in a headless browser and report, per click, what a user waits for.
// Usage: node switch-probe.mjs [rows=10]   env: LAUNCH_URL (default ~/.dsh/runtime/web-url), MATCH=<title regexp>,
//   DUMP=<file> (save the largest session/follow opening snapshot of the matched row), REQUESTS=1 (list every request)
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../../../../tooling/dshx/package.json', import.meta.url)))
const { chromium } = require('@playwright/test')
const url = process.env.LAUNCH_URL ?? readFileSync(`${process.env.HOME}/.dsh/runtime/web-url`, 'utf8').trim()
const match = process.env.MATCH === undefined ? undefined : new RegExp(process.env.MATCH)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(() => {
  window.__longTasks = []
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) window.__longTasks.push(entry.duration)
  }).observe({ type: 'longtask', buffered: true })
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
let socketBytes = 0
let largestSnapshot = ''
const requests = []
const started = new Map()
cdp.on('Network.webSocketFrameReceived', event => {
  const data = event.response.payloadData
  socketBytes += data.length
  if (data.length > largestSnapshot.length && data.includes('"snapshot"')) largestSnapshot = data
})
cdp.on('Network.requestWillBeSent', event => {
  if (event.request.url.includes('/api/')) started.set(event.requestId, { at: Date.now(), path: new URL(event.request.url).pathname.replace('/api/', '') })
})
cdp.on('Network.loadingFinished', event => {
  const request = started.get(event.requestId)
  if (request !== undefined) requests.push({ path: request.path, ms: Date.now() - request.at })
})

await page.goto(url)
const rows = page.locator('[data-thread-main-action]')
await rows.first().waitFor({ timeout: 90_000 })
await page.waitForTimeout(3000)
const count = await rows.count()
for (let index = 0, clicked = 0; index < count && clicked < Number(process.argv[2] ?? 10); index++) {
  const row = rows.nth(index)
  const label = ((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim()
  if (match !== undefined && !match.test(label)) continue
  clicked += 1
  socketBytes = 0
  largestSnapshot = ''
  requests.length = 0
  const longBefore = await page.evaluate(() => window.__longTasks.length)
  const clickedAt = Date.now()
  await row.scrollIntoViewIfNeeded()
  // The hover action strip covers the row's centre.
  await row.click({ position: { x: 30, y: 10 } })
  await page
    .getByRole('textbox', { name: /Message or run a task|Describe what you want/ })
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  const composerMs = Date.now() - clickedAt
  await page
    .waitForFunction(
      () => !document.body.innerText.includes('Loading history') && (document.querySelector('[data-chat-flow]')?.children.length ?? 0) > 0,
      null,
      { timeout: 60_000 },
    )
    .catch(() => {})
  const historyMs = Date.now() - clickedAt
  await page.waitForTimeout(1500)
  const after = await page.evaluate(start => ({ longTasks: window.__longTasks.slice(start), dom: document.getElementsByTagName('*').length }), longBefore)
  const longTotal = Math.round(after.longTasks.reduce((sum, duration) => sum + duration, 0))
  const slow = requests.filter(request => request.ms > 250).map(request => `${request.path} ${request.ms}ms`)
  console.log(
    `${label.slice(0, 40).padEnd(40)} composer=${composerMs}ms history=${historyMs}ms longTasks=${after.longTasks.length}/${longTotal}ms dom=${after.dom} ws=${Math.round(socketBytes / 1024)}KB requests=${requests.length} slow=[${slow.join(', ')}]`,
  )
  if (process.env.REQUESTS !== undefined)
    console.log(
      '  ',
      requests
        .map(request => `${request.path}:${request.ms}`)
        .sort()
        .join(' '),
    )
  if (process.env.DUMP !== undefined && largestSnapshot !== '') writeFileSync(process.env.DUMP, largestSnapshot)
}
await browser.close()
