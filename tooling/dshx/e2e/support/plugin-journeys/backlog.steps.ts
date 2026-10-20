import { expect, type Locator, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'

const feed = (page: Page) => page.getByRole('feed', { name: 'Backlog feed' })
const feedItems = (page: Page) => feed(page).getByRole('article', { name: /^Item b:/ })
const searchResults = (page: Page) => page.getByRole('list', { name: 'Search results' })
const row = (page: Page, title: string) => feedItems(page).filter({ hasText: title })
const peek = (page: Page) => page.getByRole('complementary', { name: 'Item detail' })
const statusChip = (page: Page, label: string) => page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: new RegExp(`^${label},`) })
const showFeed = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Feed', exact: true }).click()
  await expect(feed(page)).toBeVisible()
}

const contextTarget = async (page: Page, id: number, view: string): Promise<Locator> => {
  const itemName = `Item b:${String(id)}`
  if (view === 'feed') {
    await page.getByRole('textbox', { name: 'Search backlog', exact: true }).fill('')
    await showFeed(page)
    return feed(page).getByRole('article', { name: itemName, exact: true })
  }
  if (view === 'items') {
    await page.getByRole('textbox', { name: 'Search backlog', exact: true }).fill('')
    await page.getByRole('button', { name: 'Items', exact: true }).click()
    return page.getByRole('row', { name: itemName, exact: true })
  }
  if (view === 'board') {
    await page.getByRole('textbox', { name: 'Search backlog', exact: true }).fill('')
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    return page.getByRole('article', { name: `Card b:${String(id)}`, exact: true })
  }
  if (view === 'search') {
    await page.getByRole('textbox', { name: 'Search backlog', exact: true }).fill(`b:${String(id)}`)
    return searchResults(page).getByRole('listitem', { name: itemName, exact: true })
  }
  if (view === 'inbox') {
    await page.getByRole('textbox', { name: 'Search backlog', exact: true }).fill('')
    await page
      .getByRole('navigation', { name: 'Backlog views' })
      .getByRole('button', { name: /^Inbox\b/ })
      .click()
    return page.getByRole('listitem', { name: itemName, exact: true })
  }
  if (view === 'projects') {
    await page.getByRole('textbox', { name: 'Search backlog', exact: true }).fill('')
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await page.getByRole('button', { name: /No project/ }).click()
    return page.getByRole('listitem', { name: itemName, exact: true }).first()
  }
  if (view === 'details') {
    await page.getByRole('textbox', { name: 'Search backlog', exact: true }).fill('')
    await showFeed(page)
    await feed(page)
      .getByRole('article', { name: itemName, exact: true })
      .click({ position: { x: 8, y: 8 } })
    await expect(peek(page)).toBeVisible()
    return peek(page).getByRole('textbox', { name: 'Title', exact: true })
  }
  throw new Error(`Unknown backlog item view: ${view}`)
}

const contextMenu = (page: Page) => page.getByRole('menu')

