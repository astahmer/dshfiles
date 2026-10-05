// Accessibility and resilience checks for the dsh-customization panels.
//
// Each of these axes found a real defect that the reference-value gate in
// dsh-customization-verify.mjs could not see, because none of them is a
// dimension the reference screenshots capture:
//
//   dark mode   -- the references are all dark, and light-only checks hid a
//                  footer overlap that only appeared there
//   keyboard   -- every shell control inherited its focus ring from the Host by
//                  accident; two of them measured 0px/none
//   zoom        -- the rail clips its widest header link below the frame's
//                  1024px auto-collapse
//   reduced motion -- four transitions ignored prefers-reduced-motion
//   contrast   -- the project line used a tier that cannot clear AA in both themes
//
// Like the reference gate, this one shows the page a known fault and refuses to
// trust itself if that fault is missed.
//
//   DSH_ORIGIN=http://127.0.0.1:3210 DSH_COOKIE=… node scripts/dsh-customization-a11y.mjs
//
// Needs DSH_COOKIE (name=value for the origin) and a running profile. Changes nothing
// in the repository. The appearance is toggled to test dark and is restored before exit.
//
// DSH_ORIGIN exists because this gate used to name port 3080 literally, so it could
// only be run against the instance the user is already using -- the one this repo
// forbids restarting, and the one whose appearance setting a run would toggle.
import { chromium } from '/Users/astahmer/dev/dshfiles/tooling/dshx/node_modules/.pnpm/playwright@1.56.1/node_modules/playwright/index.mjs'

const cookie = process.env.DSH_COOKIE
if (cookie === undefined) {
  process.stderr.write('DSH_COOKIE is required (name=value for the origin)\n')
  process.exit(2)
}

const origin = (process.env.DSH_ORIGIN ?? 'http://127.0.0.1:3080').replace(/\/$/, '')
const openUrl = path => `${origin}${path}`
const [name, value] = cookie.split('=')
const browser = await chromium.launch()

/** Boot and settled styles are different moments; wait for both. */
const settle = async (page, ms = 5000) => {
  await page.waitForTimeout(ms)
  await page.evaluate(
    () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300)))),
  )
}

