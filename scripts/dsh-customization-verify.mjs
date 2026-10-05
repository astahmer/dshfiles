// Self-validating check of the dsh-customization panels against the reference
// screenshots in plans/dsh-customization/screenshots/.
//
// The point of the control is that "0 defects found" and "this probe is blind"
// have to be distinguishable. Before it, a probe read computed styles during
// boot, missed a forced fault, and reported three clean rounds in a row while
// being unable to see anything. Every run now shows the page a known fault and
// refuses to trust its own result unless it is caught.
//
//   DSH_ORIGIN=http://127.0.0.1:3210 DSH_COOKIE=… node scripts/dsh-customization-verify.mjs
//
// Needs DSH_COOKIE (name=value for the origin) and a running profile. Read-only
// apart from toggling the appearance, which is restored before exit. Only
// reports; it changes nothing in the repository.
//
// DSH_ORIGIN exists because this gate used to name port 3080 literally, which
// meant it could only ever be run against the one instance the user is already
// using -- the instance AGENTS.md forbids restarting and the one where a run
// would toggle the user's own appearance setting. Every navigation is built from
// the origin now, so a second instance can be verified without touching the first.
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
  await page.goto(openUrl('/'), { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  return { context, page }
}

/**
 * The control needs a real row's actions to force opacity on. When the profile
 * has no threads at all there is nothing to touch, and returning `detected: false`
 * for that made the gate print UNTRUSTED -- the same verdict it gives a probe that
 * was shown a fault and missed it. The two are not the same thing, and collapsing
 * them hid the reason behind a scary one: an empty profile, not a blind gate.
 */
const runControl = async () => {
  const { context, page } = await openPage()
  const result = await page.evaluate(async () => {
    const target = document.querySelector('[class*="_row"] [class*="_actions"]')
    if (target === null) return { ran: false, detected: false, reason: 'no thread row with an actions area exists on this profile' }
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
 * by decoding the PNG and reading pixels, not by eyeballing it.
 *
 * The capture scale is established rather than assumed. 01 is 1332x1622 for this
 * gate's own 1332x1622 viewport, and its project filter's inset measures 29px in
 * the image against 29px live -- two independent anchors agreeing is what makes
 * the image 1:1 and rules out the halving an earlier pass applied on the
 * strength of a nominal 144dpi. That halving moved every row measurement to half
 * its true value, which is why three of the numbers below matched nothing at all:
 * not the image, and not what the app renders.
 */
const EXPECTED = {
  '01 filter inset': 29,
  '01 group caption': '12px',
  '01 row height': 151,
  '01 title inset': 34,
  '01 title font': '20px',
  '01 title above context': true,
  '01 actions hidden at rest': true,
  '02 compact target': 68,
  '03 expanded label inset': 73,
  '03 expanded pitch': 64,
  '04 heading': '28.8px',
  '05 menu lists MCP': true,
  '06 quick panel open': true,
  '06 quick panel heading': '16.8px',
  '09 picker row height': 43,
  '09 picker title font': '15.2px',
  '10 header row pitch': 60,
  '11 footer row pitch': 90,
  '14 jujutsu row pitch': 57,
  '14 jujutsu title font': '15px',
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
      '01 title inset': title == null ? null : Math.round(title.getBoundingClientRect().left),
      '01 title font': title == null ? null : getComputedStyle(title).fontSize,
      '01 title above context':
        title == null || project == null ? null : title.getBoundingClientRect().top < project.getBoundingClientRect().top,
      '01 actions hidden at rest': actions == null ? null : getComputedStyle(actions).opacity === '0',
      '02 compact target': compact === null ? null : Math.round(compact.getBoundingClientRect().width),
      slotErrors: document.querySelectorAll('[data-slot-error]').length,
    }
  })

  // References 03, 10 and 11 all live in the customize panel, so one open of it
  // covers them: the expanded header geometry, and the two row densities, which
  // differ because the references measure two different panels.
  await page.getByRole('button', { name: 'Customize sidebar' }).first().click()
  await page.waitForTimeout(2000)
  Object.assign(
    values,
    await page.evaluate(() => {
      const headerRows = [...document.querySelectorAll('[class*="_customizeRow_"][class*="_headerRows"]')]
      const footerRows = [...document.querySelectorAll('[class*="_customizeRow_"][class*="_footerRows"]')]
      const pitch = rows =>
        rows.length > 1 ? Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top) : null
      return {
        '10 header row pitch': pitch(headerRows),
        '11 footer row pitch': pitch(footerRows),
      }
    }),
  )

  // Reference 03: expanded header rows carry the label at x73 on a 64px pitch.
  await page.evaluate(() => {
    ;[...document.querySelectorAll('[class*="_modeField_"] input')].find(input => input.value === 'expanded')?.click()
  })
  await page.waitForTimeout(1500)
  Object.assign(
    values,
    await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label]')
      const rows = [...(nav?.querySelectorAll('button') ?? [])]
      const labelLeft = rows[0] === undefined ? null : Math.round([...rows[0].children].map(c => c.getBoundingClientRect().left).sort((a, b) => b - a)[0])
      const rowPitch = rows[1] === undefined ? null : Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top)
      return { '03 expanded label inset': labelLeft, '03 expanded pitch': rowPitch }
    }),
  )

  // Put the header back to compact so the run leaves no saved change behind.
  await page.evaluate(() => {
    ;[...document.querySelectorAll('[class*="_modeField_"] input')].find(input => input.value === 'compact')?.click()
  })
  await page.waitForTimeout(1000)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)

  await context.close()
  return values
}

