import { chromium } from 'playwright'
import { cases, setup } from './dsh-web.bench.ts'
import { scratchFixture, viewport } from './fixtures.ts'

const { launchUrl } = scratchFixture()
const names = process.argv.slice(2)
if (names.length === 0) names.push(...Object.keys(cases))
for (const name of names) {
  if (!Object.hasOwn(cases, name)) throw new Error(`Unknown benchmark case: ${name}`)
}

// Same phases and readiness conditions as Strobe, but no Strobe launch or CDP attachment.
// A new Playwright context per case matches Strobe's fresh browser profile per block.
const browser = await chromium.launch({ headless: true })
try {
  for (const name of names) {
    const context = await browser.newContext({ viewport })
    try {
      const tab = await context.newPage()
      await tab.goto(launchUrl)
      const waitFor = async (selector, { text, timeout } = {}) => {
        const locator = tab.locator(selector)
        await (text === undefined ? locator : locator.filter({ hasText: text })).filter({ visible: true }).first().waitFor({ timeout })
      }
      const page = {
        goto: to => tab.goto(to),
        waitFor,
        async click(selector, { until } = {}) {
          await tab.locator(selector).filter({ visible: true }).first().click()
          if (until !== undefined) await waitFor(until)
        },
      }
      const timings = []
      await setup({ page, case: name })
      const benchmark = cases[name]
      for (let i = 0; i < 5; i += 1) {
        if (i > 0) await benchmark.reset?.({ page })
        await benchmark.run({
          page,
          async phase(_name, fn) {
            const start = performance.now()
            const result = await fn()
            timings.push(performance.now() - start)
            return result
          },
        })
      }
      timings.sort((a, b) => a - b)
      console.log(`${name}: ${timings[2].toFixed(1)} ms median (${timings[0].toFixed(1)}–${timings[4].toFixed(1)} ms; n=5; Playwright)`)
    } catch {
      throw new Error(`${name} failed in Playwright. Check the scratch instance and rerun the fixture seeder if needed.`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
