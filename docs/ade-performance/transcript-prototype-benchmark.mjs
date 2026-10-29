#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, relative, sep, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const planDirectory = dirname(fileURLToPath(import.meta.url))
const htmlPath = resolve(planDirectory, 'transcript-prototype.html')
const sampleCount = Number(process.argv[2] ?? '10')
const outputPath = process.argv[3] === undefined ? undefined : resolve(process.argv[3])
const { chromium } = createRequire(new URL('../../tooling/dshx/packages/dshx/package.json', import.meta.url))('playwright')
const modes = ['eager', 'contained', 'windowed']
const messageCount = 1000
const expectedOldest = 'Message 0001 — deterministic assistant content with a short summary and a repeated context marker.'
const expectedNewest = 'Message 1000 — deterministic assistant content with a short summary and a repeated context marker.'
const isWithin = (parent, child) => {
  const relativePath = relative(resolve(parent), resolve(child))
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

if (!Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > 100) {
  throw new Error('Usage: transcript-prototype-benchmark.mjs [samples=10] [output.json]')
}
if (
  outputPath !== undefined &&
  (!isWithin(planDirectory, outputPath) || dirname(outputPath) !== planDirectory || basename(outputPath) !== 'transcript-prototype-results.json')
) {
  throw new Error('The output path must be docs/ade-performance/transcript-prototype-results.json.')
}
const html = await readFile(htmlPath, 'utf8')
const percentile = (values, fraction) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return Number(sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)].toFixed(2))
}
const summarize = samples => ({
  count: samples.length,
  p50Ms: percentile(samples, 0.5),
  p95Ms: percentile(samples, 0.95),
  maxMs: percentile(samples, 1),
})
const browser = await chromium.launch({ headless: true })
try {
  const results = []
  for (const mode of modes) {
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
      const page = await context.newPage()
      try {
        await page.addInitScript(() => {
          window.__ADE_BENCHMARK_MODE__ = true
        })
        await page.setContent(html, { waitUntil: 'load' })
        await page.evaluate(() => {
          const monitor = { enabled: true, running: true, lastFrameAt: performance.now(), frameGapsMs: [], longTaskMs: [], rafId: 0 }
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
            monitor.enabled = false
            monitor.running = false
            cancelAnimationFrame(monitor.rafId)
            observer?.disconnect()
          }
          window.__ADEPrototypePerf = monitor
        })
        const mounted = await page.evaluate(selectedMode => window.buildPrototype(selectedMode, 1000), mode)
        const initialCorrectContentVisible = await page.evaluate(
          ({ selectedMode, expectedText }) => {
            const card = document.querySelector(`[data-prototype="${selectedMode}"]`)
            const row = card?.querySelector('[data-row-index="0"]')
            const text = row?.querySelector('.body')
            const rect = text?.getBoundingClientRect()
            const viewport = card?.querySelector('.viewport')?.getBoundingClientRect()
            return (
              text?.textContent === expectedText &&
              rect !== undefined &&
              viewport !== undefined &&
              rect.bottom > viewport.top &&
              rect.top < viewport.bottom &&
              getComputedStyle(text).visibility === 'visible'
            )
          },
          { selectedMode: mode, expectedText: expectedOldest },
        )
        if (!initialCorrectContentVisible) throw new Error(`${mode} did not show the correct oldest row after two frames.`)
        const scrollStartedAt = await page.evaluate(selectedMode => {
          const card = document.querySelector(`[data-prototype="${selectedMode}"]`)
          const viewport = card?.querySelector('.viewport')
          if (viewport === null || viewport === undefined) throw new Error('Prototype viewport is missing.')
          const startedAt = performance.now()
          viewport.scrollTop = viewport.scrollHeight
          return startedAt
        }, mode)
        await page.waitForFunction(
          ({ selectedMode, expectedText }) => {
            const card = document.querySelector(`[data-prototype="${selectedMode}"]`)
            const viewport = card?.querySelector('.viewport')
            const row = card?.querySelector('[data-row-index="999"]')
            const text = row?.querySelector('.body')
            if (viewport === null || viewport === undefined || text?.textContent !== expectedText) return false
            const bounds = text.getBoundingClientRect()
            const viewportBounds = viewport.getBoundingClientRect()
            return bounds.bottom > viewportBounds.top && bounds.top < viewportBounds.bottom
          },
          { selectedMode: mode, expectedText: expectedNewest },
          { timeout: 10_000 },
        )
        await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
        const measured = await page.evaluate(startedAt => {
          const card = document.querySelector('.prototype')
          const monitor = window.__ADEPrototypePerf
          const scrollToNewestVisibleMs = performance.now() - startedAt
          monitor.stop()
          return {
            scrollToNewestVisibleMs: Number(scrollToNewestVisibleMs.toFixed(2)),
            newestVisibleRows: card?.querySelectorAll('[data-row-index]').length ?? 0,
            cardDomNodes: card?.querySelectorAll('*').length ?? 0,
            frameGapsMs: monitor.frameGapsMs.filter(value => value >= 0).map(value => Number(value.toFixed(2))),
            longTaskMs: monitor.longTaskMs.map(value => Number(value.toFixed(2))),
          }
        }, scrollStartedAt)
        results.push({
          mode,
          sample,
          messageCount,
          initialContentVisibleMs: mounted[mode].contentVisibleMs,
          initialMountedRows: mounted[mode].mountedRows,
          initialDomNodes: mounted[mode].domNodes,
          initialCorrectContentVisible,
          newestCorrectContentVisible: true,
          ...measured,
        })
      } finally {
        await context.close()
      }
    }
  }
  const summaries = Object.fromEntries(
    modes.map(mode => {
      const samples = results.filter(result => result.mode === mode)
      return [
        mode,
        {
          initialContentVisibleMs: summarize(samples.map(sample => sample.initialContentVisibleMs)),
          scrollToNewestVisibleMs: summarize(samples.map(sample => sample.scrollToNewestVisibleMs)),
          mountedRowsAtEnd: samples.at(-1)?.newestVisibleRows ?? null,
          cardDomNodesAtEnd: samples.at(-1)?.cardDomNodes ?? null,
          maxFrameGapMs: percentile(
            samples.flatMap(sample => sample.frameGapsMs),
            1,
          ),
          longTaskCount: samples.reduce((total, sample) => total + sample.longTaskMs.length, 0),
          maxLongTaskMs: percentile(
            samples.flatMap(sample => sample.longTaskMs),
            1,
          ),
          allCorrectContentVisible: samples.every(sample => sample.initialCorrectContentVisible && sample.newestCorrectContentVisible),
        },
      ]
    }),
  )
  const result = {
    capturedAt: new Date().toISOString(),
    browserVersion: browser.version(),
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    messageCount,
    sampleCount,
    rowHeightPx: 64,
    modes: summaries,
    samples: results,
    caveats: [
      'This is an isolated browser fixture; it does not render DSH, React, markdown, tool cards, or Host data.',
      'Every synthetic row has fixed 64 px height. Variable-height content, scroll anchoring, selection, focus, accessibility, and streaming updates are not modeled.',
      'The windowed mode is a small fixed-height demonstration, not a production TanStack Virtual implementation.',
      'Content visibility is exact synthetic text in the viewport after two animation frames, not compositor-paint proof.',
    ],
  }
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (outputPath === undefined) process.stdout.write(serialized)
  else {
    await writeFile(outputPath, serialized)
    process.stdout.write(JSON.stringify({ outputPath, browserVersion: result.browserVersion, messageCount, sampleCount, modes: summaries }, null, 2) + '\n')
  }
} finally {
  await browser.close()
}
