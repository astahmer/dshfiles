import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { backlogLabel, withBacklogRefs } from './backlog-refs.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

/**
 * Journeys for the approved Backlog views (plans/backlog "Remaining"). Shared Backlog steps such as capture, opening
 * an item and the context-menu moves live in backlog.steps.ts; these steps only add what those views need.
 */

const REGISTERED_PROJECT = 'default-workspace'

const feed = (page: Page) => page.getByRole('feed', { name: 'Backlog feed' })
const peek = (page: Page) => page.getByRole('complementary', { name: 'Item detail' })
const searchInput = (page: Page) => page.getByRole('textbox', { name: 'Search backlog', exact: true })
const searchResults = (page: Page) => page.getByRole('list', { name: 'Search results' })
const capture = (page: Page) => page.getByRole('textbox', { name: 'Capture', exact: true })
const captureSuggestions = (page: Page) => page.getByRole('listbox', { name: 'Suggestions', exact: true })
const inbox = (page: Page) => page.getByRole('region', { name: 'Inbox', exact: true })
const inboxRow = async (page: Page, id: number) => inbox(page).getByRole('listitem', { name: `Item ${await backlogLabel(page, id)}`, exact: true })
const itemsTable = (page: Page) => page.getByRole('table', { name: 'Backlog items' })
const viewButton = (page: Page, name: string) => page.getByRole('navigation', { name: 'Backlog views' }).getByRole('button', { name, exact: true })

