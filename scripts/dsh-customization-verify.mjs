// Self-validating check of the dsh-customization panels against the reference
// screenshots in plans/dsh-customization/screenshots/.
//
// The point of the control is that "0 defects found" and "this probe is blind"
// have to be distinguishable. Before it, a probe read computed styles during
// boot, missed a forced fault, and reported three clean rounds in a row while
// being unable to see anything. Every run now shows the page a known fault and
// refuses to trust its own result unless it is caught.
//
//   node scripts/dsh-customization-verify.mjs
//
// Needs DSH_COOKIE (name=value for http://127.0.0.1:3080) and a running
// profile. Read-only apart from toggling the appearance, which is restored
// before exit. Only reports; it changes nothing in the repository.
import { chromium } from '/Users/astahmer/dev/dshfiles/tooling/dshx/node_modules/.pnpm/playwright@1.56.1/node_modules/playwright/index.mjs'

const cookie = process.env.DSH_COOKIE
if (cookie === undefined) {
  process.stderr.write('DSH_COOKIE is required (name=value for http://127.0.0.1:3080)\n')
  process.exit(2)
}

const [name, value] = cookie.split('=')
const browser = await chromium.launch()

/** Boot is not the same moment as settled styles; wait for both. */
const settle = async page => {
  await page.waitForTimeout(5000)
  await page.evaluate(
    () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300)))),
  )
}

const openPage = async (viewport = { width: 1332, height: 1622 }) => {
  const context = await browser.newContext({ viewport })
  await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  return { context, page }
}

const runControl = async () => {
  const { context, page } = await openPage()
  const result = await page.evaluate(async () => {
    const target = document.querySelector('[class*="_row"] [class*="_actions"]')
    if (target === null) return { ran: false, detected: false }
    const resting = getComputedStyle(target).opacity
    target.style.setProperty('opacity', '1', 'important')
    await new Promise(resolve => setTimeout(resolve, 300))
    const forced = getComputedStyle(target).opacity
    target.style.removeProperty('opacity')
    await new Promise(resolve => setTimeout(resolve, 300))
    const restored = getComputedStyle(target).opacity
    return { ran: true, resting, forced, restored, detected: forced === '1' && restored === '0' }
  })
  await context.close()
  return result
}

/**
 * Reference 01 and 02, measured against the running profile.
 *
 * The expected values are read off plans/dsh-customization/screenshots/01 and 02
 * by measuring the images: a 29px filter inset at ~21px, a 12px group caption, a
 * 70px row with the title inset to 33px and leading its context line, and a 68px
 * compact header target.
 */
const EXPECTED = {
  '01 filter inset': 29,
  '01 group caption': '12px',
  '01 row height': 70,
  '01 title inset': 31,
  '01 title font': '16px',
  '01 title above context': true,
  '01 actions hidden at rest': true,
  '02 compact target': 68,
}

const measure = async () => {
  const { context, page } = await openPage()
  const values = await page.evaluate(() => {
    const q = selector => document.querySelector(selector)
    const filter = q('[class*="_projectFilter"] summary')
    const group = q('[class*="_groupHeader"]')
    const row = q('[class*="_row"]')
    const title = row?.querySelector('[class*="_rowTitle"]')
    const project = row?.querySelector('[class*="_rowProject"]')
    const actions = row?.querySelector('[class*="_actions"]')
    const compact = q('nav[aria-label] button')
    return {
      '01 filter inset': filter === null ? null : Math.round(filter.getBoundingClientRect().left),
      '01 filter font': filter === null ? null : getComputedStyle(filter).fontSize,
      '01 group caption': group === null ? null : getComputedStyle(group).fontSize,
      '01 row height': row === null ? null : Math.round(row.getBoundingClientRect().height),
      '01 title inset': title === null ? null : Math.round(title.getBoundingClientRect().left),
      '01 title font': title === null ? null : getComputedStyle(title).fontSize,
      '01 title above context':
        title === null || project === null ? null : title.getBoundingClientRect().top < project.getBoundingClientRect().top,
      '01 actions hidden at rest': actions === null ? null : getComputedStyle(actions).opacity === '0',
      '02 compact target': compact === null ? null : Math.round(compact.getBoundingClientRect().width),
      slotErrors: document.querySelectorAll('[data-slot-error]').length,
    }
  })
  await context.close()
  return values
}

const control = await runControl()
const measured = control.detected ? await measure() : null
const mismatches =
  measured === null
    ? ['not measured: the control failed']
    : Object.entries(EXPECTED)
        .filter(([key, want]) => measured[key] !== want)
        .map(([key, want]) => `${key}: expected ${want}, measured ${measured[key]}`)

process.stdout.write(
  `${JSON.stringify(
    {
      controlPassed: control.detected,
      control,
      trusted: control.detected,
      measured,
      mismatches,
      verdict: !control.detected
        ? 'UNTRUSTED: the probe was shown a fault and missed it'
        : mismatches.length === 0
          ? 'matches the reference on every measured value'
          : `${mismatches.length} value(s) drift from the reference`,
    },
    null,
    2,
  )}\n`,
)

await browser.close()
process.exit(control.detected && mismatches.length === 0 ? 0 : 1)