const expectItemActions = async (page: Page, includeOpenItem: boolean): Promise<void> => {
  const menu = contextMenu(page)
  await expect(menu.getByRole('menuitem', { name: 'Start thread…', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Status', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Kind', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Attention', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Project', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^(Unpin item|Pin item)$/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Run triage', exact: true })).toBeVisible()
  if (includeOpenItem) await expect(menu.getByRole('menuitem', { name: 'Open item', exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Project', exact: true }).hover()
  await expect(page.getByRole('menu').last().getByRole('menuitemradio', { name: 'No project', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
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

Then('the board columns follow the status order through Dropped', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-board-status-order', async () => {
    const statuses = await page.locator('[data-backlog-column]').evaluateAll(columns =>
      columns.map(column => column.getAttribute('data-backlog-column')),
    )
    expect(statuses).toEqual(['inbox', 'todo', 'doing', 'done', 'dropped'])
  })
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
    .getByText(`b:${String(id)}`, { exact: true })
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

const startThreadDialog = (page: Page) => page.getByRole('dialog', { name: 'Start thread', exact: true })
const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'
const NEW_THREAD_COMPOSER = 'Describe what you want to build, / commands, @ files or sessions'
const FAKE_MODEL = 'commandcode_work/gpt-6-luna'

When('backlog card b:{int} is expanded', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  const card = page.getByRole('article', { name: `Card b:${String(id)}` })
  await card.click()
  await expect(card).toHaveAttribute('aria-expanded', 'true')
})

When('the Start button on backlog card b:{int} is clicked', async ({ page }: { page: Page }, id: number) => {
  const card = page.getByRole('article', { name: `Card b:${String(id)}` })
  await expect(card.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Open', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Start', exact: true }).click()
})

When('backlog item b:{int} is right-clicked for a thread', async ({ page }: { page: Page }, id: number) => {
  await feed(page)
    .getByRole('article', { name: `Item b:${String(id)}`, exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Start thread…', exact: true }).click()
})

Then('backlog item b:{int} exposes all context actions in the {string} view', async ({ page }: { page: Page }, id: number, view: string) => {
  await recordAssertion(page, `backlog-item-actions-${view}`, async () => {
    const target = await contextTarget(page, id, view)
    await expect(target).toBeVisible()
    await target.click({ button: 'right' })
    await expect(contextMenu(page)).toBeVisible()
    await expectItemActions(page, view !== 'details')
    await page.keyboard.press('Escape')
  })
  if (view === 'details') await finishJourneyAssertions(page)
})

When('backlog item b:{int} is moved to {string} from its feed context menu', async ({ page }: { page: Page }, id: number, status: string) => {
  const target = await contextTarget(page, id, 'feed')
  await target.click({ button: 'right' })
  await contextMenu(page).getByRole('menuitem', { name: 'Status', exact: true }).hover()
  await page.getByRole('menu').last().getByRole('menuitemradio', { name: status, exact: true }).click()
  await target.click({ button: 'right' })
  await contextMenu(page).getByRole('menuitem', { name: 'Status', exact: true }).hover()
  await expect(page.getByRole('menu').last().getByRole('menuitemradio', { name: status, exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
})

When('backlog item b:{int} is marked {string} from its feed context menu', async ({ page }: { page: Page }, id: number, attention: string) => {
  const target = await contextTarget(page, id, 'feed')
  await target.click({ button: 'right' })
  await contextMenu(page).getByRole('menuitem', { name: 'Attention', exact: true }).hover()
  await page.getByRole('menu').last().getByRole('menuitemradio', { name: attention, exact: true }).click()
  await target.click({ button: 'right' })
  await contextMenu(page).getByRole('menuitem', { name: 'Attention', exact: true }).hover()
  await expect(page.getByRole('menu').last().getByRole('menuitemradio', { name: attention, exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
})

When('backlog item b:{int} is assigned to a registered project from its feed context menu', async ({ page }: { page: Page }, id: number) => {
  const target = await contextTarget(page, id, 'feed')
  await target.click({ button: 'right' })
  await contextMenu(page).getByRole('menuitem', { name: 'Project', exact: true }).hover()
  const projectMenu = page.getByRole('menu').last()
  const projectOptions = projectMenu.getByRole('menuitemradio')
  await expect(async () => expect(await projectOptions.count()).toBeGreaterThan(1)).toPass()
  await projectOptions.nth(1).click()
  await target.click({ button: 'right' })
  await contextMenu(page).getByRole('menuitem', { name: 'Project', exact: true }).hover()
  await expect(page.getByRole('menu').last().getByRole('menuitemradio', { name: 'No project', exact: true })).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')
})

Then('the start thread dialog offers the account model and the Host default folder', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-start-thread-dialog', async () => {
    await expect(startThreadDialog(page)).toBeVisible()
    await expect(startThreadDialog(page).getByLabel('Thread project')).toHaveValue('default')
    // The fake Command Code account publishes its route a moment after it is added.
    await expect(async () => {
      const options = await startThreadDialog(page).getByLabel('Thread model').locator('option').count()
      expect(options).toBeGreaterThan(0)
    }).toPass({ timeout: 20_000 })
    await expect(startThreadDialog(page).getByLabel('Thread model')).toBeVisible()
  })
})

Then('the start thread dialog sends the prefilled message by default', async ({ page }: { page: Page }) => {
  await expect(startThreadDialog(page).getByRole('checkbox', { name: 'Send this message now' })).toBeChecked()
})

When('the send-now box is unchecked', async ({ page }: { page: Page }) => {
  await startThreadDialog(page).getByRole('checkbox', { name: 'Send this message now' }).uncheck()
  await expect(startThreadDialog(page)).toContainText('editable draft')
})

When('the thread is started from the dialog with its message kept', async ({ page }: { page: Page }) => {
  await startThreadDialog(page).getByRole('button', { name: 'Start thread', exact: true }).click()
  await expect(startThreadDialog(page)).toBeHidden()
})

Then('the thread composer holds {string} as a draft', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'backlog-start-thread-draft', async () => {
    const composer = page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true }).or(page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true }))
    // The rich composer is a contenteditable editor, so the draft is asserted as text rather than a value.
    await expect(composer.first()).toContainText(text, { timeout: 20_000 })
  })
  await finishJourneyAssertions(page)
})

When('the thread is started from the dialog without a first message', async ({ page }: { page: Page }) => {
  await expect(startThreadDialog(page).getByLabel('First message')).toHaveValue('Work on b:1: Ship the thread starter')
  await startThreadDialog(page).getByLabel('First message').fill('')
  await startThreadDialog(page).getByRole('button', { name: 'Start thread', exact: true }).click()
  await expect(startThreadDialog(page)).toBeHidden()
})

Then('the thread composer is open for it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-start-thread-opens', async () => {
    // An empty first message leaves a blank draft, so the composer may still carry the New thread placeholder.
    const composer = page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true }).or(page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true }))
    await expect(composer.first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: new RegExp(`^Select model, current ${FAKE_MODEL.replaceAll('/', '\\/')}`) })).toBeVisible()
  })
})