const showInboxFilter = async (page: Page, filter: string): Promise<void> => {
  const tab = inbox(page).getByRole('tab', { name: new RegExp(`^${filter}`) })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

Then('the feed shows one {string} separator above both entries', async ({ page }: { page: Page }, label: string) => {
  await recordAssertion(page, 'backlog-feed-day-separator', async () => {
    const separators = feed(page).getByRole('separator')
    await expect(separators).toHaveCount(1)
    await expect(separators).toHaveText(label)
    const order = await feed(page).evaluate(element =>
      [...element.querySelectorAll('[role="separator"], article[aria-label^="Item b:"]')].map(
        node => node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '',
      ),
    )
    expect(order).toEqual([label, await withBacklogRefs(page, 'Item b:1'), await withBacklogRefs(page, 'Item b:2')])
  })
  await finishJourneyAssertions(page)
})

Then(
  'the Inbox {string} filter lists b:{int} and b:{int} but not b:{int}',
  async ({ page }: { page: Page }, filter: string, first: number, second: number, absent: number) => {
    await recordAssertion(page, 'backlog-inbox-filter-all', async () => {
      await showInboxFilter(page, filter)
      await expect(await inboxRow(page, first)).toBeVisible()
      await expect(await inboxRow(page, second)).toBeVisible()
      await expect(await inboxRow(page, absent)).toHaveCount(0)
    })
  },
)

Then('the Inbox {string} filter lists b:{int} and b:{int}', async ({ page }: { page: Page }, filter: string, first: number, second: number) => {
  await recordAssertion(page, 'backlog-inbox-filter-suggestions', async () => {
    await showInboxFilter(page, filter)
    await expect(await inboxRow(page, first)).toBeVisible({ timeout: 30_000 })
    await expect(await inboxRow(page, second)).toBeVisible({ timeout: 30_000 })
  })
})

Then('the Inbox {string} filter lists only b:{int}', async ({ page }: { page: Page }, filter: string, id: number) => {
  await recordAssertion(page, `backlog-inbox-filter-${filter.toLowerCase().replaceAll(' ', '-')}`, async () => {
    await showInboxFilter(page, filter)
    await expect(inbox(page).getByRole('listitem', { name: /^Item b:/ })).toHaveCount(1)
    await expect(await inboxRow(page, id)).toBeVisible()
  })
})

When('Inbox item b:{int} is opened from the {string} filter', async ({ page }: { page: Page }, id: number, filter: string) => {
  await showInboxFilter(page, filter)
  await expect((await inboxRow(page, id)).getByLabel('Unread', { exact: true })).toBeVisible()
  await (await inboxRow(page, id)).click({ position: { x: 60, y: 12 } })
  await expect(peek(page)).toContainText(`${await backlogLabel(page, id)}`)
})

Then('Inbox item b:{int} is no longer unread', async ({ page }: { page: Page }, id: number) => {
  await recordAssertion(page, 'backlog-inbox-acknowledged', async () => {
    await expect((await inboxRow(page, id)).getByLabel('Unread', { exact: true })).toHaveCount(0)
    // Read is not done: the request stays listed until its attention is cleared.
    await expect(await inboxRow(page, id)).toBeVisible()
  })
})

When('Inbox item b:{int} is resolved', async ({ page }: { page: Page }, id: number) => {
  await showInboxFilter(page, 'Blocked')
  await (await inboxRow(page, id)).hover()
  await (await inboxRow(page, id)).getByRole('button', { name: 'Resolve', exact: true }).click()
})

Then('the Inbox {string} filter is empty', async ({ page }: { page: Page }, filter: string) => {
  await recordAssertion(page, 'backlog-inbox-resolved', async () => {
    await showInboxFilter(page, filter)
    await expect(inbox(page).getByRole('listitem', { name: /^Item b:/ })).toHaveCount(0)
    await expect(inbox(page)).toContainText('Nothing needs you')
  })
  await finishJourneyAssertions(page)
})

When('the Items view is grouped by {string}', async ({ page }: { page: Page }, label: string) => {
  await page.getByRole('button', { name: /^Group:/ }).click()
  await page.getByRole('menuitemradio', { name: label, exact: true }).click()
  await expect(page.getByRole('button', { name: /^Group:/ })).toContainText(label)
})

Then('the Items view shows a {string} group and an {string} group', async ({ page }: { page: Page }, first: string, second: string) => {
  await recordAssertion(page, 'backlog-items-grouped', async () => {
    const groups = itemsTable(page).getByRole('rowgroup')
    await expect(groups.filter({ hasText: first })).toHaveCount(1)
    await expect(groups.filter({ hasText: second })).toHaveCount(1)
  })
})

When('the {string} group is collapsed', async ({ page }: { page: Page }, key: string) => {
  const toggle = itemsTable(page).getByRole('button', { name: `Toggle ${key}`, exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

Then('the Items view hides {string} and keeps {string}', async ({ page }: { page: Page }, hidden: string, kept: string) => {
  await recordAssertion(page, 'backlog-items-group-collapsed', async () => {
    await expect(
      itemsTable(page)
        .getByRole('row', { name: /^Item b:/ })
        .filter({ hasText: hidden }),
    ).toHaveCount(0)
    await expect(
      itemsTable(page)
        .getByRole('row', { name: /^Item b:/ })
        .filter({ hasText: kept }),
    ).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

When('the Projects view is opened', async ({ page }: { page: Page }) => {
  await viewButton(page, 'Projects').click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
})

const projectCard = (page: Page) => page.getByRole('button').filter({ hasText: REGISTERED_PROJECT }).filter({ hasText: /done/ })

Then('the project card for the registered project counts {int} of {int} done', async ({ page }: { page: Page }, done: number, total: number) => {
  await recordAssertion(page, 'backlog-projects-card', async () => {
    await expect(projectCard(page)).toContainText(`${String(done)} of ${String(total)} done`)
  })
})

When('the registered project is opened from Projects', async ({ page }: { page: Page }) => {
  await projectCard(page).click()
  await expect(page.getByRole('button', { name: 'All projects', exact: true })).toBeVisible()
})

Then('the project page lists {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-project-page-items', async () => {
    await expect(
      page
        .getByRole('listitem', { name: /^Item b:/ })
        .filter({ hasText: title })
        .first(),
    ).toBeVisible()
  })
})

When('the project page goes back to all projects', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'All projects', exact: true }).click()
})

Then('the Projects overview is shown', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-projects-overview', async () => {
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await expect(projectCard(page)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const agentItemsToggle = (page: Page) => page.getByRole('button', { name: 'Hide agent items', exact: true })

Then('the Backlog hides agent items and the feed shows {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-hide-agent-items-default', async () => {
    await expect(agentItemsToggle(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(feed(page)).toContainText(title)
  })
})

When('agent items are shown in the Backlog', async ({ page }: { page: Page }) => {
  await agentItemsToggle(page).click()
})

Then('the Backlog shows agent items', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-hide-agent-items-off', async () => {
    await expect(agentItemsToggle(page)).toHaveAttribute('aria-pressed', 'false')
  })
})

Then('the Backlog hides agent items', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-hide-agent-items-per-view', async () => {
    await expect(agentItemsToggle(page)).toHaveAttribute('aria-pressed', 'true')
  })
})

