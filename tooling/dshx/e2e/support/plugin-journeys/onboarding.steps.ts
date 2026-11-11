import { expect, test, type Page } from '@playwright/test'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion, settingsPage } from '../steps.js'

const STARTER_PROMPT = 'Explain how this project is organised and where I should start reading.'

const gettingStarted = (page: Page) => page.getByRole('main', { name: 'Getting started', exact: true })
const wizard = (page: Page) => page.locator('[data-setup-wizard]')
const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const packDialog = (page: Page) => page.locator('[data-pack-dialog]')
const pack = (page: Page, title: string) =>
  gettingStarted(page)
    .locator('[data-pack]')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const composer = (page: Page) => page.getByRole('textbox', { name: /commands, @ files or sessions$/u }).first()

const runPaletteCommand = async (page: Page, title: string): Promise<void> => {
  await page.getByRole('button', { name: 'Open command palette', exact: true }).click()
  await paletteDialog(page).getByRole('combobox').fill(title.replace('Onboarding: ', ''))
  await paletteDialog(page)
    .getByRole('option', { name: new RegExp(`^${title}`, 'u') })
    .click()
}

When('the setup wizard shown on first run is skipped', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-wizard-first-run', async () => {
    await expect(page.getByRole('region', { name: 'Connect an AI account', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
  await wizard(page).getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(wizard(page)).toHaveCount(0)
})

When('Getting started is opened from the Knowledge destination', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Knowledge', exact: true }).click()
  await page.getByRole('navigation', { name: 'Knowledge pages', exact: true }).getByRole('button', { name: 'Getting started', exact: true }).click()
  await expect(gettingStarted(page).getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible()
})

Then('Getting started shows the setup checklist, the packs and curated features', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-getting-started-sections', async () => {
    const checklist = gettingStarted(page).getByRole('region', { name: /^Setup checklist/u })
    await expect(checklist.locator('[data-checklist-item]')).toHaveCount(4)
    await expect(checklist.locator('[data-checklist-item="github"]')).toHaveAttribute('data-state', /^(done|todo|unknown)$/u)
    const packs = gettingStarted(page).getByRole('region', { name: /^Packs/u })
    await expect(packs.locator('[data-pack]')).toHaveCount(8)
    await expect(packs.locator('[data-pack="core"]').getByText('thread-sidebar · enabled', { exact: true })).toBeVisible()
    await expect(gettingStarted(page).getByRole('list', { name: 'Features', exact: true }).locator('[data-feature]').first()).toBeVisible()
  })
  await page.screenshot({ path: test.info().outputPath('getting-started.png'), animations: 'disabled' })
})

Then('a feature whose page is not loaded has no Open button', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-no-dead-open-button', async () => {
    await gettingStarted(page).getByLabel('Search features').fill('memory panel')
    const memory = gettingStarted(page).locator('[data-feature^="memory#"]').first()
    await expect(memory).toBeVisible()
    await expect(memory.getByRole('button', { name: /^Open / })).toHaveCount(0)
  })
})

When("a feature's Open button is used", async ({ page }: { page: Page }) => {
  await gettingStarted(page).getByLabel('Search features').fill('organize threads by workspace')
  await gettingStarted(page)
    .locator('[data-feature^="thread-sidebar#"]')
    .filter({ has: page.getByRole('button', { name: /^Open / }) })
    .first()
    .getByRole('button', { name: /^Open / })
    .click()
})

Then("that feature's page replaces Getting started", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-open-registered-route', async () => {
    await expect(gettingStarted(page)).toBeHidden()
  })
  await finishJourneyAssertions(page)
})

When('Getting started is narrowed to 390 pixels wide', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(gettingStarted(page).getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible()
})

When('Getting started is opened from the command palette', async ({ page }: { page: Page }) => {
  await runPaletteCommand(page, 'Onboarding: Getting started')
  await expect(gettingStarted(page).getByRole('heading', { name: 'Getting started', exact: true })).toBeVisible()
})

