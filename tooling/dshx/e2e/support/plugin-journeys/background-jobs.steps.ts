import { cp, mkdir } from 'node:fs/promises'
import { globalPanelLink } from '../plugin-view-names.js'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const FIXTURE_SESSIONS = fileURLToPath(new URL('../../../../../plugins/@dshfiles/background-jobs/fixtures/sessions', import.meta.url))

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const WIRE_BOUND = 2_000
/** A running command whose registered label is longer than the row schema allows. */
const OVERSIZED_COMMAND = `sleep 120; echo ${'oversized-label-'.repeat(160)}`
const OVERSIZED_DIRECTIVE = `[[call bash ${JSON.stringify({ command: OVERSIZED_COMMAND, description: 'Hold one live job with an oversized label' })}]]`

/** Every seeded label carries the fixture working directory, so unrelated live jobs never enter the assertions. */
const fixtureRows = (page: Page) => page.locator('[data-job-id]').filter({ hasText: '/fixture' })

const openJobs = async (page: Page): Promise<void> => {
  await globalPanelLink(page, 'Background Jobs: Jobs').click()
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true, level: 1 })).toBeVisible()
}

When('recorded background jobs are seeded into the sessions root', async ({ page }: { page: Page }) => {
  const home = profileFor(page).homeRoot
  await mkdir(join(home, 'sessions'), { recursive: true })
  await cp(FIXTURE_SESSIONS, join(home, 'sessions'), { recursive: true })
})

When('the Jobs panel is opened', async ({ page }: { page: Page }) => {
  await openJobs(page)
  await page.getByRole('radio', { name: 'All', exact: true }).click()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect.poll(() => fixtureRows(page).count(), { timeout: 45_000 }).toBe(5)
})

Then('the board lists the recorded jobs with their categories and statuses', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'background-jobs-board-lists-recorded-jobs-by-category', async () => {
    const tests = fixtureRows(page).filter({ hasText: 'pnpm check:e2e jj-integration' })
    await expect(tests).toHaveCount(1)
    await expect(tests).toContainText('Tests & checks')
    await expect(tests).toContainText('completed')

    const vcs = fixtureRows(page).filter({ hasText: 'jj log -r main' })
    await expect(vcs).toContainText('jj & git')

    const build = fixtureRows(page).filter({ hasText: 'pnpm --filter @dshfiles/dshx build' })
    await expect(build).toContainText('Build')
    await expect(build).toContainText('failed')
    await expect(build).toContainText('exit code: 1')
  })

  await recordAssertion(page, 'background-jobs-board-shows-an-interrupted-record', async () => {
    const unsettled = fixtureRows(page).filter({ hasText: 'sleep 600' })
    await expect(unsettled).toHaveCount(1)
    await expect(unsettled).toContainText('interrupted')
    await expect(unsettled).toContainText('Process & network')
  })
})

When('a thread starts a running bash job whose label exceeds the wire bound', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-background-jobs-e2e-')
  const workspace = join(root, 'oversized-label-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'oversized-label-project', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(OVERSIZED_DIRECTIVE)
  await composer.press('Enter')
  await expect(page.locator('[data-chat-call-id]').first()).toBeVisible({ timeout: 45_000 })
})

Then('the board shows that job with its label clamped to the bound', async ({ page }: { page: Page }) => {
  await openJobs(page)
  await page.getByRole('radio', { name: 'Running', exact: true }).click()
  await recordAssertion(page, 'background-jobs-clamps-an-oversized-live-label', async () => {
    const row = page.locator('[data-job-id]').filter({ hasText: 'oversized-label' }).first()
    await expect(row).toBeVisible({ timeout: 45_000 })
    const label = await row.locator('code').getAttribute('title')
    expect(label?.startsWith('sleep 120;')).toBe(true)
    expect((label ?? '').length).toBeLessThanOrEqual(WIRE_BOUND)
    await expect(page.getByRole('alert').filter({ hasText: 'API schema validation failed' })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

/**
 * Two live commands whose labels share one marker, so the Running scope can select both without touching other jobs.
 * Bash tool calls in one turn run one after another, so each long command needs its own thread to stay running.
 */
const BATCH_COMMANDS = ['sleep 180; echo batch-stop-one', 'sleep 180; echo batch-stop-two'] as const

When('a thread starts two running bash jobs', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-background-jobs-batch-')
  const workspace = join(root, 'batch-stop-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  for (const [index, command] of BATCH_COMMANDS.entries()) {
    await startThreadWithModel(page, { project: 'batch-stop-project', model: 'commandcode_work/gpt-6-luna' })
    const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
    await expect(composer).toBeEnabled({ timeout: 45_000 })
    await composer.fill(`[[call bash ${JSON.stringify({ command, description: `Batch stop ${String(index + 1)}` })}]]`)
    await composer.press('Enter')
    await expect(page.locator('[data-chat-call-id]').first()).toBeVisible({ timeout: 45_000 })
  }
})

When('the Jobs panel lists both batch jobs in the Running scope', async ({ page }: { page: Page }) => {
  await openJobs(page)
  await page.getByRole('radio', { name: 'Running', exact: true }).click()
  await expect(page.locator('[data-job-id]').filter({ hasText: 'batch-stop' })).toHaveCount(2, { timeout: 45_000 })
})

Then('selecting both jobs and stopping them through confirmation clears the Running scope', async ({ page }: { page: Page }) => {
  const rows = page.locator('[data-job-id]').filter({ hasText: 'batch-stop' })
  await rows.nth(0).getByRole('checkbox').check()
  await rows.nth(1).getByRole('checkbox').check()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop selected', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Stop 2 running jobs?')
  await dialog.getByRole('button', { name: 'Stop 2 jobs', exact: true }).click()
  await recordAssertion(page, 'background-jobs-batch-stop-clears-running', async () => {
    await expect.poll(async () => rows.count(), { timeout: 45_000 }).toBe(0)
  })
  await finishJourneyAssertions(page)
})

Then('the category filter, the scope and the search narrow the board', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'background-jobs-category-filter-narrows-the-board', async () => {
    await page.getByRole('button', { name: /^jj & git \d+$/ }).click()
    await expect.poll(() => fixtureRows(page).count()).toBe(1)
    await expect(fixtureRows(page)).toContainText('jj log -r main')
    await page.getByRole('button', { name: 'All categories', exact: true }).click()
  })

  await recordAssertion(page, 'background-jobs-finished-scope-excludes-interrupted-records', async () => {
    await page.getByRole('radio', { name: 'Finished', exact: true }).click()
    await expect.poll(() => fixtureRows(page).count()).toBe(4)
    await expect(fixtureRows(page).filter({ hasText: 'sleep 600' })).toHaveCount(0)
  })

  await recordAssertion(page, 'background-jobs-search-narrows-the-board', async () => {
    await page.getByRole('textbox', { name: 'Search jobs', exact: true }).fill('grep -rn')
    await expect.poll(() => fixtureRows(page).count()).toBe(1)
    await expect(fixtureRows(page)).toContainText('grep -rn')
  })

  await page.reload()
  await openJobs(page)
  await page.getByRole('radio', { name: 'All', exact: true }).click()
  await recordAssertion(page, 'background-jobs-index-survives-a-reload', () => expect.poll(() => fixtureRows(page).count(), { timeout: 30_000 }).toBe(5))
  await finishJourneyAssertions(page)
})
