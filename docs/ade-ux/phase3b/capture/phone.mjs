// WebKit phone driver for the Phase 0 baseline. Usage:
//   node phone.mjs <state.json> <out.png> <light|dark> <width>x<height> [step ...]
// Steps use the catalog reach grammar subset: click|hover|rightclick <role|text> "<name>", fill <role> "<name>" "<value>",
// press <key>, expect <role|text> "<name>", wait <ms>, goto-root. A failing step is reported and the shot is still taken.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const WS = process.env.ADE_WS ?? process.cwd()
const { webkit } = await import(join(WS, 'tooling/dshx/packages/dshx/node_modules/playwright/index.mjs'))
const { StartupDialogs } = await import(join(WS, 'tooling/dshx/packages/dshx/dist/project/startup-dialogs.js'))

const [stateFile, out, scheme, size, ...steps] = process.argv.slice(2)
const state = JSON.parse(readFileSync(stateFile, 'utf8'))
const [width, height] = size.split('x').map(Number)
const phone = width < 600
const storageFile = join(state.home, `webkit-${phone ? 'phone' : 'desk'}-${scheme}.json`)
const browser = await webkit.launch({ headless: true })
const context = await browser.newContext({
  ...(existsSync(storageFile) && { storageState: storageFile }),
  viewport: { width, height },
  deviceScaleFactor: phone ? 2 : 1,
  isMobile: phone,
  hasTouch: phone,
  colorScheme: scheme,
  ...(phone && {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  }),
})
const page = context.pages()[0] ?? (await context.newPage())
const errors = []
page.on('pageerror', e => errors.push(`pageerror ${e.message.slice(0, 160)}`))
await StartupDialogs.registerPreviewNoticeDismissal(page)
const root = async () => {
  await page.goto(state.launchUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-slot="root"]').first().waitFor({ state: 'attached', timeout: 60_000 })
  await StartupDialogs.dismissPreviewNotice(page, 3_000).catch(() => false)
  await StartupDialogs.dismissProviderSetupDuringStartup(page, 3_000).catch(() => false)
}
const locate = (by, raw) => {
  const exact = !raw.endsWith('*')
  const name = exact ? raw : raw.slice(0, -1)
  if (by === 'text') return page.getByText(name, { exact }).filter({ visible: true }).first()
  if (by === 'label') return page.getByLabel(name, { exact }).filter({ visible: true }).first()
  return page.getByRole(by, { name, exact }).filter({ visible: true }).first()
}
const results = []
try {
  await root()
  for (const step of steps) {
    const m = step.match(/^(\w+)(?: (\w+) "((?:[^"\\]|\\.)*)"(?: "((?:[^"\\]|\\.)*)")?)?(?: (.+))?$/)
    try {
      if (!m) throw new Error('bad step')
      const [, action, by, name, value, rest] = m
      if (action === 'names')
        console.error(
          JSON.stringify(
            await page.evaluate(() =>
              [...document.querySelectorAll('button,[role=tab],[role=button],a')]
                .filter(e => e.getClientRects().length > 0)
                .map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60))
                .filter(Boolean),
            ),
          ),
        )
      else if (action === 'goto-root') await root()
      else if (action === 'nav') {
        // A rail destination: visible directly, or behind the overflow menu on narrow screens.
        const direct = page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
        if (await direct.isVisible().catch(() => false)) await direct.click({ timeout: 15_000 })
        else {
          for (const more of ['More sidebar destinations', 'More']) {
            const b = page.getByRole('button', { name: more, exact: true }).filter({ visible: true }).first()
            if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 5_000 }); break }
          }
          await page.waitForTimeout(400)
          const any = page.getByRole('menuitem', { name, exact: false }).or(page.getByRole('button', { name, exact: true })).filter({ visible: true }).first()
          await any.click({ timeout: 15_000 })
        }
      }
      else if (action === 'wait') await page.waitForTimeout(Number(rest ?? by))
      else if (action === 'press') await page.keyboard.press(rest)
      else if (action === 'click') await locate(by, name).click({ timeout: 15_000, ...(by === 'text' && { force: true, position: { x: 3, y: 3 } }) })
      else if (action === 'hover') await locate(by, name).hover({ timeout: 15_000 })
      else if (action === 'rightclick') await locate(by, name).click({ button: 'right', timeout: 15_000 })
      else if (action === 'fill') await locate(by, name).fill((value ?? '').replace(/\\(["\\])/g, '$1'), { timeout: 15_000 })
      else if (action === 'expect') await locate(by, name).waitFor({ state: 'visible', timeout: 15_000 })
      else throw new Error(`unknown action ${action}`)
      results.push({ step, ok: true })
    } catch (error) {
      results.push({ step, ok: false, error: String(error.message ?? error).split('\n')[0].replace(/https?:\/\/\S+/g, '[url]') })
      break
    }
  }
  await page.waitForTimeout(1200)
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))
  await page.screenshot({ path: out })
  console.log(JSON.stringify({ out, results, overflow, errors: errors.slice(0, 5) }))
} finally {
  await context.storageState({ path: storageFile }).catch(() => undefined)
  await browser.close()
}
