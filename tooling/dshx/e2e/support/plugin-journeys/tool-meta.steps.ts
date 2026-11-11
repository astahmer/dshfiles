import { expect, type Page } from '@playwright/test'
import { access, mkdir, writeFile } from 'node:fs/promises'
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
const approvalWorkspaces = new WeakMap<Page, string>()
const READ_WINDOW_LINES = Array.from({ length: 30 }, (_, index) => `window line ${String(index + 1).padStart(2, '0')}`)
const FILE_TOOLS_DIRECTIVE = [
  `[[call read ${JSON.stringify({ file_path: 'window.txt', offset: 5, limit: 10 })}]]`,
  `[[call write ${JSON.stringify({ file_path: 'added.md', content: 'alpha\nbeta\ngamma\n' })}]]`,
].join('\n')
const APPROVAL_DIRECTIVE = `[[call bash ${JSON.stringify({
  command: 'rm -rf keep',
  description: 'Remove the kept folder',
  sandbox_permissions: 'danger-full-access',
  justification: 'Remove the kept folder outside the sandbox',
})}]]`

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

Then('the wait tool card names its target and shows an accessible timeout progress bar', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'tool-meta-wait-tool-names-target-and-shows-timeout-progress', async () => {
    await expect(page.getByText('Waiting for all running background jobs to settle', { exact: true })).toBeVisible({ timeout: 30_000 })
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

/** A settled turn folds its steps into one summary and its file calls into groups; reopen both until `target` shows. */
const revealSettled = async (page: Page, target: ReturnType<Page['locator']>): Promise<void> => {
  await expect(page.getByRole('status').filter({ hasText: /^(Completed|Failed)$/ })).toHaveCount(1, { timeout: 60_000 })
  await expect(async () => {
    if (await target.first().isVisible()) return
    const summary = page.getByText(/^Completed in /).last()
    if (await summary.isVisible()) await summary.click()
    for (const group of await page
      .locator('[aria-expanded="false"]')
      .filter({ hasText: /^(Read|Explored|Edited|Wrote|Created|Changed)\b/ })
      .all())
      if (await group.isVisible()) await group.click()
    await expect(target.first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

When('the fake model reads a window of one file and writes another in a fresh workspace', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-tool-meta-files-e2e-')
  const workspace = join(root, 'files-project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'window.txt'), `${READ_WINDOW_LINES.join('\n')}\n`)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'files-project', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(FILE_TOOLS_DIRECTIVE)
  await composer.press('Enter')
})

Then('the read card names the file and numbers the window from the requested offset', async ({ page }: { page: Page }) => {
  const open = page.getByRole('button', { name: 'Open window.txt', exact: true })
  await revealSettled(page, open)
  await recordAssertion(page, 'tool-meta-read-card-window', async () => {
    const row = page.locator('[data-chat-call-id]').filter({ has: open })
    await expect(row).toContainText('Showing 10 of 30 lines')
    // The tool-meta timing note sits over the row's right edge, so the card opens from its title.
    await row.getByText('Read', { exact: true }).click()
    await expect(row.getByText(/window line 05/)).toBeVisible()
    await expect(row.getByText(/window line 14/)).toBeVisible()
    await expect(row).not.toContainText('window line 04')
    await expect(row).not.toContainText('window line 15')
  })
})

Then('the write card shows the added lines as a collapsible diff', async ({ page }: { page: Page }) => {
  const totals = page.getByText('+3 −0', { exact: true })
  await revealSettled(page, totals)
  await recordAssertion(page, 'tool-meta-write-card-diff', async () => {
    const row = page.locator('[data-chat-call-id]').filter({ has: totals })
    await expect(row).toContainText('added.md')
    await expect(row.locator('[data-diff-path]')).toHaveCount(0)
    await row.getByText('Write', { exact: true }).click()
    await expect(row.locator('[data-diff-path]')).toHaveCount(1)
    await expect(row).toContainText('gamma')
  })
  await finishJourneyAssertions(page)
})

When('the fake model asks to run a deleting command with more access in a fresh workspace', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-tool-meta-approval-e2e-')
  const workspace = join(root, 'approval-project')
  await mkdir(join(workspace, 'keep'), { recursive: true })
  await writeFile(join(workspace, 'keep', 'marker.txt'), 'kept\n')
  approvalWorkspaces.set(page, workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'approval-project', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(APPROVAL_DIRECTIVE)
  await composer.press('Enter')
})

const approvalCard = (page: Page) => page.locator('[data-approval-card]')

Then('the approval card rates the command destructive and shows the tool, its reason and the command', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'tool-meta-approval-card-risk', async () => {
    await expect(approvalCard(page)).toBeVisible({ timeout: 30_000 })
    await expect(approvalCard(page).locator('[data-approval-risk="riskHigh"]')).toHaveText('Destructive')
    await expect(approvalCard(page).locator('code')).toHaveText('bash')
    await expect(approvalCard(page).locator('[data-approval-command]')).toHaveText('rm -rf keep')
    await expect(approvalCard(page)).toContainText(/Remove the kept folder outside the sandbox|bash asks to run with more access/)
    await expect(approvalCard(page).getByRole('button', { name: /^Allow once/ })).toBeVisible()
  })
})

When('the approval card is rejected with Escape', async ({ page }: { page: Page }) => {
  await approvalCard(page).getByRole('group', { name: 'Approval details: Enter allows once, Escape rejects', exact: true }).focus()
  await page.keyboard.press('Escape')
})

Then('the approval card is gone and the command never ran', async ({ page }: { page: Page }) => {
  const workspace = approvalWorkspaces.get(page)
  if (workspace === undefined) throw new Error('The approval workspace was not created.')
  await recordAssertion(page, 'tool-meta-approval-card-rejected', async () => {
    await expect(approvalCard(page)).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByRole('status').filter({ hasText: /^(Completed|Failed)$/ })).toHaveCount(1, { timeout: 60_000 })
    await access(join(workspace, 'keep', 'marker.txt'))
  })
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