When('the Backlog Feed view is opened again', async ({ page }: { page: Page }) => {
  await viewButton(page, 'Feed').click()
  await expect(viewButton(page, 'Feed')).toHaveAttribute('aria-current', 'page')
})

Then('the Feed still shows agent items', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-hide-agent-items-remembered', async () => {
    await expect(agentItemsToggle(page)).toHaveAttribute('aria-pressed', 'false')
  })
  await finishJourneyAssertions(page)
})

const search = async (page: Page, query: string): Promise<void> => {
  await searchInput(page).fill(query)
  await searchInput(page).press('Enter')
  await expect(searchResults(page)).toBeVisible()
}

Then('searching {string} lists {int} results', async ({ page }: { page: Page }, query: string, count: number) => {
  await recordAssertion(page, 'backlog-search-operators-all', async () => {
    await search(page, query)
    await expect(searchResults(page).getByRole('listitem', { name: /^Item b:/ })).toHaveCount(count)
  })
})

Then('searching {string} lists only {string}', async ({ page }: { page: Page }, query: string, title: string) => {
  await recordAssertion(page, `backlog-search-operator-${query.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase()}`, async () => {
    await search(page, await withBacklogRefs(page, query))
    await expect(searchResults(page).getByRole('listitem', { name: /^Item b:/ })).toHaveCount(1)
    await expect(searchResults(page)).toContainText(title)
  })
  if (query === 'b:3') await finishJourneyAssertions(page)
})

When('the current search is saved as the Backlog view {string}', async ({ page }: { page: Page }, name: string) => {
  await page.getByRole('button', { name: 'Saved views', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'View name', exact: true })
  await field.fill(name)
  await field.press('Enter')
  await expect(page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible()
  await page.keyboard.press('Escape')
})

When('the Board view is opened after clearing the search', async ({ page }: { page: Page }) => {
  await searchInput(page).fill('')
  await viewButton(page, 'Board').click()
  await expect(page.locator('[data-backlog-column]')).not.toHaveCount(0)
})

When('the saved Backlog view {string} is applied', async ({ page }: { page: Page }, name: string) => {
  await page.getByRole('button', { name: 'Saved views', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
  await expect(searchInput(page)).toHaveValue('alpha')
})

Then('the saved view reopens the Feed filtered to {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-saved-view-applied', async () => {
    // A saved view reopens the view it was saved from and keeps its query as a filter there, not as a results list.
    await expect(viewButton(page, 'Feed')).toHaveAttribute('aria-current', 'page')
    await expect(feed(page).getByRole('article', { name: /^Item b:/ })).toHaveCount(1)
    await expect(feed(page)).toContainText(title)
  })
})

When('the saved Backlog view {string} is deleted', async ({ page }: { page: Page }, name: string) => {
  await page.getByRole('button', { name: 'Saved views', exact: true }).click()
  const deleteButton = page.getByRole('button', { name: `Delete view ${name}`, exact: true })
  await deleteButton.hover()
  await deleteButton.click()
})

Then('no saved views are listed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-saved-view-deleted', async () => {
    await expect(page.getByRole('dialog')).toContainText('No saved views yet')
  })
  await finishJourneyAssertions(page)
})

When('{string} is typed in the capture box', async ({ page }: { page: Page }, text: string) => {
  await capture(page).click()
  await capture(page).pressSequentially(text)
})

Then('the capture suggestions offer {string}', async ({ page }: { page: Page }, label: string) => {
  await recordAssertion(page, `backlog-capture-suggestion-${label.startsWith('#') ? 'tag' : 'item'}`, async () => {
    await expect(captureSuggestions(page).getByRole('option').filter({ hasText: label }).first()).toBeVisible()
  })
})

When('the capture suggestion {string} is picked', async ({ page }: { page: Page }, label: string) => {
  await captureSuggestions(page).getByRole('option').filter({ hasText: label }).first().click()
  await expect(captureSuggestions(page)).toHaveCount(0)
})

When('the capture is sent', async ({ page }: { page: Page }) => {
  await capture(page).press('Enter')
})