Then('every Getting started control is at least 44 pixels tall and the search answers to the keyboard', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-narrow-touch-targets', async () => {
    const width = await gettingStarted(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)
    expect(width).toBe(true)
    const heights = await gettingStarted(page)
      .locator('button, input')
      .evaluateAll(elements =>
        elements
          .filter(element => element instanceof HTMLElement && element.offsetParent !== null)
          .map(element => ({ name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '', height: element.getBoundingClientRect().height })),
      )
    expect(heights.length).toBeGreaterThan(10)
    expect(heights.filter(entry => entry.height < 44)).toEqual([])
  })
  await recordAssertion(page, 'onboarding-keyboard-search', async () => {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await page.keyboard.press('/')
    await expect(gettingStarted(page).getByLabel('Search features')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(gettingStarted(page).getByLabel('Search features')).toHaveValue('')
    await page.keyboard.type('onboarding checklist')
    await expect(gettingStarted(page).locator('[data-feature="onboarding#getting-started"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(gettingStarted(page).getByLabel('Search features')).toHaveValue('')
  })
  await page.screenshot({ path: test.info().outputPath('getting-started-390.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 900 })
})

Then('the setup wizard stays closed after a reload', async ({ page }: { page: Page }) => {
  await StartupDialogs.reloadPastProviderSetup(page)
  await expect(page.getByRole('tab', { name: 'Threads', exact: true })).toBeVisible()
  await recordAssertion(page, 'onboarding-wizard-skip-persists', async () => {
    await expect(wizard(page)).toHaveCount(0)
  })
})

When('the setup wizard is replayed from the command palette', async ({ page }: { page: Page }) => {
  await runPaletteCommand(page, 'Onboarding: Show the setup wizard')
  await expect(page.getByRole('region', { name: 'Connect an AI account', exact: true })).toBeVisible()
  await expect(wizard(page).locator('[data-wizard-item="account"]')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('setup-wizard.png'), animations: 'disabled' })
})

When('the setup wizard is walked to the first task and a starter prompt is inserted', async ({ page }: { page: Page }) => {
  await wizard(page).getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Add a project', exact: true })).toBeVisible()
  await wizard(page).getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Start a first task', exact: true })).toBeVisible()
  await wizard(page).getByRole('button', { name: 'Insert prompt', exact: true }).click()
})

Then('the composer holds the starter prompt and no message was sent', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-insert-never-sends', async () => {
    await expect(wizard(page).getByRole('status')).toHaveText('In the composer. Send it when ready.')
    await expect(composer(page)).toContainText(STARTER_PROMPT)
    // A send clears the composer; the prompt is still there once any send would have happened.
    await page.waitForTimeout(1_500)
    await expect(composer(page)).toContainText(STARTER_PROMPT)
  })
  await wizard(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(wizard(page)).toHaveCount(0)
})

Then('the palette opened Getting started with its eight packs', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-palette-opens-page', async () => {
    await expect(
      gettingStarted(page)
        .getByRole('region', { name: /^Packs/u })
        .locator('[data-pack]'),
    ).toHaveCount(8)
  })
  await finishJourneyAssertions(page)
})

const walkCard = (page: Page) => page.locator('[data-walk-card]')
const walkRing = (page: Page) => page.locator('[data-walk-ring]')
const WALK_EVENTS = ['pointerdown', 'click', 'pointerover', 'input', 'keydown']

/**
 * Passive listeners on document and window by type, read through CDP. The walk registers only passive ones; the app's
 * own click and key handlers are not passive and come and go with focus, so they stay out of the count.
 */
