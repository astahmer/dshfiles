import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const peek = (page: Page) => page.getByRole('complementary', { name: 'Item detail' })

When('{string} is commented on the open item', async ({ page }: { page: Page }, text: string) => {
  const comment = peek(page).getByRole('textbox', { name: 'Comment', exact: true })
  await comment.fill(text)
  await peek(page).getByRole('button', { name: 'Reply', exact: true }).click()
})

Then('the agent thread {string} opens with its instructions for {string}', async ({ page }: { page: Page }, title: string, task: string) => {
  await recordAssertion(page, 'agents-comment-dispatch-starts-a-thread', async () => {
    await expect(page.getByRole('treeitem', { name: new RegExp(`^${title}\\b`, 'u') })).toHaveAttribute('aria-selected', 'true')
    // The sent message renders the agent mention as a chip, then the agent's instructions and the user's task.
    await expect(page.getByText('Work as', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'dsh', exact: true })).toBeVisible()
    await expect(page.getByText(new RegExp(`---\\s*${task}`, 'u'))).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the start thread dialog offers the agent {string}', async ({ page }: { page: Page }, handle: string) => {
  await peek(page).getByRole('button', { name: 'Start thread', exact: true }).click()
  const agents = page.getByLabel('Thread agent', { exact: true })
  await expect(agents).toBeVisible()
  await expect(agents.locator('option', { hasText: handle })).toHaveCount(1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await finishJourneyAssertions(page)
})

Then('the item links the @{word} thread {string}', async ({ page }: { page: Page }, handle: string, title: string) => {
  await recordAssertion(page, 'agents-comment-dispatch-links-the-item', async () => {
    await expect(peek(page).getByRole('button', { name: /^Unlink thread session-/ })).toBeVisible()
    await expect(peek(page).getByRole('button', { name: title, exact: true })).toBeVisible()
    await expect(
      peek(page)
        .getByText(new RegExp(`@${handle}\\b`, 'u'))
        .first(),
    ).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const openAgentsPanel = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Agents', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible()
}

const instructionsField = (page: Page) => page.getByRole('textbox', { name: /^Instructions/u })

Then('the agent {string} is saved with instructions {string}', async ({ page }: { page: Page }, name: string, instructions: string) => {
  await openAgentsPanel(page)
  await page.getByRole('button', { name: 'New agent', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await instructionsField(page).fill(instructions)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
})

Then('the Agents panel lists {string} with those instructions', async ({ page }: { page: Page }, name: string) => {
  await recordAssertion(page, 'agents-registry-persists-a-new-agent', async () => {
    const row = page.getByRole('button', { name: new RegExp(`@${name.toLowerCase()}$`, 'u') })
    await expect(row).toBeVisible()
    await row.click()
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name)
    await expect(instructionsField(page)).toHaveValue('Prefer small findings.')
  })
  await finishJourneyAssertions(page)
})
