import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const BASH_DIRECTIVE = `[[call bash ${JSON.stringify({ command: 'sleep 3 && echo tool-meta', description: 'Wait three seconds' })}]]`
const LONG_BASH_DIRECTIVE = `[[call bash ${JSON.stringify({ command: 'sleep 20 && echo wait-timer-job', description: 'Hold a job for the wait timer' })}]]`
const WAIT_DIRECTIVE = `[[call background_jobs_wait ${JSON.stringify({ timeoutMs: 12_000 })}]]`
const WAIT_TIMER_SCREENSHOT = join(tmpdir(), 'dshfiles-tool-meta-wait-timer.png')
const waitProjects = new WeakMap<Page, string>()

const timingLine = (page: Page) => page.locator('[data-dshfiles-tool-meta]')

/** A settled turn folds its steps and groups its shell calls; both are reopened to reach the tool card. */
const revealSettledToolCard = async (page: Page): Promise<void> => {
  await expect(page.getByRole('status').filter({ hasText: /^(Completed|Failed)$/ })).toHaveCount(1, { timeout: 60_000 })
  const card = page.locator('[data-chat-call-id]').first()
  if (await card.isVisible()) return
  const group = page.getByText('Ran commands', { exact: true }).last()
  // The transcript re-renders while it reconnects after a settings save, so a fold toggle can land on a stale row.
  await expect(async () => {
    if (!(await group.isVisible()))
      await page
        .getByText(/^Completed in /)
        .last()
        .click()
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

When('a long shell job starts in the workspace', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-tool-meta-wait-e2e-')
  const workspace = join(root, 'wait-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  waitProjects.set(page, 'wait-project')
  await startThreadWithModel(page, { project: 'wait-project', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(LONG_BASH_DIRECTIVE)
  await composer.press('Enter')
  await expect(page.locator('[data-chat-call-id]').first()).toBeVisible({ timeout: 30_000 })
})

When('a second thread waits for jobs with a timeout', async ({ page }: { page: Page }) => {
  const project = waitProjects.get(page)
  if (project === undefined) throw new Error('The wait-timer project was not created.')
  await startThreadWithModel(page, { project, model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(WAIT_DIRECTIVE)
  await composer.press('Enter')
})

Then('the wait tool card shows an accessible timeout progress bar', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'tool-meta-wait-tool-shows-timeout-progress', async () => {
    const progress = page.getByRole('progressbar', { name: /^Wait timeout countdown: \d+ s remaining of 12 s$/ })
    await expect(progress).toBeVisible({ timeout: 30_000 })
    const initial = Number(await progress.getAttribute('aria-valuenow'))
    await expect(async () => {
      expect(Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(initial)
    }).toPass({ timeout: 5_000 })
  })
  await page.screenshot({ path: WAIT_TIMER_SCREENSHOT })
  await finishJourneyAssertions(page)
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
  await page
    .getByRole('navigation', { name: 'Sidebar navigation' })
    .or(page.getByRole('navigation', { name: 'Global panels' }))
    .getByRole('button', { name: 'Plugins', exact: true })
    .first()
    .click()
  await page.getByRole('button', { name: 'View @dshfiles/tool-meta', exact: true }).click()
}

const saveAndReturnToThread = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(async () => {
    await page
      .getByRole('treeitem', { name: /^Fake thread title/ })
      .first()
      .click()
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
