// SCRATCH ONLY: a long-lived tab's heap. Opens threads like a person who keeps one tab for hours, then settles, collects
// garbage twice, prints page heap use, DOM size and POSTs per stage, and writes a heap snapshot for
// heap-snapshot-retainers.mjs. It snapshots its own headless page, so it refuses the live web URL.
// Usage: LAUNCH_URL=<scratch launch url> OUT=<dir> node long-tab-heap-probe.mjs
//   env: IDS=<file of thread ids>  switch through `?thread=` (history push, no reload); without it, click sidebar rows
//        VISITS=<n, default 40>     threads per round        ROUNDS=<n, default 2>   rounds over the same threads
//        DWELL_MS=<ms, default 2500> per thread               SETTLE_MS=<ms, default 60000> idle before the final reading
//        ASIDE=1                     also open the next row in the side panel (row clicks only)
//        EXPAND=<label,...>          first open collapsed sidebar groups whose text contains the label (`=label`: exact)
//        MIN_ROWS=<n>                fail when the sidebar lists fewer rows        SNAP_EARLY=1  also snapshot after 3 visits
// Writes <OUT>/final.heapsnapshot (and early.heapsnapshot) and <OUT>/readings.json.
import { createRequire } from 'node:module'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../../../../tooling/dshx/package.json', import.meta.url)))
const { chromium } = require('@playwright/test')
const url = process.env.LAUNCH_URL
const liveUrlFile = `${process.env.HOME}/.dsh/runtime/web-url`
if (url === undefined) throw new Error('Set LAUNCH_URL to a scratch DSH launch URL (dshx dev up writes it to its state.json).')
if (existsSync(liveUrlFile) && new URL(readFileSync(liveUrlFile, 'utf8').trim()).origin === new URL(url).origin) {
  throw new Error('Refusing the live DSH: this probe snapshots its page heap. Point LAUNCH_URL at a scratch instance.')
}
const out = process.env.OUT
if (out === undefined) throw new Error('Set OUT to the directory for readings.json and the heap snapshots.')
mkdirSync(out, { recursive: true })
const visits = Number(process.env.VISITS ?? 40)
const rounds = Number(process.env.ROUNDS ?? 2)
const dwell = Number(process.env.DWELL_MS ?? 2500)
const settle = Number(process.env.SETTLE_MS ?? 60_000)
const ids = process.env.IDS === undefined ? [] : readFileSync(process.env.IDS, 'utf8').split('\n').filter(Boolean)

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
let posts = 0
cdp.on('Network.requestWillBeSent', event => {
  if (event.request.method === 'POST') posts += 1
})
await cdp.send('Network.enable')
await cdp.send('HeapProfiler.enable')

const reading = async label => {
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize, totalSize } = await cdp.send('Runtime.getHeapUsage')
  const dom = await page.evaluate(() => document.getElementsByTagName('*').length)
  const row = { label, usedMB: Math.round(usedSize / 1e5) / 10, totalMB: Math.round(totalSize / 1e5) / 10, dom, posts }
  console.log(JSON.stringify(row))
  return row
}
const snapshot = async name => {
  await cdp.send('HeapProfiler.collectGarbage')
  const stream = createWriteStream(`${out}/${name}.heapsnapshot`, { mode: 0o600 })
  const onChunk = event => stream.write(event.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk)
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk)
  await new Promise(resolve => stream.end(resolve))
}

await page.goto(url)
const rows = page.locator('[data-thread-main-action]')
await rows.first().waitFor({ timeout: 90_000 })
await page.waitForTimeout(5000)
await page.keyboard.press('Escape')
for (const label of (process.env.EXPAND ?? '').split(',').filter(Boolean)) {
  const groups = label.startsWith('=') ? page.getByText(label.slice(1), { exact: true }) : page.getByText(label, { exact: false })
  for (let index = (await groups.count()) - 1; index >= 0; index--) {
    await groups.nth(index).click({ timeout: 5000 }).catch(error => console.error('expand', String(error).slice(0, 120)))
    await page.waitForTimeout(500)
  }
}
await page.waitForTimeout(5000)
const readings = [await reading('load')]
const visit = async index => {
  if (ids.length > 0) {
    await page.evaluate(id => {
      const next = new URL(location.href)
      next.searchParams.set('thread', id)
      history.pushState(history.state, '', next)
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    }, ids[index % ids.length])
    await page.waitForTimeout(dwell)
    return
  }
  const count = Math.max(await rows.count(), 1)
  const row = rows.nth(index % count)
  await row.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
  await row.click({ position: { x: 30, y: 10 }, timeout: 5000 }).catch(error => console.error('click', String(error).slice(0, 120)))
  if (process.env.ASIDE === '1') {
    await rows.nth((index + 1) % count).click({ button: 'right', position: { x: 30, y: 10 }, timeout: 5000 }).catch(() => {})
    await page.getByRole('menuitem', { name: 'Open in side panel' }).filter({ visible: true }).first().click({ timeout: 5000 }).catch(() => {})
  }
  await page.waitForTimeout(dwell)
}
const listed = await rows.count()
console.log(JSON.stringify({ rows: listed, ids: ids.length }))
if (listed < Number(process.env.MIN_ROWS ?? 0)) throw new Error('sidebar not settled: too few rows')
for (let index = 0; index < 3; index++) await visit(index)
readings.push(await reading('after-3'))
if (process.env.SNAP_EARLY === '1') await snapshot('early')
for (let round = 0; round < rounds; round++) {
  for (let index = 0; index < visits; index++) await visit(index)
  readings.push(await reading(`round-${round + 1}`))
}
await visit(0)
await page.waitForTimeout(settle)
readings.push(await reading('settled'))
await snapshot('final')
writeFileSync(`${out}/readings.json`, JSON.stringify(readings, null, 1))
await browser.close()