const openPage = async (options = {}) => {
  const context = await browser.newContext({ viewport: { width: 1332, height: 1622 }, ...options })
  await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error).slice(0, 140)))
  await page.goto(openUrl('/'), { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  return { context, page, errors }
}

/**
 * The control: this probe must catch a fault it is shown, or trust nothing.
 * When it has no target to fault there is nothing to catch, which is a setup
 * problem rather than a broken probe -- see the verdict split below.
 */
const runControl = async () => {
  const { context, page } = await openPage()
  const result = await page.evaluate(async () => {
    const target = document.querySelector('[class*="_row"] [class*="_actions"]')
    if (target === null) return { ran: false, detected: false, reason: 'no thread row with an actions area exists on this profile' }
    target.style.setProperty('opacity', '1', 'important')
    await new Promise(resolve => setTimeout(resolve, 300))
    const forced = getComputedStyle(target).opacity
    target.style.removeProperty('opacity')
    await new Promise(resolve => setTimeout(resolve, 300))
    return { ran: true, forced, detected: forced === '1' }
  })
  await context.close()
  return result
}

const setAppearance = async (page, label) => {
  await page.locator('button[aria-label="Settings"]').first().click({ timeout: 10000 })
  await page.waitForTimeout(2500)
  await page.evaluate(target => {
    ;[...document.querySelectorAll('[role="dialog"] button')].find(b => b.innerText.trim() === target)?.click()
  }, label)
  await page.waitForTimeout(1200)
  await page.keyboard.press('Escape')
  await settle(page, 2500)
}

/** WCAG relative luminance, from the spec. */
const relativeLuminance = ([r, g, b]) => {
  const channel = value => {
    const srgb = value / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (foreground, background) => {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const parse = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)

/**
 * Dark mode, contrast, and the reduced-motion preference, all on one page so the
 * appearance is only toggled once each way.
 */
const checkThemesAndMotion = async () => {
  const { context, page, errors } = await openPage()
  const before = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))

  const sample = () =>
    page.evaluate(() => {
      const read = selector => {
        const node = document.querySelector(selector)
        if (node === null) return null
        const style = getComputedStyle(node)
        return {
          color: style.color,
          background: style.backgroundColor,
          transition: style.transitionDuration,
          titleColor: (() => {
            const title = document.querySelector('[class*="_rowTitle"]')
            return title === null ? null : getComputedStyle(title).color
          })(),
        }
      }
      return {
        shell: read('[class*="_shell_"]'),
        project: read('[class*="_rowProject"]'),
        toggle: read('[class*="_visibilityToggle_"]'),
      }
    })

  const light = await sample()
  await setAppearance(page, 'Dark')
  const dark = await sample()
  await setAppearance(page, 'Light')
  const restored = await page.evaluate(() => !document.body.hasAttribute('data-ds-dark-theme'))
  const slotErrors = await page.evaluate(() => document.querySelectorAll('[data-slot-error]').length)
  await context.close()
  return { before, light, dark, restored, slotErrors, errors }
}

const checkKeyboard = async () => {
  const { context, page } = await openPage()
  const reached = []
  for (let step = 0; step < 16; step += 1) {
    await page.keyboard.press('Tab')
    reached.push(
      await page.evaluate(() => {
        const el = document.activeElement
        if (el === null || el === document.body) return { label: '', insideSidebar: false, ring: false }
        const style = getComputedStyle(el)
        return {
          label: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 24),
          insideSidebar: Boolean(el.closest('[class*="_shell_"]')),
          ring: style.outlineStyle !== 'none' && style.outlineWidth !== '0px',
        }
      }),
    )
  }

  // The customize panel, reached and tabbed through: :focus-visible only answers
  // keyboard focus, so a programmatic focus() would report a false pass here.
  await page.getByRole('button', { name: 'Customize sidebar' }).first().click()
  await page.waitForTimeout(1800)
  const panelRings = []
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press('Tab')
    panelRings.push(
      await page.evaluate(() => {
        const el = document.activeElement
        if (el === null || el === document.body) return false
        const style = getComputedStyle(el)
        return style.outlineStyle !== 'none' && style.outlineWidth !== '0px'
      }),
    )
  }
  // The switch has to be reachable by Tab and operable with Enter.
  let switchReached = false
  let switchRing = false
  let switchOperated = false
  for (let step = 0; step < 26; step += 1) {
    await page.keyboard.press('Tab')
    const found = await page.evaluate(() => {
      const el = document.activeElement
      if (el === null || el.getAttribute('role') !== 'switch') return null
      const style = getComputedStyle(el)
      return { ring: style.outlineStyle !== 'none' && style.outlineWidth !== '0px', checked: el.getAttribute('aria-checked') }
    })
    if (found === null) continue
    switchReached = true
    switchRing = found.ring
    // Read the focused element itself. Querying the first toggle on the page
    // compares a different control and reports a switch as unresponsive.
    const readFocused = () =>
      page.evaluate(() => document.activeElement?.getAttribute('aria-checked') ?? null)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(900)
    switchOperated = (await readFocused()) !== found.checked
    await page.keyboard.press('Enter')
    await page.waitForTimeout(900)
    break
  }
  // A visible ring is not enough: the Host's global styles provide one even when
  // the shell declares none, which is how the shell went years without a ring of
  // its own while every control still looked focused. So also require that the
  // shell's own stylesheet names these controls.
  const declared = await page.evaluate(() => {
    // Match the shell's own declaration rather than any rule that happens to
    // mention one of its classes: it is the only rule that covers the header
    // row, More, the switch and the panel buttons together.
    const required = ['visibilityToggle', 'moreButton', 'brandButton']
    const isShellRule = selectorText =>
      /focus-visible/.test(selectorText) && required.every(name => selectorText.includes(name))
    const matched = []
    let focusRules = 0
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of rules) {
        if (rule.selectorText === undefined) continue
        if (!/focus-visible/.test(rule.selectorText)) continue
        if (!/outline/.test(rule.cssText)) continue
        if (isShellRule(rule.selectorText)) {
          focusRules += 1
          if (matched.length < 3) matched.push(rule.selectorText.slice(0, 120))
        }
      }
    }
    return { focusRules, matched }
  })

  await context.close()
  return {
    shellFocusRules: declared.focusRules,
    shellFocusSelectors: declared.matched,
    sidebarControls: reached.filter(r => r.insideSidebar).length,
    sidebarControlsWithoutRing: reached.filter(r => r.insideSidebar && !r.ring).length,
    panelRingsMissing: panelRings.filter(ring => !ring).length,
    switchReached,
    switchRing,
    switchOperated,
  }
}

