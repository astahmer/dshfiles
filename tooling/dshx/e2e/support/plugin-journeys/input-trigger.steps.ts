import { expect, type Page, type TestInfo } from '@playwright/test'
import { Then, When } from '../bdd.js'
import type {} from '../../../packages/dshx/src/client/broker.js'
import type { ComposerService } from '../../../packages/dshx/src/client/app-services.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { materializeNonblankThread } from '../thread-composer.js'

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

When('the composer sends {string}', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }, text: string) => {
  // A plain first message materializes the thread; the second one carries the references, which render as links and
  // chips rather than as the raw text the shared helper waits for.
  await materializeNonblankThread(page, 'Reference card thread', $testInfo)
  await page.getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/u }).fill(text)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Backlog item b:\d+$/u }).last()).toBeVisible({ timeout: 60_000 })
})

const sharedCard = (page: Page, kind: string) => page.locator(`[data-dshfiles-entity-preview="${kind}"]`)

When('the agent mention {string} is previewed', async ({ page }: { page: Page }, handle: string) => {
  // A sent message renders `@handle` as the native mention chip (titled `@handle`); agents opens the shared card from it.
  await page.locator(`[data-conversation-session] [data-ref-chip="file"][title="@${handle}"]`).last().click()
})

When('the backlog reference {string} is previewed', async ({ page }: { page: Page }, label: string) => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: `Backlog item ${label}`, exact: true }).last().click()
})

Then('the shared reference card shows the {string} card with {string}', async ({ page }: { page: Page }, kind: string, text: string) => {
  await recordAssertion(page, `input-trigger-shared-card-${kind}`, async () => {
    await expect(sharedCard(page, kind)).toBeVisible()
    await expect(sharedCard(page, kind)).toContainText(text)
    // One card at a time: the other kinds' cards are not open.
    await expect(page.locator('[data-dshfiles-entity-preview]')).toHaveCount(1)
  })
  if (kind === 'backlog') await finishJourneyAssertions(page)
})
