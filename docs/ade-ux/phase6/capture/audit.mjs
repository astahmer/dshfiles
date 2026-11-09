// Phase 6 phone audit/journey driver: one WebKit iPhone context walks a list of screens and, for each, writes a
// screenshot plus layout metrics (document overflow, elements past the viewport edge, clipped text, tap targets
// under 44 px, hover-only controls, safe-area setup).
//
//   ADE_WS=<workspace> node audit.mjs <state.json> <out-dir> <plan.json> [--desktop] [--only name,name]
//
// plan.json: [{ "name": "threads", "steps": ["tap-tab threads", "wait 800"] }, ...]. Step grammar (phone.mjs subset +):
//   click|tap <role|text|label|css> "<name>"   fill <role|label|css> "<name>" "<value>"   press <key>
//   expect <role|text|css> "<name>"            wait <ms>    goto-root    tap-tab <threads|inbox|new|more>
//   assert-css "<selector>" | assert-no-css "<selector>"   back (history.back)   tap-if <by> "<name>" (when visible)
//   keyboard-sim <px> | keyboard-sim-off (iOS-like: only the visual viewport shrinks)   keyboard-open|close <px> (resize)
// --strict exits 1 when any step fails (the phone journey); without it the run is an audit and always completes.
// A screen whose step fails is still captured; the failure is recorded and the run continues with the next screen.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WS = process.env.ADE_WS ?? process.cwd()
const { webkit } = await import(join(WS, 'tooling/dshx/packages/dshx/node_modules/playwright/index.mjs'))
const { StartupDialogs } = await import(join(WS, 'tooling/dshx/packages/dshx/dist/project/startup-dialogs.js'))

