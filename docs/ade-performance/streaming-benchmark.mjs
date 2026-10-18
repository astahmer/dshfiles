#!/usr/bin/env node
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const planDirectory = dirname(fileURLToPath(import.meta.url))
const { chromium } = createRequire(new URL('../../tooling/dshx/packages/dshx/package.json', import.meta.url))('playwright')
const statePath = process.argv[2]
const sampleCount = Number(process.argv[3] ?? '10')
const outputPath = process.argv[4] === undefined ? undefined : resolve(process.argv[4])
const commandCodeModel = 'commandcode_work/gpt-6-luna'
const composerSelector = '[role="textbox"][contenteditable="true"]'
const historyTitle = 'ADE Perf Streaming'
const streamDelayMs = 40
const wordCount = 24
const isWithin = (parent, child) => {
  const relativePath = relative(resolve(parent), resolve(child))
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

if (statePath === undefined || !Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > 30) {
  throw new Error('Usage: streaming-benchmark.mjs <scratch-state.json> [samples=10] [output.json]')
}
if (
  outputPath !== undefined &&
  (!isWithin(planDirectory, outputPath) || dirname(outputPath) !== planDirectory || !/^streaming-results-[a-z0-9-]+\.json$/u.test(basename(outputPath)))
) {
  throw new Error('The output JSON must stay directly inside plans/ade-performance and use a streaming-results-*.json name.')
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
const summarize = values => ({
  count: values.length,
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  maxMs: percentile(values, 1),
})
const waitTwoFrames = async page => page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
const inViewport = async locator =>
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
  const activeRowsBefore = await runningRows()
  if (activeRowsBefore < 20) throw new Error(`Expected at least 20 visible running rows, found ${String(activeRowsBefore)}.`)

  await page
    .getByRole('button', { name: /^(?:New thread|New session)$/i })
    .first()
    .click({ timeout: 10_000 })
  const composer = page.locator(composerSelector)
  if (!(await composer.isVisible())) {
    await page.getByRole('treeitem').filter({ hasText: 'New Session' }).last().click({ timeout: 10_000 })
  }
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
  await composer.fill(`[[title ${historyTitle}]] [[answer streaming-ready]]`)
  await composer.press('Enter')
  await page.getByText('streaming-ready', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
  await page.evaluate(() => {
    const observation = {
      active: false,
      answerText: '',
      firstWord: '',
      words: [],
      lastObservedText: '',
      startedAt: 0,
      firstMutationMs: null,
      firstContentVisibleMs: null,
      completeMutationMs: null,
      completeContentVisibleMs: null,
      visibleWordCounts: [],
      frameGapsMs: [],
      longTaskMs: [],
      lastFrameAt: performance.now(),
      firstFrameScheduled: false,
      completeFrameScheduled: false,
    }
    Object.defineProperty(window, '__adeStreamObservation', { value: observation, configurable: true })
    const scheduleVisibleTime = (field, pendingField) => {
      if (observation[pendingField]) return
      observation[pendingField] = true
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          observation[field] = performance.now() - observation.startedAt
        }),
      )
    }
    const observer = new MutationObserver(() => {
      if (!observation.active) return
      const flowItem = [...document.querySelectorAll('[data-chat-flow-key]')].find(node => {
        const text = (node.textContent ?? '').trimStart()
        return text.includes(observation.firstWord) && !text.includes('[[answer')
      })
      if (flowItem === undefined) return
      const text = (flowItem.textContent ?? '').trim()
      if (!text.includes(observation.firstWord) || text === observation.lastObservedText) return
      observation.lastObservedText = text
      const visibleWords = observation.words.filter(word => text.includes(word)).length
      const lastVisibleWordCount = observation.visibleWordCounts.at(-1) ?? 0
      if (visibleWords > lastVisibleWordCount) observation.visibleWordCounts.push(visibleWords)
      if (observation.firstMutationMs === null && visibleWords > 0) {
        observation.firstMutationMs = performance.now() - observation.startedAt
        scheduleVisibleTime('firstContentVisibleMs', 'firstFrameScheduled')
      }
      if (observation.completeMutationMs === null && text.includes(observation.answerText)) {
        observation.completeMutationMs = performance.now() - observation.startedAt
        scheduleVisibleTime('completeContentVisibleMs', 'completeFrameScheduled')
      }
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    observation.disconnectObserver = () => observer.disconnect()
    let longTaskObserver
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      longTaskObserver = new PerformanceObserver(entries => {
        if (observation.active) observation.longTaskMs.push(...entries.getEntries().map(entry => entry.duration))
      })
      longTaskObserver.observe({ type: 'longtask' })
    }
    observation.disconnectLongTasks = () => longTaskObserver?.disconnect()
    const recordFrame = now => {
      if (observation.active) observation.frameGapsMs.push(now - observation.lastFrameAt)
      observation.lastFrameAt = now
      requestAnimationFrame(recordFrame)
    }
    requestAnimationFrame(recordFrame)
  })

  const samples = []
  const snapshots = []
  for (let sample = 1; sample <= sampleCount; sample += 1) {
    const number = String(sample).padStart(2, '0')
    const words = Array.from({ length: wordCount }, (_, index) => `stream-${number}-word-${String(index + 1).padStart(2, '0')}`)
    const answerText = words.join(' ')
    await page.evaluate(
      ({ selectedAnswer, selectedWords }) => {
        const observation = window.__adeStreamObservation
        observation.active = true
        observation.answerText = selectedAnswer
        observation.firstWord = selectedWords[0]
        observation.words = selectedWords
        observation.lastObservedText = ''
        observation.startedAt = performance.now()
        observation.firstMutationMs = null
        observation.firstContentVisibleMs = null
        observation.completeMutationMs = null
        observation.completeContentVisibleMs = null
        observation.visibleWordCounts = []
        observation.frameGapsMs = []
        observation.longTaskMs = []
        observation.lastFrameAt = performance.now()
        observation.firstFrameScheduled = false
        observation.completeFrameScheduled = false
      },
      { selectedAnswer: answerText, selectedWords: words },
    )
    await composer.fill(`[[stream ${String(streamDelayMs)}]] [[answer ${answerText}]]`)
    await composer.press('Enter')
    await page.waitForFunction(() => window.__adeStreamObservation.completeContentVisibleMs !== null, null, { timeout: 30_000 })
    const exactAnswer = page.getByText(answerText, { exact: true })
    await exactAnswer.waitFor({ state: 'visible', timeout: 10_000 })
    await exactAnswer.scrollIntoViewIfNeeded({ timeout: 10_000 })
    await waitTwoFrames(page)
    const answerInViewport = await inViewport(exactAnswer)
    const metrics = await page.evaluate(() => {
      const observation = window.__adeStreamObservation
      observation.active = false
      return {
        firstContentVisibleMs: Number(observation.firstContentVisibleMs?.toFixed(2) ?? 'NaN'),
        firstContentMutationMs: Number(observation.firstMutationMs?.toFixed(2) ?? 'NaN'),
        completeContentVisibleMs: Number(observation.completeContentVisibleMs?.toFixed(2) ?? 'NaN'),
        completeMutationMs: Number(observation.completeMutationMs?.toFixed(2) ?? 'NaN'),
        visibleWordCounts: observation.visibleWordCounts,
        frameGapsMs: observation.frameGapsMs.filter(value => value >= 0).map(value => Number(value.toFixed(2))),
        longTaskMs: observation.longTaskMs.map(value => Number(value.toFixed(2))),
      }
    })
    if (!Number.isFinite(metrics.firstContentVisibleMs) || !Number.isFinite(metrics.completeContentVisibleMs)) {
      throw new Error(`Stream sample ${number} did not record first and complete content visibility.`)
    }
    if (metrics.visibleWordCounts.length < 2 || metrics.visibleWordCounts.at(-1) !== wordCount) {
      throw new Error(`Stream sample ${number} did not show multiple progressive states through all ${String(wordCount)} words.`)
    }
    samples.push({ sample, correctContentVisible: (await exactAnswer.isVisible()) && answerInViewport, answerInViewport, ...metrics })
    if (sample === 1 || sample % 5 === 0 || sample === sampleCount) {
      snapshots.push(
        await page.evaluate(
          sampleNumber => ({
            sample: sampleNumber,
            domNodeCount: document.getElementsByTagName('*').length,
            transcriptFlowItems: document.querySelectorAll('[data-chat-flow-key]').length,
            usedHeapBytes: performance.memory?.usedJSHeapSize ?? null,
            totalHeapBytes: performance.memory?.totalJSHeapSize ?? null,
          }),
          sample,
        ),
      )
    }
  }
  await page.evaluate(() => {
    window.__adeStreamObservation.disconnectObserver()
    window.__adeStreamObservation.disconnectLongTasks()
  })
  const activeRowsAfter = await runningRows()
  const results = {
    capturedAt: new Date().toISOString(),
    scratchName: state.name,
    scratchPort: state.port,
    browserVersion: browser.version(),
    viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio })),
    activeRowsBefore: activeRowsBefore,
    activeRowsAfter: activeRowsAfter,
    sampleCount,
    wordCount,
    streamDelayMs,
    allCorrectContentVisible: samples.every(sample => sample.correctContentVisible),
    allSamplesProgressive: samples.every(sample => sample.visibleWordCounts.length > 1 && sample.visibleWordCounts.at(-1) === wordCount),
    firstContentSummary: summarize(samples.map(sample => sample.firstContentVisibleMs)),
    completeContentSummary: summarize(samples.map(sample => sample.completeContentVisibleMs)),
    progressiveStateCounts: samples.map(sample => sample.visibleWordCounts.length),
    maxFrameGapMs: percentile(
      samples.flatMap(sample => sample.frameGapsMs),
      1,
    ),
    longTaskCount: samples.reduce((total, sample) => total + sample.longTaskMs.length, 0),
    maxLongTaskMs: percentile(
      samples.flatMap(sample => sample.longTaskMs),
      1,
    ),
    samples,
    snapshots,
    caveats: [
      'Every response uses a loopback fake provider and 40 ms inter-word delay; no external model, account quota, or provider latency is measured.',
      'The first streamed state is an assistant flow item beginning with a unique answer token; a final-only answer attribute is not used.',
      'Content visibility is exact answer text in the viewport after two animation frames, not compositor-paint or occlusion proof.',
      'The workload has 20 visible Running rows, but hold-request count is not used as ground truth because provider log telemetry is unavailable.',
    ],
  }
  const serialized = `${JSON.stringify(results, null, 2)}\n`
  if (outputPath === undefined) process.stdout.write(serialized)
  else {
    await writeFile(outputPath, serialized)
    process.stdout.write(
      JSON.stringify(
        {
          outputPath,
          scratchName: state.name,
          activeRowsBefore,
          activeRowsAfter,
          sampleCount,
          wordCount,
          streamDelayMs,
          allCorrectContentVisible: results.allCorrectContentVisible,
          firstContentSummary: results.firstContentSummary,
          completeContentSummary: results.completeContentSummary,
          progressiveStateCounts: results.progressiveStateCounts,
          maxFrameGapMs: results.maxFrameGapMs,
          longTaskCount: results.longTaskCount,
          maxLongTaskMs: results.maxLongTaskMs,
        },
        null,
        2,
      ) + '\n',
    )
  }
} finally {
  await browser.close()
}