Then('backlog item b:{int} is referenced by {string}', async ({ page }: { page: Page }, id: number, journeyTitle: string) => {
  await recordAssertion(page, 'backlog-capture-autocomplete-sent', async () => {
    const title = await withBacklogRefs(page, journeyTitle)
    await expect(feed(page)).toContainText(title)
    await feed(page)
      .getByRole('article', { name: `Item ${await backlogLabel(page, id)}`, exact: true })
      .getByText(`${await backlogLabel(page, id)}`, { exact: true })
      .click()
    await expect(peek(page).getByRole('list', { name: 'Referenced by' })).toContainText(title)
  })
  await finishJourneyAssertions(page)
})

const failedCaptures = new WeakMap<Page, string>()

When('the next capture of {string} fails on the Host', async ({ page }: { page: Page }, text: string) => {
  failedCaptures.set(page, text)
  // The Backlog API call is an HTTP POST; refuse the first one that carries this text, once.
  await page.route(
    () => true,
    async route => {
      const request = route.request()
      if (request.method() !== 'POST' || !(request.postData() ?? '').includes(text) || failedCaptures.get(page) !== text) return route.fallback()
      failedCaptures.delete(page)
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Backlog store unavailable in this journey' })
    },
    { times: 50 },
  )
})

Then('the capture box keeps {string} and offers Retry', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'backlog-capture-failed-restored', async () => {
    const alert = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Retry' }) })
    await expect(alert).toBeVisible()
    await expect(capture(page)).toHaveText(text)
    await expect(feed(page).getByRole('article', { name: /^Item b:/ })).toHaveCount(0)
  })
})

When('the capture is retried', async ({ page }: { page: Page }) => {
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
})

Then('the feed shows {string} without a capture error', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'backlog-capture-retried', async () => {
    await expect(feed(page).getByRole('article', { name: await withBacklogRefs(page, 'Item b:1'), exact: true })).toContainText(text)
    await expect(page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Retry' }) })).toHaveCount(0)
    await expect(capture(page)).toHaveText('')
  })
  await finishJourneyAssertions(page)
})

When('the {string} of b:{int} is set to {string} in the inspector', async ({ page }: { page: Page }, field: string, id: number, value: string) => {
  await peek(page)
    .getByRole('button', { name: `${field} of ${await backlogLabel(page, id)}`, exact: true })
    .click()
  await page.getByRole('menuitem', { name: new RegExp(`^${value}`) }).click()
  await expect(peek(page).getByRole('button', { name: `${field} of ${await backlogLabel(page, id)}`, exact: true })).toContainText(value)
})

Then('the inspector shows b:{int} as a {string} in {string}', async ({ page }: { page: Page }, id: number, kind: string, status: string) => {
  await recordAssertion(page, 'backlog-inspector-pickers', async () => {
    await expect(peek(page).getByRole('button', { name: `Kind of ${await backlogLabel(page, id)}`, exact: true })).toContainText(kind)
    await expect(peek(page).getByRole('button', { name: `Status of ${await backlogLabel(page, id)}`, exact: true })).toContainText(status)
  })
})

When('the link {string} is added in the inspector', async ({ page }: { page: Page }, target: string) => {
  await peek(page).getByRole('button', { name: 'Add link', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'Link target', exact: true })
  await field.fill(target)
  await field.press('Enter')
})

Then('the inspector lists the link {string}', async ({ page }: { page: Page }, label: string) => {
  await recordAssertion(page, 'backlog-inspector-link-added', async () => {
    await expect(peek(page).getByRole('listitem').filter({ hasText: label })).toBeVisible()
  })
})

When('the link {string} is removed in the inspector', async ({ page }: { page: Page }, target: string) => {
  const unlink = peek(page).getByRole('button', { name: `Unlink url ${target}`, exact: true })
  await unlink.hover()
  await unlink.click()
})