const listenerCounts = async (page: Page): Promise<Record<string, number>> => {
  const cdp = await page.context().newCDPSession(page)
  const counts: Record<string, number> = {}
  for (const expression of ['document', 'window']) {
    const handle = await cdp.send('Runtime.evaluate', { expression })
    const objectId = handle.result.objectId
    if (objectId === undefined) continue
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId })
    for (const listener of listeners)
      if (listener.passive && WALK_EVENTS.includes(listener.type))
        counts[`${expression}.${listener.type}`] = (counts[`${expression}.${listener.type}`] ?? 0) + 1
  }
  await cdp.detach()
  return counts
}
/** What one walk adds: capture listeners on document for its evidence, and the Escape listener on window. */
const WALK_LISTENERS = {
  'document.pointerdown': 1,
  'document.click': 1,
  'document.pointerover': 1,
  'document.input': 1,
  'document.keydown': 1,
  'window.keydown': 1,
} as const satisfies Record<string, number>
const listenersBeforeEnd = new WeakMap<Page, Record<string, number>>()
const difference = (from: Record<string, number>, to: Record<string, number>): Record<string, number> =>
  Object.fromEntries(
    [...new Set([...Object.keys(from), ...Object.keys(to)])].flatMap(key => {
      const delta = (from[key] ?? 0) - (to[key] ?? 0)
      return delta === 0 ? [] : [[key, delta]]
    }),
  )
const walksEnded = new WeakMap<Page, number>()

When('Show me where is started on {string}', async ({ page }: { page: Page }, title: string) => {
  // Programmatic (untrusted) events would mean something other than the user acted.
  await page.evaluate(() => {
    if (document.documentElement.dataset.untrustedInput !== undefined) return
    document.documentElement.dataset.untrustedInput = '0'
    const record = (event: Event): void => {
      if (!event.isTrusted) document.documentElement.dataset.untrustedInput = String(Number(document.documentElement.dataset.untrustedInput) + 1)
    }
    for (const type of ['click', 'pointerdown', 'pointerover', 'input', 'keydown']) window.addEventListener(type, record, { capture: true })
  })
  await gettingStarted(page).getByLabel('Search features').fill(title)
  const before = await listenerCounts(page)
  const show = gettingStarted(page).getByRole('button', { name: `Show me where: ${title}`, exact: true })
  await show.focus()
  await page.keyboard.press('Enter')
  await expect(walkCard(page)).toBeVisible()
  await expect.poll(async () => difference(await listenerCounts(page), before)).toEqual(WALK_LISTENERS)
})

Then(
  'the walk rings {string} as step 1 of {int} without covering it, with 44 pixel controls',
  async ({ page }: { page: Page }, name: string, total: number) => {
    await recordAssertion(page, 'onboarding-walk-first-step', async () => {
      await expect(walkCard(page).locator('[data-walk-chip]')).toHaveText(`Step 1 of ${String(total)} · Click "${name}"`)
      await expect(walkCard(page).locator('[aria-live="polite"]')).toContainText(`button "${name}"`)
      await expect(walkCard(page)).toHaveAttribute('data-walk-phase', 'found')
      await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeFocused()
      const target = await page.getByRole('button', { name, exact: true }).first().boundingBox()
      const ring = await walkRing(page).boundingBox()
      const card = await walkCard(page).boundingBox()
      if (target === null || ring === null || card === null) throw new Error('target, ring or card has no box')
      expect(ring.x).toBeLessThanOrEqual(target.x)
      expect(ring.y).toBeLessThanOrEqual(target.y)
      expect(ring.x + ring.width).toBeGreaterThanOrEqual(target.x + target.width)
      expect(ring.y + ring.height).toBeGreaterThanOrEqual(target.y + target.height)
      const overlaps =
        card.x < target.x + target.width && target.x < card.x + card.width && card.y < target.y + target.height && target.y < card.y + card.height
      expect(overlaps).toBe(false)
      expect(card.x + card.width).toBeLessThanOrEqual(390)
      expect(await walkRing(page).evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
      const heights = await walkCard(page)
        .locator('button, a')
        .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
      expect(heights.length).toBeGreaterThan(0)
      expect(heights.filter(height => height < 44)).toEqual([])
    })
    await page.screenshot({ path: test.info().outputPath('show-me-where.png'), animations: 'disabled' })
  },
)

/** A real pointer click at the ring's centre: the ring ignores the pointer, so the control under it gets the click. */
When('each ringed control is clicked in turn', async ({ page }: { page: Page }) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // A control that renders after the last click (a menu item) is found within a moment; one that never shows is not.
    const shown = await expect(walkCard(page))
      .toHaveAttribute('data-walk-phase', 'found', { timeout: 3_000 })
      .then(
        () => true,
        () => false,
      )
    if (!shown) return
    const chip = await walkCard(page).locator('[data-walk-chip]').textContent()
    // A menu slides in: click once the ring stopped following it (two reads a frame apart agree).
    let ring = await walkRing(page).boundingBox()
    await expect
      .poll(
        async () => {
          const previous = JSON.stringify(ring)
          await page.waitForTimeout(50)
          ring = await walkRing(page).boundingBox()
          return JSON.stringify(ring) === previous
        },
        { intervals: [100, 100, 200, 200] },
      )
      .toBe(true)
    if (ring === null) throw new Error('no ring')
    await page.mouse.click(ring.x + ring.width / 2, ring.y + ring.height / 2)
    await expect(walkCard(page).locator('[data-walk-chip]')).not.toHaveText(chip ?? '')
  }
})

