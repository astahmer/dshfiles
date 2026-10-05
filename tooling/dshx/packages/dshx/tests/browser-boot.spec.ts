import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { readClientBootOutcome } from '../src/project/browser-boot.js'

describe('native browser boot outcome', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser.close()
  })

  it('reads native readiness and every Slot error boundary across the browser boundary', async () => {
    const page = await browser.newPage()
    try {
      await page.setContent(
        '<div data-dsh-boot>Boot completed</div><div id="root"><div data-slot-error="sidebar"></div><div data-slot-error="conversation.input.overlay"></div></div>',
      )
      await page.evaluate(() => {
        Reflect.set(globalThis, '__DSH_BOOT__', { entries: [{ id: '@dshfiles/demo' }] })
        Reflect.set(globalThis, '__DSH_BOOT_READY__', { promise: Promise.resolve() })
      })

      const outcome = await readClientBootOutcome(page, {
        expectedClientEntries: ['@dshfiles/demo'],
        timeoutMs: 1_000,
      })

      expect(outcome.ready).toBe(true)
      expect(outcome.missingClientEntries).toEqual([])
      expect(outcome.text).toBe('Boot completed')
      expect(outcome.slotFailures).toEqual([{ slot: 'sidebar' }, { slot: 'conversation.input.overlay' }])
    } finally {
      await page.close()
    }
  })
})
