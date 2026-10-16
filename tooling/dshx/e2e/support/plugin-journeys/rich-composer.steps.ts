import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const newThreadComposer = (page: Page) =>
  page.getByRole('textbox', {
    name: 'Describe what you want to build, / commands, @ files or sessions',
    exact: true,
  })

When('a canonical thread mention is pasted into a new thread composer', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  const composer = newThreadComposer(page)
  await expect(composer).toBeVisible()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
  const mention = `@[Pasted thread](dsh-session:${Buffer.from(JSON.stringify('session-e2e')).toString('base64url')})`
  await page.evaluate(async value => navigator.clipboard.writeText(value), mention)
  await composer.click()
  await page.keyboard.press('Meta+V')
})

Then('the pasted mention is displayed as a reference chip', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'rich-composer-paste-creates-session-reference-chip', async () => {
    const chip = page.locator('[data-composer-chip="reference"]')
    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveText('Pasted thread')
  })
  await finishJourneyAssertions(page)
})