Then('the walk reaches {string}, announces it, and clicked nothing by itself', async ({ page }: { page: Page }, name: string) => {
  await recordAssertion(page, 'onboarding-walk-arrives', async () => {
    await expect(walkCard(page)).toHaveAttribute('data-walk-phase', 'arrived')
    await expect(walkCard(page).locator('[data-walk-chip]')).toHaveText(new RegExp(`^Step (\\d+) of \\1 · Here: "${name}"$`, 'u'))
    await expect(walkCard(page).locator('[aria-live="polite"]')).toContainText('You reached')
    await expect(walkRing(page)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.dataset.untrustedInput ?? '0')).toBe('0')
  })
})

When('Next is pressed from the keyboard on the walk', async ({ page }: { page: Page }) => {
  await expect(walkCard(page).getByRole('button', { name: 'Next', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
})

When('the walk is ended', async ({ page }: { page: Page }) => {
  listenersBeforeEnd.set(page, await listenerCounts(page))
  await walkCard(page).getByRole('button', { name: 'End', exact: true }).click()
})

When('the walk is ended with Escape', async ({ page }: { page: Page }) => {
  await walkCard(page).getByRole('button', { name: 'End', exact: true }).focus()
  listenersBeforeEnd.set(page, await listenerCounts(page))
  await page.keyboard.press('Escape')
})

Then('no walk overlay or walk listener is left', async ({ page }: { page: Page }) => {
  const ended = (walksEnded.get(page) ?? 0) + 1
  walksEnded.set(page, ended)
  await recordAssertion(page, `onboarding-walk-cleanup-${String(ended)}`, async () => {
    await expect(walkCard(page)).toHaveCount(0)
    await expect(walkRing(page)).toHaveCount(0)
    // Ending removes exactly what the walk added, whatever the page it led to registered meanwhile.
    await expect.poll(async () => difference(listenersBeforeEnd.get(page) ?? {}, await listenerCounts(page))).toEqual(WALK_LISTENERS)
  })
})

Then('after 10 seconds the walk says the Memory button is not on screen and names Knowledge', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-walk-missing', async () => {
    await expect(walkCard(page).locator('[data-walk-chip]')).toHaveText('Step 2 of 3 · Click "Memory"')
    await expect(walkCard(page)).toHaveAttribute('data-walk-phase', 'seeking')
    await expect(walkCard(page)).toHaveAttribute('data-walk-phase', 'missing', { timeout: 12_000 })
    await expect(walkCard(page).getByRole('note')).toContainText('button "Memory" is not on screen.')
    await expect(walkCard(page).getByRole('note')).toContainText('lives in Knowledge')
    await expect(walkCard(page).getByRole('button', { name: 'Next', exact: true })).toBeVisible()
    await expect(walkCard(page).getByRole('button', { name: 'Open', exact: true })).toHaveCount(0)
  })
  await page.screenshot({ path: test.info().outputPath('show-me-where-missing.png'), animations: 'disabled' })
})

/** Requests that would change the profile or restart DSH; the preview journey must send none. */
const writes = new WeakMap<Page, string[]>()