Then('the inspector no longer lists the link {string}', async ({ page }: { page: Page }, label: string) => {
  await recordAssertion(page, 'backlog-inspector-link-removed', async () => {
    await expect(peek(page).getByRole('listitem').filter({ hasText: label })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

const suggestionMarker = (title: string, duplicateOf?: number): string =>
  `[[answer {"confidence":0.3,"title":"${title}"${duplicateOf === undefined ? '' : `,"duplicateOf":${String(duplicateOf)}`}}]]`

const captureSuggestion = async (page: Page, marker: string): Promise<void> => {
  // Below the default 0.8 apply threshold, so the suggestion waits on the item instead of applying.
  await capture(page).fill(marker)
  await capture(page).press('Enter')
  await expect(capture(page)).toHaveText('')
}

When('a low-confidence fake triage suggestion titled {string} is captured', async ({ page }: { page: Page }, title: string) => {
  await captureSuggestion(page, suggestionMarker(title))
})

When(
  'a low-confidence fake triage suggestion titled {string} naming b:{int} as its duplicate is captured',
  async ({ page }: { page: Page }, title: string, duplicate: number) => {
    // The model names a duplicate by the number it was shown, a journey's capture ordinal. Triage only shows it items
    // whose titles share two words with the new one, so the suggested title repeats the duplicate's.
    await captureSuggestion(page, suggestionMarker(title, duplicate))
  },
)

const openFromSuggestions = async (page: Page, id: number): Promise<void> => {
  await showInboxFilter(page, 'Suggestions')
  await (await inboxRow(page, id)).click({ position: { x: 60, y: 12 } })
  await expect(peek(page).getByRole('region', { name: 'Triage suggestion', exact: true })).toBeVisible()
}

When('the triage suggestion on b:{int} is opened', async ({ page }: { page: Page }, id: number) => {
  await showInboxFilter(page, 'Suggestions')
  await expect(await inboxRow(page, id)).toBeVisible({ timeout: 30_000 })
  await openFromSuggestions(page, id)
})

Then('the {string} previews b:{int} titled {string}', async ({ page }: { page: Page }, place: string, ordinal: number, title: string) => {
  await recordAssertion(page, `backlog-duplicate-preview-${place.toLowerCase().replaceAll(' ', '-')}`, async () => {
    const label = await backlogLabel(page, ordinal)
    const link = peek(page)
      .getByLabel(place, { exact: true })
      .getByRole('button', { name: `Preview backlog item ${label}`, exact: true })
    const preview = page.locator('[data-dshfiles-backlog-preview]')
    // The card may already be open from another link, so the link must become the card's anchor: that proves this
    // link opened it. A scroll closes the card by design, so ask again rather than read a card the page took away.
    await expect(async () => {
      await link.click()
      await expect(link).toHaveAttribute('data-dshfiles-entity-anchor', /.+/u, { timeout: 1_500 })
      await expect(preview.getByRole('heading', { name: `Backlog · ${label}`, exact: true })).toBeVisible({ timeout: 1_500 })
      await expect(preview).toContainText(title, { timeout: 1_500 })
    }).toPass({ timeout: 30_000 })
  })
})

When('the triage suggestion on b:{int} is accepted', async ({ page }: { page: Page }, id: number) => {
  await openFromSuggestions(page, id)
  await peek(page).getByRole('region', { name: 'Triage suggestion', exact: true }).getByRole('button', { name: 'Accept', exact: true }).click()
})

When('the triage suggestion on b:{int} is dismissed', async ({ page }: { page: Page }, id: number) => {
  await openFromSuggestions(page, id)
  await peek(page).getByRole('region', { name: 'Triage suggestion', exact: true }).getByRole('button', { name: 'Dismiss', exact: true }).click()
})

Then('backlog item b:{int} is titled {string} without a suggestion', async ({ page }: { page: Page }, id: number, title: string) => {
  await recordAssertion(page, 'backlog-proposal-accepted', async () => {
    await expect(peek(page)).toContainText(title)
    await expect(peek(page).getByRole('region', { name: 'Triage suggestion', exact: true })).toHaveCount(0)
    await showInboxFilter(page, 'Suggestions')
    await expect(await inboxRow(page, id)).toHaveCount(0)
  })
})

Then('backlog item b:{int} keeps its title without a suggestion', async ({ page }: { page: Page }, id: number) => {
  await recordAssertion(page, 'backlog-proposal-dismissed', async () => {
    await expect(peek(page).getByRole('region', { name: 'Triage suggestion', exact: true })).toHaveCount(0)
    const activity = peek(page).getByRole('list', { name: 'Conversation' })
    // The system's suggestion sits in the work log, so the capture and the dismissal fold into one run of the user's changes.
    await activity.getByRole('button', { name: /made \d+ changes/u }).click()
    await expect(activity).toContainText('dismissed a suggestion')
    await expect(activity).not.toContainText('applied')
    await showInboxFilter(page, 'Suggestions')
    await expect(await inboxRow(page, id)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
