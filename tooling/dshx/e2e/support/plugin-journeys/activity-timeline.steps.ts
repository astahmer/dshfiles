import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { sendMessage } from '../threads.js'

const feedRows = (page: Page) => page.getByRole('button', { name: /^(Agent|Communication|Integration|Workspace|System) .+ \d{2}:\d{2}:\d{2} / })
const rowTitles = async (page: Page): Promise<readonly string[]> =>
  (await feedRows(page).allInnerTexts()).map(text => text.split('\n')[1] ?? '').filter(title => title.length > 0)

const openActivity = async (page: Page): Promise<void> => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Activity', exact: true, level: 1 })).toBeVisible()
}

When('a thread runs a turn that fails for want of credentials', async ({ page }: { page: Page }) => {
  await sendMessage(page, 'activity timeline journey turn')
})

When('the Activity panel is opened', async ({ page }: { page: Page }) => {
  await openActivity(page)
  await expect(page.getByRole('button', { name: /Agent reported an error/ })).toBeVisible({ timeout: 30_000 })
})

Then('the feed lists the session events in order with their provenance', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'activity-timeline-feed-lists-session-events-in-order', async () => {
    const titles = await rowTitles(page)
    expect(titles.indexOf('Agent started work')).toBeGreaterThanOrEqual(0)
    expect(titles.indexOf('Agent started work')).toBeLessThan(titles.indexOf('Agent reported an error'))
    await expect(page.getByText(/^\d+ retained$/)).toBeVisible()
  })
  await page.getByRole('button', { name: /Agent reported an error/ }).click()
  await recordAssertion(page, 'activity-timeline-detail-shows-references-and-provenance', async () => {
    await expect(page.getByText('session.error', { exact: false }).first()).toBeVisible()
    await expect(page.getByText(/^session: session-/).first()).toBeVisible()
    await expect(page.getByText('Provenance: Observed', { exact: true })).toBeVisible()
  })
})

Then('search and the source filter narrow the feed, and it survives a reload', async ({ page }: { page: Page }) => {
  await page.getByRole('textbox', { name: 'Search activity', exact: true }).fill('started')
  await recordAssertion(page, 'activity-timeline-search-narrows-the-feed', () => expect.poll(() => rowTitles(page)).toEqual(['Agent started work']))
  await page.getByRole('textbox', { name: 'Search activity', exact: true }).fill('')
  await page.getByRole('button', { name: 'Communication', exact: true }).click()
  await recordAssertion(page, 'activity-timeline-source-filter-narrows-the-feed', async () => {
    await expect(feedRows(page)).toHaveCount(0)
    await expect(page.getByText('No activity matches this filter.', { exact: true })).toBeVisible()
  })
  await page.reload()
  await openActivity(page)
  await recordAssertion(page, 'activity-timeline-feed-is-durable', () => expect(page.getByRole('button', { name: /Agent reported an error/ })).toBeVisible())
  await finishJourneyAssertions(page)
})

Then('routine events stay condensed while the error stays visible on its own', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'activity-timeline-condensed-feed-hides-routine-state-changes', async () => {
    const titles = await rowTitles(page)
    expect(titles).toContain('Agent reported an error')
    expect(titles).not.toContain('Agent became running')
    expect(titles).not.toContain('Agent became idle')
  })
  await page.getByRole('button', { name: 'Detailed (no condensation)', exact: true }).click()
  await recordAssertion(page, 'activity-timeline-detailed-mode-expands-every-event', async () => {
    await expect.poll(() => rowTitles(page)).toContain('Agent became running')
    expect(await rowTitles(page)).toContain('Agent became idle')
    expect(await rowTitles(page)).toContain('Agent reported an error')
  })
  await page.getByRole('button', { name: 'Detailed (no condensation)', exact: true }).click()
  await page.getByRole('button', { name: 'Attention only', exact: true }).click()
  await recordAssertion(page, 'activity-timeline-attention-filter-keeps-only-the-error', () => expect.poll(() => rowTitles(page)).toEqual(['Agent reported an error']))
  await finishJourneyAssertions(page)
})
