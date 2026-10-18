#!/usr/bin/env node
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { cpus, homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const packageRequire = createRequire(new URL('../../tooling/dshx/packages/dshx/package.json', import.meta.url))
const { chromium } = packageRequire('playwright')
const statePath = process.argv[2]
const sampleCount = Number(process.argv[3] ?? '20')
const outputPath = process.argv[4] === undefined ? undefined : resolve(process.argv[4])
const commandCodeModel = 'commandcode_work/gpt-6-luna'
const activeTitleFor = index => `ADE Perf active ${String(index).padStart(2, '0')}`
const activePromptFor = index => `[[title ${activeTitleFor(index)}]] [[hold]] active-load-${String(index).padStart(2, '0')}`
const activeTitle = activeTitleFor(1)
const activePrompt = activePromptFor(1)
const completedTitle = 'Fake thread title'
const completedContent = 'Tool finished.'
const isWithin = (parent, child) => {
  const relativePath = relative(resolve(parent), resolve(child))
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

if (statePath === undefined || !Number.isSafeInteger(sampleCount) || sampleCount < 1) {
  throw new Error('Usage: benchmark.mjs <scratch-state.json> [samples=20] [output.json]')
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
const validScratchName = typeof state.name === 'string' && /^ade-speed-[a-z0-9-]+$/u.test(state.name)
const expectedStateFile = resolve(resolvedStateDir, 'state.json')
const safeTempRoot = await realpath(tmpdir())
if (
  !validScratchName ||
  resolvedStatePath !== expectedStateFile ||
  basename(resolvedStateDir) !== state.name ||
  basename(dirname(resolvedStateDir)) !== 'dshx-dev' ||
  !isWithin(tmpdir(), resolvedStateDir) ||
  !isWithin(tmpdir(), resolvedHome) ||
  !isWithin(safeTempRoot, resolvedProject) ||
  !basename(resolvedHome).startsWith('dshx-boot-profile-') ||
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
  state.browser.cdpPort === 3080
) {
  throw new Error('Refusing to benchmark unless every path and loopback port belongs to an isolated scratch DSH.')
}
const [realStateDir, realHome, realProject] = await Promise.all([realpath(resolvedStateDir), realpath(resolvedHome), realpath(resolvedProject)])
if (
  realStateDir !== resolve(safeTempRoot, 'dshx-dev', state.name) ||
  !isWithin(safeTempRoot, realHome) ||
  !basename(realHome).startsWith('dshx-boot-profile-') ||
  !isWithin(realHome, realProject)
) {
  throw new Error('Refusing to benchmark unless scratch state, home, and project resolve inside temporary storage.')
}
if (state.fakeProvider === undefined) throw new Error('The scratch state has no tracked fake provider.')

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

const readHoldCount = async () => {
  const log = await readFile(resolve(state.stateDir, 'fake-provider.log'), 'utf8').catch(() => '')
  return log.split(/\r?\n/u).flatMap(line => {
    try {
      const event = JSON.parse(line)
      return event.event === 'fake-provider-chat' && event.kind === 'turn' && event.messages.some(message => message.hasHoldDirective) ? [event] : []
    } catch {
      return []
    }
  }).length
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(state.browser.cdpPort)}`)
try {
  const pages = browser.contexts().flatMap(context => context.pages())
  const page = pages.find(candidate => {
    try {
      return new URL(candidate.url()).origin === scratchOrigin.origin
    } catch {
      return false
    }
  })
  if (page === undefined) throw new Error('The scratch browser has no page for its recorded loopback origin.')
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio }))
  const browserVersion = browser.version()
  const observations = []

  const waitTwoFrames = async () => page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
  const installMetrics = async () =>
    page.evaluate(() => {
      if (window.__adePerfMonitor !== undefined) window.__adePerfMonitor.running = false
      const monitor = { enabled: false, running: true, lastFrameAt: performance.now(), startedAt: 0, frameGapsMs: [], longTaskMs: [] }
      Object.defineProperty(window, '__adePerfMonitor', { value: monitor, configurable: true })
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        new PerformanceObserver(entries => {
          if (monitor.enabled) monitor.longTaskMs.push(...entries.getEntries().map(entry => entry.duration))
        }).observe({ type: 'longtask' })
      }
      const recordFrame = now => {
        if (monitor.enabled) monitor.frameGapsMs.push(now - monitor.lastFrameAt)
        monitor.lastFrameAt = now
        if (monitor.running) requestAnimationFrame(recordFrame)
      }
      requestAnimationFrame(recordFrame)
    })
  const startMeasurement = async () =>
    page.evaluate(() => {
      const monitor = window.__adePerfMonitor
      monitor.enabled = true
      monitor.frameGapsMs = []
      monitor.longTaskMs = []
      monitor.lastFrameAt = performance.now()
      monitor.startedAt = performance.now()
    })
  const endMeasurement = async () =>
    page.evaluate(() => {
      const monitor = window.__adePerfMonitor
      const contentVisibleMs = performance.now() - monitor.startedAt
      monitor.enabled = false
      return {
        contentVisibleMs: Number(contentVisibleMs.toFixed(2)),
        frameGapsMs: monitor.frameGapsMs.filter(value => value >= 0).map(value => Number(value.toFixed(2))),
        longTaskMs: monitor.longTaskMs.map(value => Number(value.toFixed(2))),
      }
    })
  const readSnapshot = async activeAgentCount => {
    const dom = await page.evaluate(() => ({
      nodeCount: document.getElementsByTagName('*').length,
      usedHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      totalHeapBytes: performance.memory?.totalJSHeapSize ?? null,
    }))
    const sessionRows = await page.locator('[role="treeitem"][data-row-key^="session:"]').evaluateAll(rows => ({
      count: rows.length,
      runningCount: rows.filter(row => /^Running(?:\s|$)/u.test(row.innerText.trim())).length,
    }))
    return {
      activeAgentCount,
      runningSessionRows: sessionRows.runningCount,
      holdRequestAttempts: await readHoldCount(),
      sessionRows: sessionRows.count,
      ...dom,
    }
  }

  const openSession = async title => page.getByRole('treeitem').filter({ hasText: title })
  const switchConversation = async target => {
    const content = target.kind === 'active' ? page.getByText(target.prompt, { exact: true }) : page.getByText(target.content, { exact: true })
    await startMeasurement()
    await (await openSession(target.title)).click({ timeout: 15000 })
    await content.waitFor({ state: 'visible', timeout: 15000 })
    if (target.kind === 'active') await page.getByText('Deep diving for', { exact: false }).waitFor({ state: 'visible', timeout: 10000 })
    await waitTwoFrames()
    const metrics = await endMeasurement()
    return { target: target.kind, title: target.title, correctContentVisible: await content.isVisible(), ...metrics }
  }

  const createHeldSession = async index => {
    const title = activeTitleFor(index)
    const prompt = activePromptFor(index)
    await page
      .getByRole('button', { name: /^(?:New thread|New session)$/i })
      .first()
      .click({ timeout: 10000 })
    const composer = page.locator('[role="textbox"][contenteditable="true"]')
    if (!(await composer.isVisible())) {
      await page.getByRole('treeitem').filter({ hasText: 'New Session' }).last().click({ timeout: 10000 })
    }
    await composer.waitFor({ state: 'visible', timeout: 10000 })
    const modelPicker = page.getByRole('button', { name: /^(?:Select model|.+,\s*reasoning)/u }).first()
    const modelLabel = (await modelPicker.getAttribute('aria-label')) ?? ''
    if (!modelLabel.includes(commandCodeModel)) {
      await modelPicker.click({ timeout: 5000 })
      const routeOption = page
        .getByRole('menuitemradio', { name: commandCodeModel, exact: true })
        .or(page.getByRole('list', { name: 'Models grouped by provider', exact: true }).getByRole('button').filter({ hasText: commandCodeModel }))
      await routeOption.first().click({ timeout: 10000 })
      await page.keyboard.press('Escape')
    }
    await startMeasurement()
    await composer.fill(prompt)
    await composer.press('Enter')
    const content = page.getByText(prompt, { exact: true })
    await content.waitFor({ state: 'visible', timeout: 15000 })
    await page.getByText('Deep diving for', { exact: false }).waitFor({ state: 'visible', timeout: 10000 })
    await (await openSession(title)).waitFor({ state: 'visible', timeout: 10000 })
    await waitTwoFrames()
    const metrics = await endMeasurement()
    const transcript = await page.locator('body').innerText()
    if (!transcript.includes(prompt) || !transcript.includes('Deep diving for') || transcript.includes('Answered by ke-key')) {
      throw new Error(`Active synthetic turn ${String(index)} did not remain visibly held.`)
    }
    return { index, title, correctContentVisible: await content.isVisible(), ...metrics }
  }

  const measurePanel = async ({ buttonName, contentLocator }) => {
    await startMeasurement()
    await page.getByRole('button', { name: buttonName, exact: true }).click({ timeout: 10000 })
    await contentLocator.waitFor({ state: 'visible', timeout: 10000 })
    await waitTwoFrames()
    const metrics = await endMeasurement()
    return { correctContentVisible: await contentLocator.isVisible(), ...metrics }
  }

  await installMetrics()
  const existingRunningRows = await page
    .locator('[role="treeitem"][data-row-key^="session:"]')
    .evaluateAll(rows => rows.filter(row => /^Running(?:\s|$)/u.test(row.innerText.trim())).length)
  if (existingRunningRows !== 0) throw new Error('Start from a fresh seeded scratch with no held turns.')
  const agentCreationSamples = [await createHeldSession(1)]
  let sessionsCreated = 1

  for (const activeAgentCount of [1, 5, 20]) {
    while (sessionsCreated < activeAgentCount) {
      agentCreationSamples.push(await createHeldSession(sessionsCreated + 1))
      sessionsCreated += 1
    }
    const snapshot = await readSnapshot(activeAgentCount)

    const activeTarget = index => ({ kind: 'active', title: activeTitleFor(index), prompt: activePromptFor(index) })
    const conversationTargets =
      activeAgentCount === 1
        ? [{ kind: 'completed', title: completedTitle, content: completedContent }, activeTarget(1)]
        : [activeTarget(activeAgentCount), activeTarget(activeAgentCount - 1)]
    const conversationSamples = []
    for (let index = 0; index < sampleCount; index += 1) {
      for (const target of conversationTargets) conversationSamples.push(await switchConversation(target))
    }
    const conversationSamplesByTitle = new Map()
    for (const sample of conversationSamples) {
      const titleSamples = conversationSamplesByTitle.get(sample.title) ?? []
      titleSamples.push(sample)
      conversationSamplesByTitle.set(sample.title, titleSamples)
    }
    const conversationSummariesByTitle = Object.fromEntries([...conversationSamplesByTitle].map(([title, samples]) => [title, summarize(samples)]))

    const activitySamples = []
    const accountSamples = []
    const activityReturnSamples = []
    for (let index = 0; index < Math.max(5, Math.ceil(sampleCount / 2)); index += 1) {
      activitySamples.push(
        await measurePanel({
          buttonName: 'Activity',
          contentLocator: page.getByText('Agent started work', { exact: true }).first(),
        }),
      )
      accountSamples.push(
        await measurePanel({
          buttonName: 'AI Accounts',
          contentLocator: page.getByRole('heading', { name: 'Command Code 1', exact: true }),
        }),
      )
      activityReturnSamples.push(
        await measurePanel({
          buttonName: 'Activity',
          contentLocator: page.getByText('Agent started work', { exact: true }).first(),
        }),
      )
      await switchConversation(activeTarget(activeAgentCount))
    }

    observations.push({
      activeAgentCount,
      snapshot,
      conversationTargets: conversationTargets.map(target => ({ kind: target.kind, title: target.title })),
      conversationSwitch: { summary: summarize(conversationSamples), byTitle: conversationSummariesByTitle, samples: conversationSamples },
      pluginNavigation: {
        activityOpen: { summary: summarize(activitySamples), samples: activitySamples },
        aiAccountsOpen: { summary: summarize(accountSamples), samples: accountSamples },
        activityReturn: { summary: summarize(activityReturnSamples), samples: activityReturnSamples },
      },
    })
  }

  const showMoreButton = page.getByRole('button', { name: /Show \d+ more sessions/i })
  const olderSessionPathStartedAt = await page.evaluate(() => performance.now())
  await startMeasurement()
  let revealClicks = 0
  while ((await showMoreButton.count()) > 0 && revealClicks < 10) {
    await showMoreButton.click({ timeout: 10000 })
    revealClicks += 1
    await waitTwoFrames()
  }
  if ((await showMoreButton.count()) > 0) throw new Error('The session list did not finish revealing older rows.')
  const oldestActiveRow = await openSession(activeTitle)
  await oldestActiveRow.waitFor({ state: 'visible', timeout: 10000 })
  await (await openSession(completedTitle)).waitFor({ state: 'visible', timeout: 10000 })
  const revealMetrics = await endMeasurement()
  await startMeasurement()
  await oldestActiveRow.click({ timeout: 10000 })
  const oldestActiveContent = page.getByText(activePrompt, { exact: true })
  await oldestActiveContent.waitFor({ state: 'visible', timeout: 15000 })
  await page.getByText('Deep diving for', { exact: false }).waitFor({ state: 'visible', timeout: 10000 })
  await waitTwoFrames()
  const switchMetrics = await endMeasurement()
  const olderSessionPathEndedAt = await page.evaluate(() => performance.now())
  const finalSnapshot = await readSnapshot(20)
  if (finalSnapshot.runningSessionRows !== 20)
    throw new Error(`Expected 20 running rows after expanding the session list, observed ${String(finalSnapshot.runningSessionRows)}.`)
  const olderSessionAccess = {
    revealClicks,
    olderRowsVisibleMs: revealMetrics.contentVisibleMs,
    transcriptSwitchMs: switchMetrics.contentVisibleMs,
    totalCorrectContentMs: Number((olderSessionPathEndedAt - olderSessionPathStartedAt).toFixed(2)),
    correctContentVisible: await oldestActiveContent.isVisible(),
    revealFrameGapsMs: revealMetrics.frameGapsMs,
    revealLongTaskMs: revealMetrics.longTaskMs,
    transcriptFrameGapsMs: switchMetrics.frameGapsMs,
    transcriptLongTaskMs: switchMetrics.longTaskMs,
  }
  await page.evaluate(() => {
    window.__adePerfMonitor.running = false
  })
  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    scratchName: state.name,
    scratchPort: state.port,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? null,
      bundles: state.bundles,
    },
    browserVersion,
    viewport,
    samplesPerDirection: sampleCount,
    agentCreation: { summary: summarize(agentCreationSamples), samples: agentCreationSamples },
    observations,
    olderSessionAccess,
    finalSnapshot,
    assumptions: [
      'Active agents are unique synthetic sessions held by the loopback fake provider; the visible Running row count verifies the expanded list, while provider request attempts are reported separately because a reconnect can retry a pending turn.',
      'Correct-content latency is the exact target locator becoming visible after two requestAnimationFrame callbacks; it is a content-visible proxy, not compositor-paint or occlusion proof.',
      'At higher session counts, recent rows stay visible while older rows require Show more; the older-session result includes expansion and transcript content visibility.',
      'Conversation samples require the exact destination transcript content plus two requestAnimationFrame callbacks after selection.',
      'Long-task and frame-gap values come from a page-local PerformanceObserver and requestAnimationFrame sampler; the sampler itself adds a small measurement overhead.',
      'Negative frame-gap deltas are excluded because a frame may have been scheduled before measurement start.',
      'Startup timings are measured separately around dshx dev up; this script measures the first agent turn after the application is already booted.',
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
          agentCreation: result.agentCreation.summary,
          snapshots: observations.map(item => item.snapshot),
          olderSessionAccess,
        },
        null,
        2,
      ) + '\n',
    )
  }
} finally {
  await browser.close()
}