When('the Backlog panel is opened again', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Backlog', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Capture', exact: true })).toBeVisible()
})

Then('the item links the thread it started', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-start-thread-links', async () => {
    // A draft with no message yet is not a listed thread, so the chip carries the session fallback label.
    await expect(peek(page).getByRole('button', { name: /^Unlink thread session-/ })).toBeVisible()
    await expect(peek(page).getByRole('button', { name: /^Thread [0-9a-f]{8}$/ })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('an item with linked title and description is captured', async ({ page }: { page: Page }) => {
  const capture = page.getByRole('textbox', { name: 'Capture', exact: true })
  const title = 'Open [guide](https://example.com/guide) https://example.com'
  const description = 'Read [description](https://example.org/description) https://example.org'
  await capture.fill(`${title}\n${description}`)
  await capture.press('Enter')
  await expect(capture).toHaveValue('')
  await expect(row(page, 'Open')).toBeVisible()
})

Then('item text links are clickable in the feed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-item-text-links-feed', async () => {
    const item = row(page, 'Open')
    const titleLink = item.getByRole('link', { name: 'guide', exact: true })
    const descriptionLink = item.getByRole('link', { name: 'description', exact: true })
    await expect(titleLink).toHaveAttribute('href', 'https://example.com/guide')
    await expect(item.getByRole('link', { name: 'https://example.com', exact: true })).toHaveAttribute('href', 'https://example.com')
    await expect(descriptionLink).toHaveAttribute('href', 'https://example.org/description')
    await expect(item.getByRole('link', { name: 'https://example.org', exact: true })).toHaveAttribute('href', 'https://example.org')
    await titleLink.evaluate(element => element.addEventListener('click', event => event.preventDefault(), { once: true }))
    await titleLink.click()
    await expect(peek(page)).toHaveCount(0)
    await descriptionLink.evaluate(element => element.addEventListener('click', event => event.preventDefault(), { once: true }))
    await descriptionLink.click()
    await expect(peek(page)).toHaveCount(0)
  })
})

Then('item title links are clickable in the Items view', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-item-text-links-items', async () => {
    const titleLink = page.getByRole('row', { name: 'Item b:1', exact: true }).getByRole('link', { name: 'guide', exact: true })
    await expect(titleLink).toHaveAttribute('href', 'https://example.com/guide')
    await titleLink.evaluate(element => element.addEventListener('click', event => event.preventDefault(), { once: true }))
    await titleLink.click()
    await expect(peek(page)).toHaveCount(0)
  })
})

Then('item text links are clickable in the detail', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-item-text-links-detail', async () => {
    const titleLink = peek(page).getByRole('link', { name: 'guide', exact: true })
    const descriptionLink = peek(page).getByRole('link', { name: 'description', exact: true })
    await expect(titleLink).toHaveAttribute('href', 'https://example.com/guide')
    await expect(descriptionLink).toHaveAttribute('href', 'https://example.org/description')
    await titleLink.evaluate(element => element.addEventListener('click', event => event.preventDefault(), { once: true }))
    await titleLink.click()
    await expect(peek(page).getByRole('textbox', { name: 'Title' })).toHaveCount(0)
    await descriptionLink.evaluate(element => element.addEventListener('click', event => event.preventDefault(), { once: true }))
    await descriptionLink.click()
    await expect(peek(page).getByRole('textbox', { name: 'Body' })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('the Items view selects a range and toggles one item', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Items', exact: true }).click()
  const checkboxFor = (id: number) => page.getByRole('row', { name: `Item b:${String(id)}` }).getByRole('checkbox', { name: `Select b:${String(id)}` })
  await checkboxFor(1).click()
  await checkboxFor(3).click({ modifiers: ['Shift'] })
  await expect(page.getByText('3 selected', { exact: true })).toBeVisible()
  await checkboxFor(1).click({ modifiers: ['ControlOrMeta'] })
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
})

Then('the batch status action updates only the remaining selected items', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-multi-select-batch-status', async () => {
    await page.getByRole('button', { name: 'Move to' }).click()
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Status of b:1' })).toContainText('Inbox')
    await expect(page.getByRole('button', { name: 'Status of b:2' })).toContainText('Done')
    await expect(page.getByRole('button', { name: 'Status of b:3' })).toContainText('Done')
  })
  await finishJourneyAssertions(page)
})
