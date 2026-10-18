#!/usr/bin/env node
/**
 * Sidebar scale benchmark.
 *
 * Seeds a scratch DSH with many non-blank threads and measures one "New thread"
 * navigation: long tasks, click-to-composer, and the sidebar's own render cost.
 * Render counts need the temporary counter documented in the thread-sidebar
 * README; every other number is measured from the running page.
 *
 *   node tooling/dshx/scripts/sidebar-scale-bench.mjs <state.json> --seed 305
 *   node tooling/dshx/scripts/sidebar-scale-bench.mjs <state.json> --rounds 5
 *
 * The state file is the `dshx dev up --json` envelope's `data` (or
 * `$TMPDIR/dshx-dev/<name>/state.json`). Clicking is done with CSS selectors on
 * purpose: a role locator makes Playwright walk the accessibility tree of every
 * rendered row, which costs more than the application work being measured.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(new URL('../packages/dshx/package.json', import.meta.url))
const { chromium } = require('playwright')
const { connectDshPlatformClient } = await import(new URL('../packages/dshx/dist/platform/index.js', import.meta.url).href)

const NEW_THREAD = 'button[aria-label="New thread"]'
const COMPOSER = 'div[aria-label="Describe what you want to build, / commands, @ files or sessions"]'
const SIDEBAR_ROW = '[data-thread-id]'

const readOption = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const statePath = process.argv[2]
if (statePath === undefined || statePath.startsWith('--')) {
  console.error('usage: sidebar-scale-bench.mjs <state.json> [--seed <count>] [--rounds <count>]')
  process.exit(1)
}
const state = JSON.parse(await readFile(resolve(statePath), 'utf8'))
const seedCount = Number(readOption('seed', '0'))
const rounds = Number(readOption('rounds', '5'))

const seedThreads = async () => {
  const storage = JSON.parse(await readFile(resolve(state.home, 'storages/workspace.json'), 'utf8'))
  const client = await connectDshPlatformClient({ url: state.launchUrl })
  const existing = await client.sessions.list()
  const blank = existing.filter(session => session.blank === true)
  const missing = Math.max(0, seedCount - (existing.length - blank.length))
  const created = []
  for (let index = 0; index < missing; index += 1) {
    const session = await client.sessions.create({ workspaceId: storage.global.defaultWorkspaceId }).catch(() => undefined)
    if (session !== undefined) created.push(session.sessionId)
  }
  let prompted = 0
  for (const sessionId of [...blank.map(session => session.sessionId), ...created]) {
    if (
      await client.sessions.prompt(sessionId, 'scale seed', 'queue').then(
        () => true,
        () => false,
      )
    )
      prompted += 1
  }
  console.log(JSON.stringify({ seeded: { created: created.length, prompted } }))
}

if (seedCount > 0) await seedThreads()

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(state.browser.cdpPort)}`)
const contexts = browser.contexts()
const pages = contexts.flatMap(context => context.pages())
const page = pages.find(candidate => candidate.url().startsWith(state.origin)) ?? pages[0] ?? (await contexts[0].newPage())

/** Dismiss the scratch profile's first-run dialogs by their own buttons, without a role query. */
const dismissDialogs = async () => {
  await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      for (const button of dialog.querySelectorAll('button')) {
        const label = (button.textContent ?? '').trim() || (button.getAttribute('aria-label') ?? '').trim()
        if (label === 'Continue' || label === 'Close' || label === 'Configure later') {
          button.click()
          break
        }
      }
    }
  })
}

await page.goto(state.launchUrl, { waitUntil: 'domcontentloaded' })
await page.waitForSelector(SIDEBAR_ROW, { state: 'attached', timeout: 60_000 })
await page.waitForTimeout(2_000)
await dismissDialogs()
const rows = await page.locator(SIDEBAR_ROW).count()

const results = []
for (let round = 0; round < rounds; round += 1) {
  await dismissDialogs()
  await page.evaluate(() => {
    globalThis.__longTasks = []
    globalThis.__observer?.disconnect()
    globalThis.__observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries())
        globalThis.__longTasks.push({ duration: Number(entry.duration.toFixed(1)), at: Number(entry.startTime.toFixed(1)) })
    })
    globalThis.__observer.observe({ type: 'longtask' })
    globalThis.__threadRowRenders = 0
    globalThis.__sidebarRenders = 0
  })
  const startedAt = await page.evaluate(() => performance.now())
  await page.locator(NEW_THREAD).first().click()
  await page.waitForSelector(COMPOSER, { state: 'visible', timeout: 30_000 })
  const composerVisibleMs = await page.evaluate(value => performance.now() - value, startedAt)
  const windowEnd = await page.evaluate(() => performance.now())
  await page.waitForTimeout(2_000)
  const measured = await page.evaluate(
    window => {
      const longTasks = globalThis.__longTasks ?? []
      return {
        longTasksInWindow: longTasks.filter(task => task.at <= window.end).map(task => task.duration),
        longTasksAfterWindow: longTasks.filter(task => task.at > window.end).map(task => task.duration),
        rowRenders: globalThis.__threadRowRenders ?? 0,
        sidebarRenders: globalThis.__sidebarRenders ?? 0,
        apiCalls: performance
          .getEntriesByType('resource')
          .filter(entry => entry.startTime >= window.start && entry.name.includes('/api/'))
          .map(entry => ({ path: new URL(entry.name).pathname, ms: Number(entry.duration.toFixed(1)) }))
          .sort((left, right) => right.ms - left.ms)
          .slice(0, 5),
      }
    },
    { start: startedAt, end: windowEnd },
  )
  results.push({
    round,
    clickToComposerMs: Number(composerVisibleMs.toFixed(1)),
    longTasksInWindow: measured.longTasksInWindow,
    longTasksAfterWindow: measured.longTasksAfterWindow,
    rowRenders: measured.rowRenders,
    sidebarRenders: measured.sidebarRenders,
    slowestCalls: measured.apiCalls,
  })
}
console.log(JSON.stringify({ rows, results }, null, 1))
// Detach without closing: connectOverCDP's close() would shut the scratch Chromium down.
process.exit(0)