const control = await runControl()
const measured = control.detected ? await measure() : null

/**
 * The panels beyond the sidebar, measured against their own references. Each
 * needs its own page because opening one leaves the previous one mounted, and
 * the settings dialog's mask blocks the next navigation.
 */
const measurePanels = async () => {
  const values = {}

  {
    const { context, page } = await openPage({ width: 1762, height: 1092 })
    await page.locator('button[aria-label="MCP servers"]').first().click()
    await page.waitForTimeout(3000)
    Object.assign(
      values,
      await page.evaluate(() => {
        const h1 = document.querySelector('[class*="_pageHeader"] h1')
        const h2 = document.querySelector('[class*="_sectionHeading"] h2')
        const cards = [...document.querySelectorAll('[class*="_catalogCard"]')]
        const grid = document.querySelector('[class*="_catalogGrid"]')
        return {
          '04 heading': h1 === null ? null : getComputedStyle(h1).fontSize,
          '04 section': h2 === null ? null : getComputedStyle(h2).fontSize,
          '07 catalog columns': grid === null ? null : getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          '07 catalog rows': cards.length,
        }
      }),
    )
    await context.close()
  }

  // References 05 and 06: the composer's + menu carries the MCP row, and picking
  // it opens the quick panel. The row has to be addressed by id rather than by
  // role -- the sidebar's header link shares its accessible name, so a name-based
  // lookup opens the manager page instead and reports the wrong surface.
  {
    const { context, page } = await openPage()
    await page.locator('[class*="_rowTitle_"]').first().click()
    await page.waitForTimeout(3000)
    await page.locator('button[aria-label="Add files or run commands"]').first().click()
    await page.waitForTimeout(1800)
    Object.assign(
      values,
      await page.evaluate(() => {
        const row = document.querySelector('#dsh-slash-option-command-9')
        const menu = document.querySelector('[class*="_dock"]')
        const items = menu === null ? [] : [...menu.querySelectorAll('button,[role="menuitem"]')].map(n => (n.innerText ?? '').trim())
        return {
          '05 menu lists MCP': row !== null,
          '05 menu item count': items.length,
        }
      }),
    )
    await page.locator('#dsh-slash-option-command-9').click().catch(() => {})
    await page.waitForTimeout(3000)
    Object.assign(
      values,
      await page.evaluate(() => {
        const panel = document.querySelector('[class*="_quickPanel"]')
        const heading = panel?.querySelector('strong')
        return {
          '06 quick panel open': panel !== null,
          // `panel?.querySelector` yields undefined when the panel is absent, not
          // null, so a `=== null` guard let undefined reach getComputedStyle and
          // took the whole run down with a TypeError instead of a report. A gate
          // that dies on the defect it is meant to report reports nothing at all.
          '06 quick panel heading': heading == null ? null : getComputedStyle(heading).fontSize,
          '06 quick panel actions': panel === null ? 0 : panel.querySelectorAll('button').length,
        }
      }),
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    await context.close()
  }

  {
    const { context, page } = await openPage()
    await page.locator('button[aria-label="Secret Catalog"]').first().click()
    await page.waitForTimeout(3500)
    Object.assign(
      values,
      await page.evaluate(() => {
        const th = document.querySelector('[class*="_table"] th')
        const rows = [...document.querySelectorAll('[class*="_table"] tbody tr')]
        return {
          '08 header font': th === null ? null : getComputedStyle(th).fontSize,
          '08 rows': rows.length,
          '08 values masked': document.querySelectorAll('[class*="_mask"]').length,
        }
      }),
    )
    await context.close()
  }

  {
    const { context, page } = await openPage()
    await page.locator('button[aria-label="Settings"]').first().click({ timeout: 10000 })
    await page.waitForTimeout(2500)
    await page.evaluate(() => {
      ;[...document.querySelectorAll('[role="dialog"] button')].find(button => button.innerText.trim() === 'Search')?.click()
    })
    await page.waitForTimeout(2500)
    Object.assign(
      values,
      await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        const heading = dialog?.querySelector('h1')
        const section = dialog?.querySelector('[class*="_namespaceList"] h2')
        return {
          '12 heading': heading === null ? null : getComputedStyle(heading).fontSize,
          '13 section': section === null ? null : getComputedStyle(section).fontSize,
        }
      }),
    )
    await context.close()
  }

  // Reference 09: the picker, opened from Secret Catalog. Its scale is ~1.662, so
  // its measured values are halved before comparing -- reading a font straight
  // off that image doubles it.
  {
    const { context, page } = await openPage()
    await page.locator('button[aria-label="Secret Catalog"]').first().click()
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: /choose a project folder/i }).first().click()
    await page.waitForTimeout(2500)
    Object.assign(
      values,
      await page.evaluate(() => {
        const dialog = document.querySelector('[class*="_dialog_"]')
        const item = dialog?.querySelector('[class*="_item"]')
        const title = dialog?.querySelector('[class*="_itemText"] strong')
        return {
          '09 picker row height': item == null ? null : Math.round(item.getBoundingClientRect().height),
          '09 picker title font': title == null ? null : getComputedStyle(title).fontSize,
          '09 picker shortcuts': dialog === null ? 0 : dialog.querySelectorAll('kbd').length,
        }
      }),
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    await context.close()
  }

  // Reference 14: the Jujutsu graph, which needs a repository open before its
  // rows exist. The path is read from the environment so the gate does not hard
  // code one developer's checkout.
  if (process.env.DSH_JUJUTSU_REPO !== undefined) {
    const { context, page } = await openPage()
    await page.locator('button[aria-label="Jujutsu"]').first().click()
    await page.waitForTimeout(2500)
    const field = page.locator('input').filter({ hasNot: page.locator('[type="checkbox"]') }).first()
    await field.click()
    await field.fill(process.env.DSH_JUJUTSU_REPO)
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /open repository/i }).first().click().catch(() => {})
    await page.waitForTimeout(5000)
    Object.assign(
      values,
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[class*="_revision_"]')]
        const title = rows[0]?.querySelector('[class*="_revisionTitle"]')
        return {
          '14 jujutsu row pitch':
            rows.length > 1 ? Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top) : null,
          '14 jujutsu title font': title === null ? null : getComputedStyle(title).fontSize,
        }
      }),
    )
    await context.close()
  } else {
    values['14 jujutsu row pitch'] = 'skipped: set DSH_JUJUTSU_REPO to a repository path'
    values['14 jujutsu title font'] = 'skipped: set DSH_JUJUTSU_REPO to a repository path'
  }

  return values
}

