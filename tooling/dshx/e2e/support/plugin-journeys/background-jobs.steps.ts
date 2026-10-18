import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'

const FIXTURE_SESSIONS = fileURLToPath(new URL('../../../../../plugins/@dshfiles/background-jobs/fixtures/sessions', import.meta.url))

/** Every seeded label carries the fixture working directory, so unrelated live jobs never enter the assertions. */
const fixtureRows = (page: Page) => page.locator('[data-job-id]').filter({ hasText: '/fixture' })

const openJobs = async (page: Page): Promise<void> => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Jobs', exact: true }).click()
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
