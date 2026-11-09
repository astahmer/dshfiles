// Page reload to interactive: open a thread, then reload it with an empty HTTP cache (cold) and twice with it (warm).
// Prints first paint, sidebar rows, transcript and composer times, JS bytes, requests and long tasks per load.
// Usage: node reload-probe.mjs [runs=3]   env: LAUNCH_URL (default ~/.dsh/runtime/web-url), MATCH=<row title regexp>,
//   REQUESTS=1 (waterfall per load), PROFILE_DIR=<dir> (one page CPU profile per load)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../../../../tooling/dshx/package.json', import.meta.url)))
const { chromium } = require('@playwright/test')
const url = process.env.LAUNCH_URL ?? readFileSync(`${process.env.HOME}/.dsh/runtime/web-url`, 'utf8').trim()
const runs = Number(process.argv[2] ?? 3)

const marksScript = () => {
  window.__probe = { longTasks: [], marks: {} }
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) window.__probe.longTasks.push([Math.round(entry.startTime), Math.round(entry.duration)])
  }).observe({ type: 'longtask', buffered: true })
  const mark = name => {
    if (window.__probe.marks[name] === undefined) window.__probe.marks[name] = Math.round(performance.now())
  }
  const check = () => {
    if (document.querySelector('[data-thread-main-action]') !== null) mark('sidebar')
    const flow = document.querySelector('[data-chat-flow]')
    if (flow !== null && flow.children.length > 0 && document.querySelector('[data-loading-history]') === null) mark('transcript')
    const composer = [...document.querySelectorAll('[role=textbox],textarea')].find(
      element => /Message or run a task|Describe what you want/.test(element.getAttribute('aria-label') ?? element.getAttribute('placeholder') ?? '') && element.getAttribute('aria-disabled') !== 'true',
    )
    if (composer !== undefined) mark('composer')
  }
  let scheduled = false
  new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      check()
    })
  }).observe(document, { subtree: true, childList: true, attributes: true })
}

const measure = async (page, cdp, load, label) => {
  const requests = new Map()
  const onSent = event => requests.set(event.requestId, { url: event.request.url, type: event.type, start: event.timestamp, bytes: 0, encoded: 0, cached: false })
  const onData = event => {
    const request = requests.get(event.requestId)
    if (request !== undefined) request.bytes += event.dataLength
  }
  const onResponse = event => {
    const request = requests.get(event.requestId)
    if (request !== undefined) {
      request.cached = event.response.fromDiskCache === true || event.response.fromMemoryCache === true
      request.status = event.response.status
      request.encoding = event.response.headers['content-encoding'] ?? event.response.headers['Content-Encoding']
    }
  }
  const onCached = event => {
    const request = requests.get(event.requestId)
    if (request !== undefined) request.cached = true
  }
  const onDone = event => {
    const request = requests.get(event.requestId)
    if (request !== undefined) {
      request.encoded = event.encodedDataLength
      request.end = event.timestamp
    }
  }
  cdp.on('Network.requestWillBeSent', onSent)
  cdp.on('Network.dataReceived', onData)
  cdp.on('Network.responseReceived', onResponse)
  cdp.on('Network.requestServedFromCache', onCached)
  cdp.on('Network.loadingFinished', onDone)
  if (process.env.PROFILE_DIR !== undefined) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
    await cdp.send('Profiler.start')
  }
  await load()
  await page.waitForFunction(() => window.__probe?.marks.composer !== undefined && window.__probe.marks.transcript !== undefined, null, { timeout: 120_000 }).catch(() => {})
  await page.waitForTimeout(2000)
  if (process.env.PROFILE_DIR !== undefined) {
    const { profile } = await cdp.send('Profiler.stop')
    writeFileSync(`${process.env.PROFILE_DIR}/${label}.cpuprofile`, JSON.stringify(profile))
  }
  cdp.off('Network.requestWillBeSent', onSent)
  cdp.off('Network.dataReceived', onData)
  cdp.off('Network.responseReceived', onResponse)
  cdp.off('Network.requestServedFromCache', onCached)
  cdp.off('Network.loadingFinished', onDone)
  const result = await page.evaluate(() => {
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map(entry => [entry.name, Math.round(entry.startTime)]))
    const navigation = performance.getEntriesByType('navigation')[0]
    const boot = window.__DSH_BOOT__
    return {
      ...window.__probe.marks,
      fp: paint['first-paint'],
      fcp: paint['first-contentful-paint'],
      domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
      load: Math.round(navigation.loadEventEnd),
      longTasks: window.__probe.longTasks,
      bootEntries: boot?.entries?.length,
      bootBatches: boot?.batches?.length,
    }
  })
  const all = [...requests.values()]
  const scripts = all.filter(request => request.type === 'Script')
  const sum = (list, key) => Math.round(list.reduce((total, request) => total + request[key], 0) / 1024)
  const longTotal = result.longTasks.reduce((total, [, duration]) => total + duration, 0)
  const bootLong = result.longTasks.filter(([start]) => start < (result.composer ?? Infinity))
  console.log(
    `${label.padEnd(8)} fp=${result.fp} fcp=${result.fcp} dcl=${result.domContentLoaded} load=${result.load} sidebar=${result.sidebar} transcript=${result.transcript} composer=${result.composer}` +
      ` | requests=${all.length} (scripts ${scripts.length}, cached ${all.filter(request => request.cached).length}) js=${sum(scripts, 'bytes')}KB decoded/${sum(scripts, 'encoded')}KB wire all=${sum(all, 'encoded')}KB wire` +
      ` | longTasks=${result.longTasks.length}/${longTotal}ms before-composer=${bootLong.length}/${bootLong.reduce((t, [, d]) => t + d, 0)}ms max=${Math.max(0, ...result.longTasks.map(([, d]) => d))}` +
      ` | boot entries=${result.bootEntries} batches=${result.bootBatches} enc=${[...new Set(scripts.map(r => r.encoding ?? 'none'))].join(',')}`,
  )
  if (process.env.REQUESTS !== undefined) {
    const t0 = Math.min(...all.map(request => request.start))
    for (const request of all.sort((a, b) => a.start - b.start))
      console.log(
        `   ${String(Math.round((request.start - t0) * 1000)).padStart(6)} +${String(Math.round(((request.end ?? request.start) - request.start) * 1000)).padStart(5)}ms ${request.cached ? 'C' : ' '} ${String(Math.round(request.encoded / 1024)).padStart(6)}KB ${request.type.padEnd(10)} ${new URL(request.url).pathname.slice(0, 90)}`,
      )
  }
  return result
}

const browser = await chromium.launch({ headless: true })
const match = new RegExp(process.env.MATCH ?? '.')
for (let run = 0; run < runs; run++) {
  const dir = mkdtempSync(join(tmpdir(), 'reload-probe-'))
  const context = await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 1440, height: 900 } })
  await context.addInitScript(marksScript)
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(url)
  const rows = page.locator('[data-thread-main-action]')
  await rows.first().waitFor({ timeout: 120_000 })
  await rows.filter({ hasText: match }).first().click({ position: { x: 30, y: 10 } })
  await page.waitForTimeout(5000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.clearBrowserCache')
  await measure(page, cdp, () => page.reload(), `cold${run}`)
  await measure(page, cdp, () => page.reload(), `warm${run}`)
  await measure(page, cdp, () => page.reload(), `warm${run}b`)
  await context.close()
  rmSync(dir, { recursive: true, force: true })
}
await browser.close()