When('Enable pack is pressed from the keyboard on the {string} pack', async ({ page }: { page: Page }, title: string) => {
  const seen: string[] = []
  writes.set(page, seen)
  page.on('request', request => {
    if (/applyPack|[Rr]estart/u.test(request.url()) || /applyPack|requestRestart/u.test(request.postData() ?? '')) seen.push(request.url())
  })
  await page.evaluate(() => sessionStorage.setItem('onboarding-e2e-no-reload', 'kept'))
  // The open dialog hides the page from the accessibility tree, so its box is read by element, not by role.
  const pageBox = () => page.locator('main[aria-label="Getting started"]').boundingBox()
  const before = await pageBox()
  await pack(page, title)
    .getByRole('button', { name: `Enable pack: ${title}`, exact: true })
    .focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: `Enable ${title}`, exact: true })).toBeVisible()
  const after = await pageBox()
  await recordAssertion(page, 'onboarding-pack-dialog-no-shift', async () => {
    expect(after?.x).toBe(before?.x)
    expect(after?.width).toBe(before?.width)
  })
})

Then('the pack preview names what would install and the restart it needs, with 44 pixel controls and no page shift', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-pack-preview', async () => {
    const dialog = packDialog(page)
    await expect(dialog.locator('[data-preview-section="install"]')).toBeVisible()
    await expect(dialog.locator('[data-preview-section="install"]')).toContainText('traces')
    await expect(dialog.locator('[data-preview-section="restart"]')).toContainText('Restart when idle')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    const width = await dialog.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)
    expect(width).toBe(true)
    const heights = await dialog
      .locator('button, a')
      .evaluateAll(elements =>
        elements.filter(element => element instanceof HTMLElement && element.offsetParent !== null).map(element => element.getBoundingClientRect().height),
      )
    expect(heights.length).toBeGreaterThan(0)
    expect(heights.filter(height => height < 44)).toEqual([])
  })
  await page.screenshot({ path: test.info().outputPath('pack-change.png'), animations: 'disabled' })
})

When('the pack preview is dismissed with Escape', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

Then(
  'the {string} pack is unchanged, its Enable pack button has focus again and nothing was applied or restarted',
  async ({ page }: { page: Page }, title: string) => {
    await recordAssertion(page, 'onboarding-pack-cancel-changes-nothing', async () => {
      await expect(pack(page, title).getByRole('button', { name: `Enable pack: ${title}`, exact: true })).toBeFocused()
      await expect(pack(page, title).locator('[data-plugin-state="not-installed"]')).toHaveCount(4)
      expect(writes.get(page) ?? []).toEqual([])
      expect(await page.evaluate(() => sessionStorage.getItem('onboarding-e2e-no-reload'))).toBe('kept')
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await finishJourneyAssertions(page)
  },
)

const whatsNew = (page: Page) => gettingStarted(page).locator('[data-whats-new]')
const WHATS_NEW_SEEN_KEY = 'dshfiles.onboarding.whats-new.v1'

Then("What's new shows the checkout's changes or says why it cannot, and never errors", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-whats-new-honest-state', async () => {
    await expect(gettingStarted(page).getByRole('region', { name: /^What's new/u })).toBeVisible()
    // The scratch profile may or may not link the bundle from a checkout: either honest state passes, an error never does.
    await expect(whatsNew(page)).toHaveAttribute('data-whats-new', /^(ready|no-checkout|unreadable)$/u)
    const state = await whatsNew(page).getAttribute('data-whats-new')
    if (state === 'ready') {
      // A first visit lists changes without a New badge on each.
      await expect(whatsNew(page).locator('[data-whats-new-entry][data-new]')).toHaveCount(0)
      expect(await page.evaluate(key => localStorage.getItem(key), WHATS_NEW_SEEN_KEY)).toBeNull()
    } else {
      await expect(whatsNew(page).getByRole('link', { name: 'Open the commits on GitHub', exact: true })).toHaveAttribute('href', /^https:\/\/github\.com\//u)
    }
  })
  await whatsNew(page).scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('whats-new.png'), animations: 'disabled' })
})

Then("What's new keeps 44 pixel controls, and Mark as seen from the keyboard is the only thing that moves its last visit", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-whats-new-narrow', async () => {
    const fits = await whatsNew(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)
    expect(fits).toBe(true)
    const heights = await whatsNew(page)
      .locator('button, a')
      .evaluateAll(elements =>
        elements.filter(element => element instanceof HTMLElement && element.offsetParent !== null).map(element => element.getBoundingClientRect().height),
      )
    expect(heights.filter(height => height < 44)).toEqual([])
  })
  await recordAssertion(page, 'onboarding-whats-new-mark-seen', async () => {
    expect(await page.evaluate(key => localStorage.getItem(key), WHATS_NEW_SEEN_KEY)).toBeNull()
    const mark = whatsNew(page).getByRole('button', { name: 'Mark as seen', exact: true })
    if ((await whatsNew(page).getAttribute('data-whats-new')) !== 'ready' || (await mark.count()) === 0) return
    await mark.focus()
    await page.keyboard.press('Enter')
    await expect(mark).toHaveCount(0)
    expect(await page.evaluate(key => localStorage.getItem(key), WHATS_NEW_SEEN_KEY)).toMatch(/^"\d{4}-\d{2}-\d{2}T/u)
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await finishJourneyAssertions(page)
})

const suggestionsSection = (page: Page) => gettingStarted(page).locator('[data-suggestions]')

Then('Suggestions is off and offers its setting in one line', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-suggestions-off', async () => {
    await expect(gettingStarted(page).getByRole('region', { name: /^Suggestions/u })).toBeVisible()
    await expect(suggestionsSection(page)).toHaveAttribute('data-suggestions', 'off')
    await expect(suggestionsSection(page).locator('p')).toHaveCount(1)
    await expect(suggestionsSection(page).locator('[data-suggestion]')).toHaveCount(0)
  })
})

