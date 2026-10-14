import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const BASH_DIRECTIVE = `[[call bash ${JSON.stringify({ command: 'sleep 3 && echo tool-meta', description: 'Wait three seconds' })}]]`

const timingLine = (page: Page) => page.locator('[data-dshfiles-tool-meta]')

/** A settled turn folds its steps and groups its shell calls; both are reopened to reach the tool card. */
const revealSettledToolCard = async (page: Page): Promise<void> => {
  await expect(page.getByRole('status').filter({ hasText: /^(Completed|Failed)$/ })).toHaveCount(1, { timeout: 60_000 })
  const card = page.locator('[data-chat-call-id]').first()
  if (await card.isVisible()) return
  const group = page.getByText('Ran commands', { exact: true }).last()
  // The transcript re-renders while it reconnects after a settings save, so a fold toggle can land on a stale row.
  await expect(async () => {
    if (!(await group.isVisible())) await page.getByText(/^Completed in /).last().click()
    await expect(group.or(card).first()).toBeVisible({ timeout: 2_000 })
    if (!(await card.isVisible())) await group.click()
    await expect(card).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

When('the fake model starts a three-second bash call in a fresh workspace', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-tool-meta-e2e-')
  const workspace = join(root, 'timing-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'timing-project', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(BASH_DIRECTIVE)
  await composer.press('Enter')
})

Then('the running tool card counts its elapsed seconds', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'tool-meta-running-call-counts-up', async () => {
    const timer = page.getByRole('timer', { name: /^Running for \d+ s, started \d{2}:\d{2}:\d{2}$/ })
    await expect(timer).toBeVisible({ timeout: 30_000 })
    const first = Number(/^(\d+) s/.exec((await timer.textContent()) ?? '')?.[1])
    await expect(async () => {
      expect(Number(/^(\d+) s/.exec((await timer.textContent()) ?? '')?.[1])).toBeGreaterThan(first)
    }).toPass({ timeout: 5_000 })
  })
})

Then('once the turn settles the tool card shows how long the call took and when it started', async ({ page }: { page: Page }) => {
  await revealSettledToolCard(page)
  await recordAssertion(page, 'tool-meta-settled-call-shows-duration-and-start', async () => {
    const note = page.getByRole('note', { name: /^Took \d+\.\d s, started \d{2}:\d{2}:\d{2}$/ })
    await expect(note).toBeVisible()
    await expect(note).toHaveText(/^[3-9]\.\d s · \d{2}:\d{2}:\d{2}$/)
    await expect(page.getByRole('timer')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

const openToolMetaSettings = async (page: Page): Promise<void> => {
  await page.getByRole('navigation', { name: 'Sidebar navigation' }).or(page.getByRole('navigation', { name: 'Global panels' })).getByRole('button', { name: 'Plugins', exact: true }).first().click()
  await page.getByRole('button', { name: 'View @dshfiles/tool-meta', exact: true }).click()
}

const saveAndReturnToThread = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(async () => {
    await page.getByRole('treeitem', { name: /^Fake thread title/ }).first().click()
    await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('Fake thread title', { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

When('the tool timing time format is set to {string}', async ({ page }: { page: Page }, format: string) => {
  await revealSettledToolCard(page)
  await openToolMetaSettings(page)
  await page.getByRole('combobox', { name: 'Time format', exact: true }).selectOption({ label: format })
  await saveAndReturnToThread(page)
})

Then('the tool card start time reads relative to now', async ({ page }: { page: Page }) => {
  await revealSettledToolCard(page)
  await recordAssertion(page, 'tool-meta-relative-start-time', async () => {
    await expect(page.getByRole('note', { name: /^Took \d+\.\d s, started \d+ (s|min) ago$/ })).toBeVisible()
  })
})

When('the tool timing is turned off', async ({ page }: { page: Page }) => {
  await openToolMetaSettings(page)
  await page.getByRole('switch', { name: 'Enabled', exact: true }).click()
  await saveAndReturnToThread(page)
})

Then('no tool card shows a timing', async ({ page }: { page: Page }) => {
  await revealSettledToolCard(page)
  await recordAssertion(page, 'tool-meta-disabled-hides-the-line', async () => {
    await expect(timingLine(page)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
