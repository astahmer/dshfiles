import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'

const feed = (page: Page) => page.getByRole('feed', { name: 'Backlog feed' })
const feedItems = (page: Page) => feed(page).getByRole('article', { name: /^Item b:/ })
const searchResults = (page: Page) => page.getByRole('list', { name: 'Search results' })
const row = (page: Page, title: string) => feedItems(page).filter({ hasText: title })
const peek = (page: Page) => page.getByRole('complementary', { name: 'Item detail' })
const statusChip = (page: Page, label: string) =>
  page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: new RegExp(`^${label},`) })
const showFeed = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Feed', exact: true }).click()
  await expect(feed(page)).toBeVisible()
}

When('the Backlog panel is opened', async ({ page }: { page: Page }) => {
  // A loaded machine can raise the provider-setup modal after the boot step stopped waiting; it hides the panel from role queries.
  await StartupDialogs.registerProviderSetupDismissal(page)
  await page.getByRole('button', { name: 'Backlog', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Capture', exact: true })).toBeVisible()
})

When('{string} is captured', async ({ page }: { page: Page }, text: string) => {
  const capture = page.getByRole('textbox', { name: 'Capture', exact: true })
  await capture.fill(text)
  await capture.press('Enter')
  await expect(capture).toHaveValue('')
  await StartupDialogs.dismissProviderSetupIfShown(page)
  await expect(feed(page)).toContainText(text.replace(/^\w+:\s*/, '').replace(/(\s+#[\w-]+)+$/, ''))
})

Then('the feed shows {string} as a bug in the inbox', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-capture-triage', async () => {
    const item = row(page, title)
    await expect(item).toBeVisible()
    await expect(item).toContainText('#composer')
    await item.click()
    await expect(peek(page).getByRole('button', { name: /^Kind of b:/ })).toContainText('Bug')
    await expect(peek(page).getByRole('button', { name: /^Status of b:/ })).toContainText('Inbox')
    await expect(feedItems(page).last()).toContainText('weekly digest of dormant items')
  })
})

When('the backlog is searched for {string}', async ({ page }: { page: Page }, query: string) => {
  await page.getByRole('textbox', { name: 'Search backlog', exact: true }).fill(query)
})

Then('the feed lists only {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-search', async () => {
    await expect(searchResults(page).getByRole('listitem', { name: /^Item b:/ })).toHaveCount(1)
    await expect(searchResults(page)).toContainText(title)
  })
  await finishJourneyAssertions(page)
})

When('item b:{int} is moved to In progress on the board', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await page
    .getByRole('article', { name: `Card b:${String(id)}` })
    .getByRole('button', { name: `Status of b:${String(id)}` })
    .click()
  await page.getByRole('menuitem', { name: 'In progress' }).click()
})

Then('the In progress column holds {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-board-move', async () => {
    await expect(page.getByRole('region', { name: 'In progress column' })).toContainText(title)
    await expect(page.getByRole('region', { name: 'Inbox column' })).not.toContainText(title)
  })
})

When('backlog item b:{int} is opened', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('button', { name: 'Feed', exact: true }).click()
  await feed(page)
    .getByRole('article', { name: `Item b:${String(id)}`, exact: true })
    .click()
  await expect(peek(page)).toContainText(`b:${String(id)}`)
})

Then('it is referenced by {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-backlinks', async () => {
    await expect(peek(page).getByRole('list', { name: 'Referenced by' })).toContainText(title)
  })
})

When('the backlink to b:{int} is followed', async ({ page }: { page: Page }, id: number) => {
  await peek(page)
    .getByRole('list', { name: 'Referenced by' })
    .getByRole('button', { name: new RegExp(`b:${String(id)}`) })
    .click()
})

Then('its activity records the move {string} by the user', async ({ page }: { page: Page }, move: string) => {
  await recordAssertion(page, 'backlog-activity-history', async () => {
    const activity = peek(page).getByRole('list', { name: 'Activity' })
    // Runs of same-actor changes fold into "made N changes" until opened.
    await activity.getByRole('button', { name: /made \d+ changes/ }).click()
    await expect(activity).toContainText(`moved it ${move}`)
  })
  await finishJourneyAssertions(page)
})

When('the feed is filtered by the {string} status', async ({ page }: { page: Page }, label: string) => {
  await showFeed(page)
  await statusChip(page, label).click()
})

When('the feed is also filtered by the {string} status', async ({ page }: { page: Page }, label: string) => {
  await statusChip(page, label).click()
})

When('the feed is shown', async ({ page }: { page: Page }) => {
  await showFeed(page)
})

When('the Items view is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Items', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Backlog items' })).toBeVisible()
})

Then('the Items view lists both {string} and {string}', async ({ page }: { page: Page }, first: string, second: string) => {
  await recordAssertion(page, 'backlog-status-items', async () => {
    const items = page.getByRole('table', { name: 'Backlog items' })
    await expect(statusChip(page, 'In progress')).toHaveAttribute('aria-pressed', 'true')
    await expect(statusChip(page, 'Inbox')).toHaveAttribute('aria-pressed', 'true')
    await expect(items.getByRole('row', { name: /^Item b:/ })).toHaveCount(2)
    await expect(items).toContainText(first)
    await expect(items).toContainText(second)
  })
})

Then('the feed narrows to {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-status-single', async () => {
    await expect(feedItems(page)).toHaveCount(1)
    await expect(feed(page)).toContainText(title)
  })
})

Then('the feed shows both {string} and {string}', async ({ page }: { page: Page }, first: string, second: string) => {
  await recordAssertion(page, 'backlog-status-multi', async () => {
    await expect(statusChip(page, 'In progress')).toHaveAttribute('aria-pressed', 'true')
    await expect(statusChip(page, 'Inbox')).toHaveAttribute('aria-pressed', 'true')
    await expect(feedItems(page)).toHaveCount(2)
    await expect(feed(page)).toContainText(first)
    await expect(feed(page)).toContainText(second)
  })
})

When('the {string} status filter is cleared', async ({ page }: { page: Page }, label: string) => {
  await statusChip(page, label).click()
})

Then('the feed narrows back to {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-status-cleared', async () => {
    await expect(statusChip(page, 'Inbox')).toHaveAttribute('aria-pressed', 'false')
    await expect(feedItems(page)).toHaveCount(1)
    await expect(feed(page)).toContainText(title)
  })
  await finishJourneyAssertions(page)
})