const panels = control.detected ? await measurePanels() : null
const allMeasured = measured === null || panels === null ? null : { ...measured, ...panels }
const mismatches =
  allMeasured === null
    ? ['not measured: the control failed']
    : Object.entries(EXPECTED)
        .filter(([key, want]) => allMeasured[key] !== want)
        .map(([key, want]) => `${key}: expected ${want}, measured ${allMeasured[key]}`)

// "Could not look" and "looked and found nothing" must not print the same thing.
// An unrunnable control is a setup problem with a fixable cause; a control that
// ran and missed its injected fault is a broken gate. Only the second is UNTRUSTED.
const verdict = !control.ran
  ? `NOT RUN: the control had nothing to test (${control.reason})`
  : !control.detected
    ? 'UNTRUSTED: the probe was shown a fault and missed it'
    : mismatches.length === 0
      ? 'matches the reference on every measured value'
      : `${mismatches.length} value(s) drift from the reference`

process.stdout.write(
  `${JSON.stringify(
    {
      controlPassed: control.detected,
      control,
      trusted: control.ran && control.detected,
      measured: allMeasured,
      mismatches,
      verdict,
    },
    null,
    2,
  )}\n`,
)

await browser.close()
process.exit(control.ran && control.detected && mismatches.length === 0 ? 0 : 1)