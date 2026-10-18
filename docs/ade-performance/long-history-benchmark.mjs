#!/usr/bin/env node
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const planDirectory = dirname(fileURLToPath(import.meta.url))
const { chromium } = createRequire(new URL('../../tooling/dshx/packages/dshx/package.json', import.meta.url))('playwright')
const statePath = process.argv[2]
const turns = Number(process.argv[3] ?? '100')
const outputPath = process.argv[4] === undefined ? undefined : resolve(process.argv[4])
const commandCodeModel = 'commandcode_work/gpt-6-luna'
const historyTitle = 'ADE Perf Long History'
const isWithin = (parent, child) => {
  const relativePath = relative(resolve(parent), resolve(child))
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

if (statePath === undefined || !Number.isSafeInteger(turns) || turns < 1 || turns > 500) {
  throw new Error('Usage: long-history-benchmark.mjs <scratch-state.json> [turns=100] [output.json]')
}
if (outputPath !== undefined && (!isWithin(planDirectory, outputPath) || dirname(outputPath) !== planDirectory || !outputPath.endsWith('.json'))) {
  throw new Error('The output JSON must stay directly inside plans/ade-performance.')
}

const resolvedStatePath = resolve(statePath)
if (basename(resolvedStatePath) !== 'state.json' || !isWithin(tmpdir(), resolvedStatePath)) {
  throw new Error('Refusing to read state outside a temporary scratch directory.')
}
const state = JSON.parse(await readFile(resolvedStatePath, 'utf8'))
const resolvedStateDir = resolve(state.stateDir)
const resolvedHome = resolve(state.home)
const resolvedProject = resolve(state.project.path)
const liveHome = resolve(process.env.DSH_LIVE_HOME ?? join(homedir(), '.dsh'))
const scratchOrigin = new URL(state.origin)
const safeTempRoot = await realpath(tmpdir())
if (
  typeof state.name !== 'string' ||
  !/^ade-speed-[a-z0-9-]+$/u.test(state.name) ||
  resolvedStatePath !== resolve(resolvedStateDir, 'state.json') ||
  basename(resolvedStateDir) !== state.name ||
  basename(dirname(resolvedStateDir)) !== 'dshx-dev' ||
  !isWithin(tmpdir(), resolvedStateDir) ||
  !isWithin(tmpdir(), resolvedHome) ||
  !basename(resolvedHome).startsWith('dshx-boot-profile-') ||
  !isWithin(safeTempRoot, resolvedProject) ||
  isWithin(liveHome, resolvedHome) ||
  isWithin(resolvedHome, liveHome) ||
  state.project.ownedByScratch !== true ||
  !Number.isInteger(state.port) ||
  state.port < 1024 ||
  state.port > 65535 ||
  state.port === 3080 ||
  scratchOrigin.protocol !== 'http:' ||
  scratchOrigin.hostname !== '127.0.0.1' ||
  scratchOrigin.port !== String(state.port) ||
  scratchOrigin.username !== '' ||
  scratchOrigin.password !== '' ||
  scratchOrigin.search !== '' ||
  scratchOrigin.hash !== '' ||
  !Number.isInteger(state.browser?.cdpPort) ||
  state.browser.cdpPort === state.port ||
  state.browser.cdpPort === 3080 ||
  state.fakeProvider === undefined
) {
  throw new Error('Refusing to run unless every path and loopback port belongs to an isolated scratch DSH.')
}
const [realStateDir, realHome, realProject] = await Promise.all([realpath(resolvedStateDir), realpath(resolvedHome), realpath(resolvedProject)])
if (
  realStateDir !== resolve(safeTempRoot, 'dshx-dev', state.name) ||
  !isWithin(safeTempRoot, realHome) ||
  !basename(realHome).startsWith('dshx-boot-profile-') ||
  !isWithin(realHome, realProject)
) {
  throw new Error('Refusing to run unless scratch state, home, and project resolve inside temporary storage.')
}

const percentile = (values, fraction) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return Number(sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)].toFixed(2))
}
const summarize = samples => ({
  count: samples.length,
  p50Ms: percentile(
    samples.map(sample => sample.contentVisibleMs),
    0.5,
  ),
  p95Ms: percentile(
    samples.map(sample => sample.contentVisibleMs),
    0.95,
  ),
  maxMs: percentile(
    samples.map(sample => sample.contentVisibleMs),
    1,
  ),
  maxFrameGapMs: percentile(
    samples.flatMap(sample => sample.frameGapsMs),
    1,
  ),
  longTaskCount: samples.reduce((total, sample) => total + sample.longTaskMs.length, 0),
  maxLongTaskMs: percentile(
    samples.flatMap(sample => sample.longTaskMs),
    1,
  ),
})
const waitTwoFrames = async page => page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
const isInViewport = async locator =>
  locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
  })
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(state.browser.cdpPort)}`)
try {
  const page = browser
    .contexts()
    .flatMap(context => context.pages())
    .find(candidate => {
      try {
        return new URL(candidate.url()).origin === scratchOrigin.origin
      } catch {
        return false
      }
    })
  if (page === undefined) throw new Error('The scratch browser has no page for its recorded loopback origin.')
  page.setDefaultTimeout(15_000)
  const runningRows = async () =>
    page.locator('[role="treeitem"][data-row-key^="session:"]').evaluateAll(rows => rows.filter(row => /^Running(?:\s|$)/u.test(row.innerText.trim())).length)
  const runningRowsBefore = await runningRows()
  if (runningRowsBefore < 20) throw new Error(`Expected at least 20 visible running rows, found ${String(runningRowsBefore)}.`)

  await page.evaluate(() => {
    const monitor = { enabled: false, running: true, lastFrameAt: performance.now(), startedAt: 0, frameGapsMs: [], longTaskMs: [], rafId: 0 }
    Object.defineProperty(window, '__adeLongHistoryMonitor', { value: monitor, configurable: true })
    let observer
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      observer = new PerformanceObserver(entries => {
        if (monitor.enabled) monitor.longTaskMs.push(...entries.getEntries().map(entry => entry.duration))
      })
      observer.observe({ type: 'longtask' })
    }
    const recordFrame = now => {
      if (monitor.enabled) monitor.frameGapsMs.push(now - monitor.lastFrameAt)
      monitor.lastFrameAt = now
      if (monitor.running) monitor.rafId = requestAnimationFrame(recordFrame)
    }
    monitor.rafId = requestAnimationFrame(recordFrame)
    monitor.stop = () => {
      monitor.running = false
      cancelAnimationFrame(monitor.rafId)
      observer?.disconnect()
    }
  })
  const startMeasurement = async () =>
    page.evaluate(() => {
      const monitor = window.__adeLongHistoryMonitor
      monitor.enabled = true
      monitor.frameGapsMs = []
      monitor.longTaskMs = []
      monitor.lastFrameAt = performance.now()
      monitor.startedAt = performance.now()
    })
  const endMeasurement = async () =>
    page.evaluate(() => {
      const monitor = window.__adeLongHistoryMonitor
      const contentVisibleMs = performance.now() - monitor.startedAt
      monitor.enabled = false
      return {
        contentVisibleMs: Number(contentVisibleMs.toFixed(2)),
        frameGapsMs: monitor.frameGapsMs.filter(value => value >= 0).map(value => Number(value.toFixed(2))),
        longTaskMs: monitor.longTaskMs.map(value => Number(value.toFixed(2))),
      }
    })
  const readSnapshot = async turn =>
    page.evaluate(
      turn => ({
        turn,
        domNodeCount: document.getElementsByTagName('*').length,
        transcriptFlowItems: document.querySelectorAll('[data-chat-flow-key]').length,
        usedHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        totalHeapBytes: performance.memory?.totalJSHeapSize ?? null,
      }),
      turn,
    )

  const existingHistoryRow = page.getByRole('treeitem').filter({ hasText: historyTitle }).last()
  const composer = page.locator('[role="textbox"][contenteditable="true"]')
  let startTurn = 1
  if ((await existingHistoryRow.count()) > 0) {
    await existingHistoryRow.click({ timeout: 10_000 })
    const completedTurns = await page.evaluate(() =>
      Math.max(
        0,
        ...[...document.querySelectorAll('[data-turn-process-answer]')].flatMap(node =>
          [...(node.textContent ?? '').matchAll(/long-history-answer-(\d{4})/gu)].map(match => Number(match[1])),
        ),
      ),
    )
    startTurn = completedTurns + 1
  } else {
    await page
      .getByRole('button', { name: /^(?:New thread|New session)$/i })
      .first()
      .click({ timeout: 10_000 })
    if (!(await composer.isVisible())) {
      await page.getByRole('treeitem').filter({ hasText: 'New Session' }).last().click({ timeout: 10_000 })
    }
  }
  if (startTurn > turns) throw new Error(`Existing long history already contains ${String(startTurn - 1)} turns.`)
  const historyDepthBefore = startTurn - 1
  await composer.waitFor({ state: 'visible', timeout: 10_000 })
  const modelPicker = page.getByRole('button', { name: /^(?:Select model|.+,\s*reasoning)/u }).first()
  const modelLabel = (await modelPicker.getAttribute('aria-label')) ?? ''
  if (!modelLabel.includes(commandCodeModel)) {
    await modelPicker.click({ timeout: 5_000 })
    const routeOption = page
      .getByRole('menuitemradio', { name: commandCodeModel, exact: true })
      .or(page.getByRole('list', { name: 'Models grouped by provider', exact: true }).getByRole('button').filter({ hasText: commandCodeModel }))
    await routeOption.first().click({ timeout: 10_000 })
    await page.keyboard.press('Escape')
  }

  const samples = []
  const snapshots = [await readSnapshot(startTurn - 1)]
  let lastAnswer = ''
  for (let turn = startTurn; turn <= turns; turn += 1) {
    const number = String(turn).padStart(4, '0')
    lastAnswer = `long-history-answer-${number}`
    const prompt = turn === 1 ? `[[title ${historyTitle}]] [[answer ${lastAnswer}]]` : `history-turn-${number} [[answer ${lastAnswer}]]`
    await startMeasurement()
    await composer.fill(prompt, { timeout: 10_000 })
    await composer.press('Enter', { timeout: 10_000 })
    const answer = page.getByText(lastAnswer, { exact: true })
    await answer.waitFor({ state: 'visible', timeout: 20_000 })
    await answer.scrollIntoViewIfNeeded({ timeout: 10_000 })
    await waitTwoFrames(page)
    const answerInViewport = await isInViewport(answer)
    const metrics = await endMeasurement()
    samples.push({ turn, correctContentVisible: (await answer.isVisible()) && answerInViewport, answerInViewport, ...metrics })
    if (turn % 10 === 0 || turn === turns) snapshots.push(await readSnapshot(turn))
  }

  const titleRow = page.getByRole('treeitem').filter({ hasText: historyTitle }).last()
  await titleRow.waitFor({ state: 'visible', timeout: 10_000 })
  const communicationButton = page.getByRole('button', { name: 'Communication', exact: true })
  await startMeasurement()
  await communicationButton.click({ timeout: 10_000 })
  await page.getByRole('combobox', { name: 'Message a thread…', exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  await waitTwoFrames(page)
  const communicationOpen = await endMeasurement()
  await startMeasurement()
  await titleRow.click({ timeout: 10_000 })
  const finalAnswer = page.getByText(lastAnswer, { exact: true })
  await finalAnswer.waitFor({ state: 'visible', timeout: 20_000 })
  await finalAnswer.scrollIntoViewIfNeeded({ timeout: 10_000 })
  await waitTwoFrames(page)
  const warmHistoryReturnInViewport = await isInViewport(finalAnswer)
  const warmHistoryReturn = await endMeasurement()

  await page.evaluate(() => window.__adeLongHistoryMonitor.stop())
  const beforeReload = await readSnapshot(turns)
  const reloadStartedAt = Date.now()
  await page.goto(state.launchUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-slot="root"]').first().waitFor({ state: 'attached', timeout: 30_000 })
  const reloadedTitleRow = page.getByRole('treeitem').filter({ hasText: historyTitle }).last()
  await reloadedTitleRow.click({ timeout: 20_000 })
  const reloadedAnswer = page.getByText(lastAnswer, { exact: true })
  await reloadedAnswer.waitFor({ state: 'visible', timeout: 30_000 })
  await reloadedAnswer.scrollIntoViewIfNeeded({ timeout: 10_000 })
  await waitTwoFrames(page)
  const reloadedContentInViewport = await isInViewport(reloadedAnswer)
  const clientReloadAndHistoryReopenMs = Date.now() - reloadStartedAt
  const afterReload = await page.evaluate(() => ({
    domNodeCount: document.getElementsByTagName('*').length,
    transcriptFlowItems: document.querySelectorAll('[data-chat-flow-key]').length,
    usedHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    totalHeapBytes: performance.memory?.totalJSHeapSize ?? null,
  }))
  const runningRowsAfterReload = await runningRows()
  const result = {
    capturedAt: new Date().toISOString(),
    scratchName: state.name,
    scratchPort: state.port,
    browserVersion: browser.version(),
    viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio })),
    activeRunningRowsBefore: runningRowsBefore,
    activeRunningRowsAfterClientReload: runningRowsAfterReload,
    historyTurns: turns,
    historyDepthBefore,
    historyDepthAfter: samples.at(-1)?.turn ?? historyDepthBefore,
    correctContentSamples: samples.length,
    allCorrectContentVisible: samples.every(sample => sample.correctContentVisible),
    contentVisibleSummary: summarize(samples),
    samples,
    snapshots,
    communicationOpen,
    warmHistoryReturn,
    warmHistoryReturnInViewport,
    clientReloadAndHistoryReopenMs,
    reloadedContentInViewport,
    beforeReload,
    afterReload,
    caveats: [
      'Every history turn uses a local fake provider; no subscription or external network is used.',
      'Content visibility is the exact answer locator becoming visible plus two animation frames; it is not compositor-paint or occlusion proof.',
      'Client reload keeps the scratch DSH Host process warm; this does not measure a cold Host restart.',
      'The active-row count is the visible Running row count; provider request-attempt logging is not used as ground truth.',
    ],
  }
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (outputPath === undefined) process.stdout.write(serialized)
  else {
    await writeFile(outputPath, serialized)
    process.stdout.write(
      JSON.stringify(
        {
          outputPath,
          scratchName: state.name,
          activeRunningRowsBefore: runningRowsBefore,
          historyTurns: turns,
          historyDepthBefore,
          historyDepthAfter: result.historyDepthAfter,
          measuredTurns: samples.length,
          allCorrectContentVisible: result.allCorrectContentVisible,
          contentVisibleSummary: result.contentVisibleSummary,
          snapshots,
          communicationOpenMs: communicationOpen.contentVisibleMs,
          warmHistoryReturnMs: warmHistoryReturn.contentVisibleMs,
          warmHistoryReturnInViewport,
          clientReloadAndHistoryReopenMs,
          reloadedContentInViewport,
          activeRunningRowsAfterClientReload: runningRowsAfterReload,
        },
        null,
        2,
      ) + '\n',
    )
  }
} finally {
  await browser.close()
}
