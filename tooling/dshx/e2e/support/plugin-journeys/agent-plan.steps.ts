import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { When, Then } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const STEPS = ['Read the pricing module', 'Fix the rounding bug', 'Run the cart tests'] as const

const todoWrite = (statuses: readonly ('pending' | 'in_progress' | 'completed')[]): string =>
  `[[call todo_write ${JSON.stringify({ todos: STEPS.map((content, index) => ({ content, status: statuses[index] ?? 'pending' })) })}]]`

const openFreshThread = async (page: Page, prefix: string): Promise<void> => {
  const root = await createScratchDirectory(`dshx-agent-plan-${prefix}-`)
  const workspace = join(root, `agent-plan-${prefix}`)
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: `agent-plan-${prefix}`, model: 'commandcode_work/gpt-6-luna' })
}

/** A finished turn folds its tool rows: open each folded turn, then each folded plan group, so the cards show. */
const revealPlanCards = async (page: Page): Promise<void> => {
  const folded = (text: RegExp) => page.locator('[aria-expanded="false"]').filter({ hasText: text })
  for (const pattern of [/^Completed in/, /^Updated the plan/]) {
    while ((await folded(pattern).count()) > 0) await folded(pattern).first().click()
  }
}

const send = async (page: Page, text: string): Promise<void> => {
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(text)
  await composer.press('Enter')
}

When('the fake model writes a three-step plan and then marks its first step done in a fresh workspace', async ({ page }: { page: Page }) => {
  await openFreshThread(page, 'plan')
  await send(page, todoWrite(['in_progress', 'pending', 'pending']))
  await expect(page.getByText('Tool finished.', { exact: true })).toBeVisible({ timeout: 60_000 })
  await send(page, todoWrite(['completed', 'in_progress', 'pending']))
  await expect(page.getByText('Tool finished.', { exact: true })).toHaveCount(2, { timeout: 60_000 })
})

Then('the latest plan card says step 2 of 3 and lists every step', async ({ page }: { page: Page }) => {
  await revealPlanCards(page)
  const card = page.locator('[data-dshfiles-agent-plan-card]').filter({ hasText: 'Step 2 of 3' })
  await recordAssertion(page, 'agent-plan-card-shows-progress', async () => {
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText('Step 2 of 3 · Fix the rounding bug')
    await expect(card).toContainText('1/3')
  })
  await recordAssertion(page, 'agent-plan-card-lists-steps', async () => {
    const steps = card.getByRole('list', { name: 'Plan steps' })
    await expect(steps.getByRole('listitem')).toHaveCount(3)
    await expect(steps.getByRole('listitem', { name: 'Step 1: Read the pricing module, done' })).toBeVisible()
    await expect(steps.getByRole('listitem', { name: 'Step 2: Fix the rounding bug, in progress' })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the composer pins the current plan step', async ({ page }: { page: Page }) => {
  const pin = page.getByRole('button', { name: 'Step 2 of 3: Fix the rounding bug. Show the plan' })
  await recordAssertion(page, 'agent-plan-pin-shows-current-step', async () => {
    await expect(pin).toBeVisible({ timeout: 30_000 })
  })
  await pin.click()
  await recordAssertion(page, 'agent-plan-pin-opens-plan', async () => {
    await expect(page.getByRole('dialog').getByRole('list', { name: 'Plan steps' }).getByRole('listitem')).toHaveCount(3)
  })
  await page.keyboard.press('Escape')
  await finishJourneyAssertions(page)
})

When('the fake model starts a twenty-second command in a fresh workspace', async ({ page }: { page: Page }) => {
  await openFreshThread(page, 'activity')
  await send(page, `[[call bash ${JSON.stringify({ command: 'sleep 20', description: 'Wait twenty seconds' })}]]`)
})

Then('the activity strip names the running tool call with a timer', async ({ page }: { page: Page }) => {
  const strip = page.getByRole('button', { name: /^Running now: bash/ })
  await recordAssertion(page, 'agent-plan-activity-strip-visible', async () => {
    await expect(strip).toBeVisible({ timeout: 60_000 })
    await expect(strip).toContainText(/\d+s/)
  })
  await strip.click()
  await recordAssertion(page, 'agent-plan-activity-strip-lists-call', async () => {
    const details = page.getByRole('dialog')
    const toolCalls = details.locator('section').filter({ has: page.getByRole('heading', { name: 'Tool calls' }) })
    await expect(toolCalls.getByText('bash', { exact: true })).toBeVisible()
  })
  await page.keyboard.press('Escape')
  await finishJourneyAssertions(page)
})

When('the fake provider rejects the next request in a fresh workspace', async ({ page }: { page: Page }) => {
  await openFreshThread(page, 'failure')
  await send(page, '[[fail The fake provider rejected this request]]')
})

Then('the failed turn offers Retry and Ask to fix', async ({ page }: { page: Page }) => {
  const bar = page.locator('[data-dshfiles-agent-failure="turn-error"]')
  await recordAssertion(page, 'agent-plan-failure-actions-visible', async () => {
    await expect(bar).toBeVisible({ timeout: 60_000 })
    await expect(bar.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Ask to fix' })).toBeVisible()
  })
})

Then('Ask to fix puts the failure into the composer', async ({ page }: { page: Page }) => {
  await page.locator('[data-dshfiles-agent-failure="turn-error"]').getByRole('button', { name: 'Ask to fix' }).click()
  await recordAssertion(page, 'agent-plan-ask-to-fix-fills-composer', async () => {
    await expect(page.getByRole('textbox', { name: THREAD_COMPOSER })).toContainText('The fake provider rejected this request')
  })
  await finishJourneyAssertions(page)
})