When('Suggestions is turned on from its Settings link', async ({ page }: { page: Page }) => {
  await suggestionsSection(page).getByRole('button', { name: 'Turn on in Settings', exact: true }).click()
  const row = settingsPage(page)
    .locator('[data-setting-path="suggestions"]')
    .filter({ has: page.getByRole('switch') })
    .first()
  const toggle = row.getByRole('switch')
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
})

Then('Suggestions shows a suggestion or an honest empty state with 44 pixel controls at 390 pixels, and never errors', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await recordAssertion(page, 'onboarding-suggestions-on', async () => {
    // A scratch profile has little or no tool use: an empty ready state or an absent Usage owner is honest, an error never is.
    await expect(suggestionsSection(page)).toHaveAttribute('data-suggestions', /^(ready|no-usage)$/u)
    const state = await suggestionsSection(page).getAttribute('data-suggestions')
    const suggested = await suggestionsSection(page).locator('[data-suggestion]').count()
    if (state === 'no-usage') await expect(suggestionsSection(page).getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    if (state === 'ready' && suggested === 0) await expect(suggestionsSection(page).locator('[data-suggestions-empty]')).toBeVisible()
    const fits = await suggestionsSection(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)
    expect(fits).toBe(true)
    const heights = await suggestionsSection(page)
      .locator('button, a')
      .evaluateAll(elements =>
        elements.filter(element => element instanceof HTMLElement && element.offsetParent !== null).map(element => element.getBoundingClientRect().height),
      )
    expect(heights.filter(height => height < 44)).toEqual([])
  })
  await suggestionsSection(page).scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('usage-suggestions.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await finishJourneyAssertions(page)
})

const TRY_IT_FEATURE = 'onboarding#try-it'
const tryItDialog = (page: Page) => page.locator('[data-try-it-dialog]')
const featureRow = (page: Page, key: string) => gettingStarted(page).locator(`[data-feature="${key}"]`)

const searchFeatures = async (page: Page, text: string): Promise<void> => {
  await gettingStarted(page).getByRole('textbox', { name: 'Search features', exact: true }).fill(text)
}

/** Anything that would start a thread or reach a model: the Try it API call, a Session create or prompt, a provider call. */
const SEND_PATTERN = /tryIt|session\/create|session\/prompt|createSession|chat\/completions|\/v1\/messages|\/v1\/responses/u
const sends = new WeakMap<Page, string[]>()

Then('no feature or pack offers Try it while it is off', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-try-it-off', async () => {
    await expect(gettingStarted(page).getByRole('list', { name: 'Features', exact: true }).locator('[data-feature]').first()).toBeVisible()
    await expect(gettingStarted(page).locator('[data-pack]').first()).toBeVisible()
    await expect(gettingStarted(page).getByRole('button', { name: /^Try it/u })).toHaveCount(0)
    await searchFeatures(page, 'Try a feature with the agent')
    await expect(featureRow(page, TRY_IT_FEATURE)).toBeVisible()
    await expect(featureRow(page, TRY_IT_FEATURE).getByRole('button', { name: /^Try it/u })).toHaveCount(0)
  })
})

