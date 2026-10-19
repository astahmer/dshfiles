import { chromium } from '@playwright/test'

// What a browser pool could actually save: one launch per Playwright process, then one context per scenario.
// Evidence for plans/e2e-speed: the Host's startup, not the browser, is what a scenario waits on.
const browser = await chromium.launch()
const contexts = []
for (let index = 0; index < 10; index += 1) {
  const startedAt = Date.now()
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('about:blank')
  contexts.push(Date.now() - startedAt)
  await context.close()
}
await browser.close()

const sorted = [...contexts].sort((left, right) => left - right)
console.log(JSON.stringify({ contextsMs: contexts, medianContextMs: sorted[Math.floor(sorted.length / 2)], maxContextMs: sorted.at(-1) }, null, 1))