const checkRailAtZoom = async () => {
  const results = []
  for (const [zoom, label] of [
    [1, '100%'],
    [1.5, '150%'],
    [2, '200%'],
  ]) {
    const context = await browser.newContext({
      viewport: { width: Math.round(1332 / zoom), height: Math.round(1000 / zoom) },
      deviceScaleFactor: zoom,
    })
    await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
    const page = await context.newPage()
    await page.goto(openUrl('/'), { waitUntil: 'domcontentloaded', timeout: 60000 })
    await settle(page)
    results.push({
      label,
      ...(await page.evaluate(() => {
        const shell = document.querySelector('[class*="_shell_"]')
        const shellBox = shell?.getBoundingClientRect()
        const region = document.querySelector('[class*="_regionArea"]')
        const rows = [...document.querySelectorAll('[class*="_row"]')].filter(r => r.closest('[class*="_regionArea"]'))
        return {
          sidebar: shellBox === undefined ? null : Math.round(shellBox.width),
          rowsInRegion: rows.length,
          rowsOverflowing: rows.filter(r => r.getBoundingClientRect().width > (shellBox?.width ?? 0) + 2).length,
          headerOverflow: document.body.scrollWidth > document.documentElement.clientWidth + 1,
          slotErrors: document.querySelectorAll('[data-slot-error]').length,
        }
      })),
    })
    await context.close()
  }
  return results
}

const checkReducedMotion = async () => {
  const read = async reducedMotion => {
    const context = await browser.newContext({ viewport: { width: 1332, height: 1622 }, reducedMotion })
    await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
    const page = await context.newPage()
    await page.goto(openUrl('/'), { waitUntil: 'domcontentloaded', timeout: 60000 })
    await settle(page)
    const durations = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="_visibilityToggle"], [class*="_actions"]')]
        .slice(0, 2)
        .map(node => getComputedStyle(node).transitionDuration),
    )
    await context.close()
    return durations
  }
  return { motion: await read('no-preference'), reduce: await read('reduce') }
}

const control = await runControl()
const report = { controlPassed: control.detected, control }

if (control.detected) {
  const themes = await checkThemesAndMotion()
  report.themes = {
    appearanceRestored: themes.restored,
    slotErrors: themes.slotErrors,
    errors: themes.errors.length,
  }
  report.contrast = {
    lightTitle: Number(contrast(parse(themes.light.shell.color), parse(themes.light.shell.background)).toFixed(2)),
    lightProject: Number(contrast(parse(themes.light.project.color), parse(themes.light.shell.background)).toFixed(2)),
    darkTitle: Number(contrast(parse(themes.dark.shell.color), parse(themes.dark.shell.background)).toFixed(2)),
    darkProject: Number(contrast(parse(themes.dark.project.color), parse(themes.dark.shell.background)).toFixed(2)),
  }
  report.keyboard = await checkKeyboard()
  report.zoom = await checkRailAtZoom()
  report.reducedMotion = await checkReducedMotion()
}

const problems = []
if (!control.ran) problems.push(`the control had nothing to test: ${control.reason}`)
else if (!control.detected) problems.push('the probe was shown a fault and missed it')
if (report.themes !== undefined) {
  if (!report.themes.appearanceRestored) problems.push('the appearance was not restored')
  if (report.themes.slotErrors > 0) problems.push(`${report.themes.slotErrors} slot error(s) in dark mode`)
  for (const [theme, value] of Object.entries(report.contrast)) {
    if (value < 4.5) problems.push(`${theme} contrast ${value}:1 is below WCAG AA`)
  }
}
if (report.keyboard !== undefined) {
  if (report.keyboard.sidebarControlsWithoutRing > 0) {
    problems.push(`${report.keyboard.sidebarControlsWithoutRing} sidebar control(s) have no focus ring`)
  }
  if (report.keyboard.panelRingsMissing > 0) problems.push(`${report.keyboard.panelRingsMissing} panel control(s) have no focus ring`)
  if (report.keyboard.shellFocusRules === 0) {
    problems.push('the shell declares no focus ring of its own; its controls inherit the Host\'s')
  }
  if (!report.keyboard.switchReached) problems.push('the visibility switch is not reachable by Tab')
  else if (!report.keyboard.switchRing) problems.push('the visibility switch has no focus ring')
  if (!report.keyboard.switchOperated) problems.push('the visibility switch does not respond to Enter')
}
if (report.zoom !== undefined) {
  for (const step of report.zoom) {
    if (step.rowsOverflowing > 0) problems.push(`at ${step.label} zoom, ${step.rowsOverflowing} row(s) overflow the sidebar`)
    if (step.headerOverflow) problems.push(`at ${step.label} zoom the page scrolls horizontally`)
  }
}
if (report.reducedMotion !== undefined) {
  const animated = report.reducedMotion.reduce.filter(d => d !== '0s')
  if (animated.length > 0) problems.push(`reduced motion still animates: ${animated.join(', ')}`)
}

report.problems = problems
report.verdict = problems.length === 0 ? 'no accessibility or resilience regression' : `${problems.length} problem(s)`

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
await browser.close()
process.exit(problems.length === 0 ? 0 : 1)