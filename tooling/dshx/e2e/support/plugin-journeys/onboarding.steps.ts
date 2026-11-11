import { expect, test, type Page } from '@playwright/test'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const STARTER_PROMPT = 'Explain how this project is organised and where I should start reading.'

const gettingStarted = (page: Page) => page.getByRole('main', { name: 'Getting started', exact: true })
const wizard = (page: Page) => page.locator('[data-setup-wizard]')
const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
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
    await expect(memory.getByRole('button')).toHaveCount(0)
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