const args = process.argv.slice(2)
const [stateFile, outDir, planFile] = args
const desktop = args.includes('--desktop')
// --strict: a journey, not an audit; any failed step makes the run exit 1.
const strict = args.includes('--strict')
const onlyArg = args[args.indexOf('--only') + 1]
const only = args.includes('--only') ? new Set(onlyArg.split(',')) : null
const state = JSON.parse(readFileSync(stateFile, 'utf8'))
const plan = JSON.parse(readFileSync(planFile, 'utf8'))
mkdirSync(outDir, { recursive: true })
const [width, height] = desktop ? [1440, 900] : [390, 844]
const phone = !desktop
const storageFile = join(state.home, `audit-${phone ? 'phone' : 'desk'}.json`)
const browser = await webkit.launch({ headless: true })
const context = await browser.newContext({
  ...(existsSync(storageFile) && { storageState: storageFile }),
  viewport: { width, height },
  deviceScaleFactor: phone ? 2 : 1,
  isMobile: phone,
  hasTouch: phone,
  colorScheme: 'light',
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
  await page.locator('[data-slot="root"]').first().waitFor({ state: 'attached', timeout: 90_000 })
  await StartupDialogs.dismissPreviewNotice(page, 3_000).catch(() => false)
  await StartupDialogs.dismissProviderSetupDuringStartup(page, 3_000).catch(() => false)
  await page.waitForTimeout(1500)
}
const locate = (by, raw) => {
  const exact = !raw.endsWith('*')
  const name = exact ? raw : raw.slice(0, -1)
  if (by === 'css') return page.locator(raw).filter({ visible: true }).first()
  if (by === 'text') return page.getByText(name, { exact }).filter({ visible: true }).first()
  if (by === 'label') return page.getByLabel(name, { exact }).filter({ visible: true }).first()
  return page.getByRole(by, { name, exact }).filter({ visible: true }).first()
}
const tapOrClick = async (loc, force = false) =>
  phone ? loc.tap({ timeout: 20_000, force }) : loc.click({ timeout: 20_000, force, ...(force && { position: { x: 3, y: 3 } }) })

/** Measured in the page: everything a phone reviewer would flag, as counts plus a few named samples. */
const measure = () =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const visible = el => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      const s = getComputedStyle(el)
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
    }
    const label = el => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
    const scrollsX = el => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX
        if ((o === 'auto' || o === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true
        if (o === 'hidden' || o === 'clip') {
          const r = n.getBoundingClientRect()
          if (r.right <= vw + 1 && r.left >= -1) return true
        }
      }
      return false
    }
    const all = [...document.body.querySelectorAll('*')]
    const past = all.filter(el => {
      if (!visible(el) || el.children.length > 0 && el.textContent.trim() === '') return false
      const r = el.getBoundingClientRect()
      return (r.right > vw + 1 || r.left < -1) && !scrollsX(el)
    })
    const clipped = all.filter(el => {
      if (!visible(el) || el.children.length > 0 || el.getBoundingClientRect().width <= 2) return false
      const s = getComputedStyle(el)
      return el.scrollWidth > el.clientWidth + 2 && (s.overflowX === 'hidden' || s.overflowX === 'clip') && s.textOverflow !== 'ellipsis' && el.textContent.trim().length > 0
    })
    const interactive = all.filter(el => el.matches('button,a[href],[role=button],[role=tab],[role=menuitem],input:not([type=hidden]),select,textarea,[role=checkbox],[role=switch]'))
    const shown = interactive.filter(visible)
    // The hit area counts, not the drawn box: the kit widens touch targets with an absolutely positioned ::after.
    const hit = el => {
      const r = el.getBoundingClientRect()
      const after = getComputedStyle(el, el.matches('[data-slot=tabs-trigger]') ? '::before' : '::after')
      if (after.content === 'none' || after.position !== 'absolute') return { w: r.width, h: r.height }
      const px = v => (v.endsWith('px') ? Number.parseFloat(v) : 0)
      return { w: r.width - px(after.left) - px(after.right), h: r.height - px(after.top) - px(after.bottom) }
    }
    const small = shown.filter(el => {
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight) return false
      const { w, h } = hit(el)
      return w < 43.5 || h < 43.5
    })
    // Hover-only: a control laid out but invisible (opacity 0) until :hover, typical of row action strips.
    const hoverOnly = interactive.filter(el => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      const s = getComputedStyle(el)
      let n = el
      let hidden = false
      while (n && n !== document.body) {
        if (Number(getComputedStyle(n).opacity) < 0.05) { hidden = true; break }
        n = n.parentElement
      }
      return hidden && s.display !== 'none'
    })
    const viewportMeta = document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? null
    const tabBar = document.querySelector('[data-phone-tab-bar]')?.getBoundingClientRect()
    return {
      overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, bodyScrollWidth: document.body.scrollWidth },
      pastEdge: { count: past.length, samples: [...new Set(past.map(label))].slice(0, 8) },
      clipped: { count: clipped.length, samples: [...new Set(clipped.map(label))].slice(0, 8) },
      smallTargets: { count: small.length, total: shown.length, samples: [...new Set(small.map(el => `${label(el)} ${Math.round(hit(el).w)}x${Math.round(hit(el).h)}`))].slice(0, 12) },
      hoverOnly: { count: hoverOnly.length, samples: [...new Set(hoverOnly.map(label))].slice(0, 8) },
      viewportMeta,
      tabBarBottom: tabBar ? Math.round(tabBar.bottom) : null,
      scrollY: Math.round(window.scrollY),
      innerHeight: window.innerHeight,
    }
  })

