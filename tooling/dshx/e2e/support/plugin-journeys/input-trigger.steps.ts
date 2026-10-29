import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import type {} from '../../../packages/dshx/src/client/broker.js'
import type { ComposerService } from '../../../packages/dshx/src/client/app-services.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const composerInput = (page: Page) => page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })

When('{string} is typed in the composer', async ({ page }: { page: Page }, text: string) => {
  const composer = composerInput(page)
  await expect(composer).toBeVisible()
  await composer.click()
  await page.keyboard.type(text)
})

Then('the slash menu offers the {string} command', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'command-slash-entry-is-offered', () => expect(page.getByRole('option', { name: new RegExp(title) })).toBeVisible())
})

When('Enter picks the highlighted slash entry', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Enter')
})

Then('the sidebar collapses and the composer draft is empty', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'command-slash-entry-runs-the-command', () => expect(page.locator('[data-sidebar-collapsed]')).toHaveCount(1))
  await recordAssertion(page, 'command-slash-entry-clears-its-token', async () => {
    const draft = await page.evaluate(() => {
      const live = globalThis.__dshxBrokerV1?.contracts.get('dshx.composer')?.live
      // SAFETY: the broker stores contract values untyped; `dshx.composer` is only ever provided with a ComposerService.
      return live?.status === 'active' ? (live.value as ComposerService).text() : undefined
    })
    expect(draft?.trim()).toBe('')
  })
  await finishJourneyAssertions(page)
})
