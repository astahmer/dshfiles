import { cp, mkdir } from 'node:fs/promises'
import { openGlobalPanel } from '../plugin-view-names.js'
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
  await openGlobalPanel(page, 'Background Jobs: Jobs')
  // Phase 5: the Jobs board is the Jobs tab of Observe › Processes.
  await expect(page.getByRole('heading', { name: 'Processes', exact: true, level: 1 })).toBeVisible()
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
    // The full label is the row's code text; hover help is a kit Tooltip, not a native title.
    const label = await row.locator('code').textContent()
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

When('the Processes page is opened', async ({ page }: { page: Page }) => {
  await openJobs(page)
})

Then('its RAM tab shows the process memory that was its own page', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'background-jobs-processes-page-has-provider-tabs', async () => {
    await expect(page.getByRole('tab', { name: 'Jobs', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'RAM', exact: true }).click()
    await expect(page.locator('[data-ram-view="embedded"]')).toBeVisible()
    await expect(page.locator('[data-node-process-summary]')).toBeVisible({ timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

Then("the thread's Jobs facet lists only that thread's running job", async ({ page }: { page: Page }) => {
  const entry = page.locator('[data-sidebar-right-guide-entry]').filter({ hasText: /^Jobs/ }).first()
  if (!(await entry.isVisible())) await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await entry.click()
  const facet = page.locator('[data-thread-facet="jobs"]')
  await recordAssertion(page, 'background-jobs-thread-facet-lists-its-jobs', async () => {
    // Each batch job runs in its own thread; the facet follows the thread on stage, the second one.
    await expect.poll(() => facet.locator('[data-job-id]').count(), { timeout: 45_000 }).toBe(1)
    await expect(facet.locator('[data-job-id]').first()).toContainText(BATCH_COMMANDS[1] ?? '')
    await expect(facet.getByRole('button', { name: 'Stop', exact: true }).first()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const PREVIEWED_COMMAND = 'i=0; while [ "$i" -lt 180 ]; do echo "preview-tick-$i"; i=$((i + 1)); sleep 1; done'
// The turn ends right after the job starts, which folds the tool card; the dock is the seat that stays in view.
const jobPreview = (page: Page) => page.locator('[data-dshfiles-live-preview-seat="dock"]')

When('a thread starts a background job that keeps writing output', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-background-jobs-preview-')
  const workspace = join(root, 'job-preview-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'job-preview-project', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await expect(composer).toBeEnabled({ timeout: 45_000 })
  await composer.fill(`[[call bash ${JSON.stringify({ command: PREVIEWED_COMMAND, description: 'Keep writing output', run_in_background: true })}]]`)
  await composer.press('Enter')
})

Then('the composer dock previews the running job and streams its output', async ({ page }: { page: Page }) => {
  const preview = jobPreview(page)
  await recordAssertion(page, 'background-jobs-transcript-preview-streams', async () => {
    await expect(preview).toHaveAttribute('data-state', 'running', { timeout: 45_000 })
    await expect(preview.getByRole('status')).toContainText('running')
    const toggle = preview.getByRole('button', { name: /^Show or hide the live output of / })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(preview.getByText('Started by this thread', { exact: true })).toBeVisible()
    const output = preview.locator('[data-dshfiles-live-preview-output]')
    await expect(output).toContainText('preview-tick-', { timeout: 30_000 })
    const earlier = (await output.textContent()) ?? ''
    await expect.poll(async () => ((await output.textContent()) ?? '').length, { timeout: 30_000 }).toBeGreaterThan(earlier.length)
    // The same job also keeps its card under the tool call, inside the folded turn.
    await page.getByText(/^Completed in /).last().click()
    await page.getByText('Ran commands', { exact: true }).last().click()
    await expect(page.locator('[data-dshfiles-live-preview-seat="tool-card"]')).toHaveAttribute('data-state', 'running')
    const desktop = page.viewportSize()
    await page.setViewportSize({ width: 360, height: 780 })
    await expect(preview.getByRole('button', { name: 'Stop', exact: true })).toBeInViewport()
    expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    if (desktop !== null) await page.setViewportSize(desktop)
  })
})

Then('stopping the job from the preview takes a confirmation', async ({ page }: { page: Page }) => {
  const preview = jobPreview(page)
  await recordAssertion(page, 'background-jobs-transcript-preview-stop', async () => {
    await preview.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(preview).toHaveAttribute('data-state', 'running')
    await preview.getByRole('button', { name: 'Keep running', exact: true }).click()
    await expect(preview).toHaveAttribute('data-state', 'running')
    await preview.getByRole('button', { name: 'Stop', exact: true }).click()
    await preview.getByRole('button', { name: 'Confirm stop', exact: true }).click()
    await expect(preview).toHaveCount(0, { timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})