const runStep = async step => {
  const m = step.match(/^([\w-]+)(?: (\w+) "((?:[^"\\]|\\.)*)"(?: "((?:[^"\\]|\\.)*)")?)?(?: (.+))?$/)
  if (!m) throw new Error('bad step')
  const [, action, by, name, value, rest] = m
  if (action === 'goto-root') return root()
  if (action === 'wait') return page.waitForTimeout(Number(rest ?? by))
  if (action === 'press') return page.keyboard.press(rest)
  if (action === 'back') return page.goBack({ waitUntil: 'commit' }).then(() => page.waitForTimeout(600))
  if (action === 'tap-tab') return tapOrClick(page.locator(`[data-phone-tab="${rest}"]`).first())
  // A text target is clicked at its corner even when a hover strip overlaps it (as the Phase 0 driver did).
  if (action === 'click' || action === 'tap') return tapOrClick(locate(by, name), by === 'text' && action === 'click')
  if (action === 'tap-if') {
    // Optional: tap when the control is on screen (a chooser that a remembered layout may skip).
    const target = locate(by, name)
    if (await target.isVisible().catch(() => false)) await tapOrClick(target)
    return
  }
  // {{nonce}} makes a fake-provider [[once …]] directive unique per run (the provider runs each text once).
  if (action === 'fill') return locate(by, name).fill((value ?? '').replace(/\\(["\\])/g, '$1').replaceAll('{{nonce}}', NONCE), { timeout: 20_000 })
  if (action === 'expect') return locate(by, name).waitFor({ state: 'visible', timeout: 20_000 })
  if (action === 'assert-css') return page.locator(rest.replace(/^"|"$/g, '')).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
  if (action === 'assert-no-css') {
    const sel = rest.replace(/^"|"$/g, '')
    await page.waitForTimeout(400)
    if ((await page.locator(sel).filter({ visible: true }).count()) > 0) throw new Error(`still visible: ${sel}`)
    return
  }
  if (action === 'keyboard-sim' || action === 'keyboard-sim-off') {
    // iOS keeps the layout viewport and shrinks only the visual viewport when the keyboard opens: stub that.
    return page.evaluate(px => {
      const vv = window.visualViewport
      if (px === null) delete vv.height
      else {
        const h = window.innerHeight - px
        Object.defineProperty(vv, 'height', { configurable: true, get: () => h })
      }
      vv.dispatchEvent(new Event('resize'))
    }, action === 'keyboard-sim' ? Number(rest) : null).then(() => page.waitForTimeout(400))
  }
  if (action === 'keyboard-open') {
    // WebKit headless has no software keyboard: shrink the layout viewport like iOS does when it opens.
    await page.setViewportSize({ width, height: height - Number(rest) })
    return page.waitForTimeout(500)
  }
  if (action === 'keyboard-close') {
    await page.setViewportSize({ width, height })
    return page.waitForTimeout(500)
  }
  throw new Error(`unknown action ${action}`)
}

const NONCE = String(Date.now() % 100000)
const report = []
try {
  await root()
  for (const screen of plan) {
    if (only && !only.has(screen.name)) continue
    const results = []
    for (const step of screen.steps) {
      try {
        await runStep(step)
        results.push({ step, ok: true })
      } catch (error) {
        results.push({ step, ok: false, error: String(error.message ?? error).split('\n')[0].replace(/https?:\/\/\S+/g, '[url]') })
        break
      }
    }
    await page.waitForTimeout(screen.settle ?? 900)
    const metrics = await measure().catch(error => ({ error: String(error) }))
    const out = join(outDir, `${screen.name}-${phone ? 'phone' : 'desktop'}.png`)
    await page.screenshot({ path: out })
    const entry = { name: screen.name, out, ok: results.every(r => r.ok), results: results.filter(r => !r.ok), metrics }
    report.push(entry)
    console.log(JSON.stringify(entry))
  }
} finally {
  writeFileSync(join(outDir, `report-${phone ? 'phone' : 'desktop'}.json`), JSON.stringify({ errors, report }, null, 2))
  await context.storageState({ path: storageFile }).catch(() => undefined)
  await browser.close()
}
if (strict && report.some(entry => !entry.ok)) {
  console.error(`journey failed: ${report.filter(entry => !entry.ok).map(entry => entry.name).join(', ')}`)
  process.exit(1)
}