When('Try it is turned on from its own feature row in Getting started', async ({ page }: { page: Page }) => {
  await featureRow(page, TRY_IT_FEATURE).getByRole('button', { name: 'Open Try a feature with the agent in a new thread', exact: true }).click()
  const toggle = settingsPage(page)
    .locator('[data-setting-path="tryIt"]')
    .filter({ has: page.getByRole('switch') })
    .first()
    .getByRole('switch')
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
})

When('Try it is pressed from the keyboard on the {string} feature', async ({ page }: { page: Page }, title: string) => {
  const seen: string[] = []
  sends.set(page, seen)
  page.on('request', request => {
    if (SEND_PATTERN.test(request.url()) || SEND_PATTERN.test(request.postData() ?? '')) seen.push(request.url())
  })
  page.on('websocket', socket => {
    socket.on('framesent', frame => {
      if (typeof frame.payload === 'string' && SEND_PATTERN.test(frame.payload)) seen.push(`ws:${frame.payload.slice(0, 120)}`)
    })
  })
  await searchFeatures(page, title)
  const button = featureRow(page, TRY_IT_FEATURE).getByRole('button', { name: `Try it: ${title}`, exact: true })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: `Try it: ${title}`, exact: true })).toBeVisible()
})

Then('the Try it confirmation names the token cost with 44 pixel controls and nothing was sent yet', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-try-it-cost', async () => {
    const dialog = tryItDialog(page)
    await expect(dialog.locator('[data-try-it-cost]')).toContainText('starts a new thread')
    await expect(dialog.locator('[data-try-it-cost]')).toContainText('spends tokens on your current AI account')
    await expect(dialog.getByRole('button', { name: 'Start demo', exact: true })).toBeVisible()
    const fits = await dialog.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)
    expect(fits).toBe(true)
    // Layout heights: the dialog's zoom-in scales its bounding boxes while it opens.
    const heights = await dialog
      .locator('button')
      .evaluateAll(elements =>
        elements
          .filter(element => element instanceof HTMLElement && element.offsetParent !== null)
          .map(element => (element instanceof HTMLElement ? element.offsetHeight : 0)),
      )
    expect(heights.length).toBe(2)
    // Three row buttons collapse to icons in a phone-width pane instead of squeezing the title to a word per line.
    // The open dialog hides the page from the accessibility tree, so the row is read by element, not by role.
    const titleWidth = await page
      .locator(`main[aria-label="Getting started"] [data-feature="${TRY_IT_FEATURE}"] p`)
      .first()
      .evaluate(element => element.getBoundingClientRect().width)
    expect(titleWidth).toBeGreaterThan(120)
    expect(heights.filter(height => height < 44)).toEqual([])
    expect(sends.get(page) ?? []).toEqual([])
  })
  await page.screenshot({ path: test.info().outputPath('try-it.png'), animations: 'disabled' })
})

When('the Try it confirmation is cancelled', async ({ page }: { page: Page }) => {
  await tryItDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

Then('no thread was started and no model request was sent, and Try it has focus again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'onboarding-try-it-cancel-sends-nothing', async () => {
    await expect(featureRow(page, TRY_IT_FEATURE).getByRole('button', { name: /^Try it: /u })).toBeFocused()
    await expect(gettingStarted(page)).toBeVisible()
    // A send would have reached the Host by now; nothing may have left the browser for it.
    await page.waitForTimeout(1_000)
    expect(sends.get(page) ?? []).toEqual([])
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await finishJourneyAssertions(page)
})
