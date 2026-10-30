import { expect, type Locator, type Page } from '@playwright/test'
import { globalPanelLink, openGlobalPanel } from '../plugin-view-names.js'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion, restartScratchProfileInBrowser } from '../steps.js'
import { sendMessage, startThreadWithModel } from '../threads.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { openActivity } from './activity-timeline.steps.js'

const attachmentFixtures = fileURLToPath(new URL('../../fixtures/attachments/', import.meta.url))
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
const countViewTransitions = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.documentElement.dataset['viewTransitionCount'] = '0'
    const startViewTransition = document.startViewTransition.bind(document)
    document.startViewTransition = callback => {
      const count = Number(document.documentElement.dataset['viewTransitionCount'] ?? 0)
      document.documentElement.dataset['viewTransitionCount'] = String(count + 1)
      return startViewTransition(callback)
    }
  })
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
    await page.getByRole('textbox', { name: 'Search backlog', exact: true }).press('Enter')
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
    await peek(page).getByRole('button', { name: 'Edit title', exact: true }).click()
    return peek(page).getByRole('textbox', { name: 'Title', exact: true })
  }
  throw new Error(`Unknown backlog item view: ${view}`)
}

const contextMenu = (page: Page) => page.getByRole('menu')

const menuItemTextPosition = async (item: Locator, label: string): Promise<number> =>
  item.evaluate((element, expectedLabel) => {
    const textWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const textContents: string[] = []
    const textNodes: Text[] = []
    let textNode = textWalker.nextNode()
    while (textNode !== null) {
      if (textNode instanceof Text) {
        textContents.push(textNode.textContent)
        if (textNode.textContent.trim() !== '') textNodes.push(textNode)
      }
      textNode = textWalker.nextNode()
    }
    const combinedText = textContents.join('').trim()
    const firstTextNode = textNodes[0]
    if (!combinedText.includes(expectedLabel) || firstTextNode === undefined)
      throw new Error(`Could not find the label "${expectedLabel}" in the context-menu item`)
    const textRange = document.createRange()
    textRange.selectNodeContents(firstTextNode)
    return textRange.getBoundingClientRect().left
  }, label)

const expectContextMenuLabelsAligned = async (menu: Locator, includeOpenItem: boolean): Promise<void> => {
  const labels = ['Start thread…', 'Copy item ID', 'Copy item link', 'Copy item as Markdown', 'Status', 'Kind', 'Project', 'Pin item']
  if (includeOpenItem) labels.push('Open item')
  const attention = menu.getByRole('menuitem', { name: 'Attention', exact: true })
  if ((await attention.locator('span[title]').count()) === 0) labels.push('Attention')

  const referencePosition = await menuItemTextPosition(menu.getByRole('menuitem', { name: 'Start thread…', exact: true }), 'Start thread…')
  for (const label of labels) {
    const item = menu.getByRole('menuitem', { name: label, exact: true })
    const position = await menuItemTextPosition(item, label)
    expect(Math.abs(position - referencePosition), `${label} label should align with the icon column`).toBeLessThanOrEqual(1)
  }
}

const expectItemActions = async (page: Page, includeOpenItem: boolean): Promise<void> => {
  const menu = contextMenu(page)
  await expect(menu.getByRole('menuitem', { name: 'Start thread…', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Status', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Kind', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Attention', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Project', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^(Unpin item|Pin item)$/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Copy item ID', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Copy item link', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Copy item as Markdown', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Run triage', exact: true })).toHaveCount(0)
  if (includeOpenItem) await expect(menu.getByRole('menuitem', { name: 'Open item', exact: true })).toBeVisible()
  await expectContextMenuLabelsAligned(menu, includeOpenItem)
  await menu.getByRole('menuitem', { name: 'Project', exact: true }).hover()
  await expect(page.getByRole('menu').last().getByRole('menuitemradio', { name: 'No project', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
}

When('the Backlog panel is opened', async ({ page }: { page: Page }) => {
  // A loaded machine can raise the provider-setup modal after the boot step stopped waiting; it hides the panel from role queries.
  await StartupDialogs.registerProviderSetupDismissal(page)
  await openGlobalPanel(page, 'Backlog: Items')
  await expect(page.getByRole('textbox', { name: 'Capture', exact: true })).toBeVisible()
})

When('the Backlog settings are opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Backlog settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Jev triage', exact: true })).toBeVisible()
})

Then('the Jev settings controls are available', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('checkbox', { name: 'Enable Jev' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Triage new items automatically' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'TypeSafe API key reference' })).toHaveAttribute('data-secret-input', 'reference')
  await expect(page.getByRole('button', { name: 'Save Jev settings', exact: true })).toBeEnabled()
})

When('Jev settings are saved with a secret reference', async ({ page }: { page: Page }) => {
  await page.getByRole('checkbox', { name: 'Enable Jev' }).check()
  await page.getByRole('textbox', { name: 'TypeSafe API key reference' }).fill('secret:DSH_TEST_JEV')
  await page.getByRole('button', { name: 'Save Jev settings', exact: true }).click()
})

Then('the Jev settings show a successful save', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('status').filter({ hasText: 'Jev settings saved.' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'TypeSafe API key reference' })).toHaveValue('secret:DSH_TEST_JEV')
})

When('the image references are submitted with the capture', async ({ page }: { page: Page }) => {
  const capture = page.getByRole('textbox', { name: 'Capture', exact: true })
  await capture.fill('Capture screenshots with the issue\n\n@Image 1 @Image 2')
  await capture.press('Enter')
})

When('two images are attached to the capture', async ({ page }: { page: Page }) => {
  const captureForm = page.locator('form').filter({ has: page.getByRole('textbox', { name: 'Capture', exact: true }) })
  const contentRegion = page.locator('[data-backlog-content-region]')
  const contentHeight = await contentRegion.evaluate(element => element.getBoundingClientRect().height)
  const composerHeight = await captureForm.evaluate(element => element.getBoundingClientRect().height)
  await captureForm.locator('input[type="file"]').setInputFiles([join(attachmentFixtures, 'red.png'), join(attachmentFixtures, 'blue.png')])
  await expect(captureForm.getByRole('button', { name: 'Open red.png', exact: true })).toBeVisible()
  await expect(captureForm.getByRole('button', { name: 'Open blue.png', exact: true })).toBeVisible()
  await expect.poll(() => contentRegion.evaluate(element => element.getBoundingClientRect().height)).toBe(contentHeight)
  await expect.poll(() => captureForm.evaluate(element => element.getBoundingClientRect().height)).toBe(composerHeight)
})

When('{string} is captured', async ({ page }: { page: Page }, text: string) => {
  const capture = page.getByRole('textbox', { name: 'Capture', exact: true })
  await capture.fill(text)
  await capture.press('Enter')
  await expect(capture).toHaveText('')
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

const searchInput = (page: Page) => page.getByRole('textbox', { name: 'Search backlog', exact: true })

When('the backlog is searched for {string}', async ({ page }: { page: Page }, query: string) => {
  await searchInput(page).fill(query)
  await searchInput(page).press('Enter')
})

When('the backlog search is typed {string}', async ({ page }: { page: Page }, query: string) => {
  await searchInput(page).fill(query)
})

When('the backlog search is submitted', async ({ page }: { page: Page }) => {
  await searchInput(page).press('Enter')
})

Then('the board shows only the card for b:{int}', async ({ page }: { page: Page }, id: number) => {
  await recordAssertion(page, 'backlog-search-filters-board', async () => {
    await expect(page.locator('[data-backlog-column]')).toHaveCount(5)
    await expect(page.getByRole('article', { name: /^Card b:/ })).toHaveCount(1)
    await expect(page.getByRole('article', { name: `Card b:${String(id)}`, exact: true })).toBeVisible()
    await expect(searchResults(page)).toHaveCount(0)
  })
})

Then('the feed lists only {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-search', async () => {
    await expect(searchResults(page).getByRole('listitem', { name: /^Item b:/ })).toHaveCount(1)
    await expect(searchResults(page)).toContainText(title)
  })
  await finishJourneyAssertions(page)
})

Then('search results offer one count for each matching status', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-search-status-counts', async () => {
    await expect(statusChip(page, 'In progress')).toHaveAccessibleName('In progress, 1 item')
    await expect(statusChip(page, 'Inbox')).toHaveAccessibleName('Inbox, 1 item')
  })
})

When('search is filtered by the {string} status', async ({ page }: { page: Page }, label: string) => {
  const chip = statusChip(page, label)
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
})

When('search is also filtered by the {string} status', async ({ page }: { page: Page }, label: string) => {
  const chip = statusChip(page, label)
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
})

When('the {string} status search filter is cleared', async ({ page }: { page: Page }, label: string) => {
  const chip = statusChip(page, label)
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
})

Then('search results list only {string}', async ({ page }: { page: Page }, title: string) => {
  const assertionId = `backlog-search-status-single-${title.toLowerCase().replaceAll(' ', '-')}`
  await recordAssertion(page, assertionId, async () => {
    const results = searchResults(page)
    await expect(results.getByRole('listitem', { name: /^Item b:/ })).toHaveCount(1)
    await expect(results).toContainText(title)
  })
})

Then('search results list both {string} and {string}', async ({ page }: { page: Page }, first: string, second: string) => {
  const statusFilters = await Promise.all(
    ['In progress', 'Inbox'].map(async label =>
      (await statusChip(page, label).getAttribute('aria-pressed')) === 'true' ? label.toLowerCase().replaceAll(' ', '-') : null,
    ),
  )
  const selection = statusFilters.filter((label): label is string => label !== null)
  const assertionId = `backlog-search-status-multiple-${selection.join('-') || 'all'}`
  await recordAssertion(page, assertionId, async () => {
    const results = searchResults(page)
    await expect(results.getByRole('listitem', { name: /^Item b:/ })).toHaveCount(2)
    await expect(results).toContainText(first)
    await expect(results).toContainText(second)
  })
  await finishJourneyAssertions(page)
})

When('item b:{int} is moved to In progress on the board', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await countViewTransitions(page)
  await page
    .getByRole('article', { name: `Card b:${String(id)}` })
    .getByRole('button', { name: `Status of b:${String(id)}` })
    .click()
  await page.getByRole('menuitem', { name: 'In progress' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-view-transition-count', '0')
})

When('the default board columns are restored', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Configure board columns' }).click()
  for (const status of ['Inbox', 'Todo', 'In progress', 'Done', 'Dropped']) {
    const checkbox = page.getByRole('menuitemcheckbox', { name: status, exact: true })
    if ((await checkbox.getAttribute('aria-checked')) === 'false') await checkbox.click()
  }
  const moveLeft = page.getByRole('button', { name: 'Move Inbox left', exact: true })
  while (await moveLeft.isEnabled()) await moveLeft.click()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-backlog-column]')).toHaveCount(5)
})

When('the Inbox column is moved right and the Dropped column is hidden', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Configure board columns' }).click()
  await page.getByRole('button', { name: 'Move Inbox right' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Dropped' }).click()
  await page.keyboard.press('Escape')
})

Then('the board columns show the customized order without Dropped', async ({ page }: { page: Page }) => {
  const statuses = await page.locator('[data-backlog-column]').evaluateAll(columns => columns.map(column => column.getAttribute('data-backlog-column')))
  expect(statuses).toEqual(['todo', 'inbox', 'doing', 'done'])
})

Then('the Backlog items remain available outside the customized board', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('table', { name: 'Backlog items' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Backlog items' }).getByRole('row', { name: /^Item b:/ })).toHaveCount(1)
  await expect(page.getByRole('table', { name: 'Backlog items' })).toContainText('Keep board preferences local')
})

Then('the board columns follow the status order through Dropped', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-board-status-order', async () => {
    const statuses = await page.locator('[data-backlog-column]').evaluateAll(columns => columns.map(column => column.getAttribute('data-backlog-column')))
    expect(statuses).toEqual(['inbox', 'todo', 'doing', 'done', 'dropped'])
  })
})

Then('the board columns do not scroll horizontally', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-board-no-horizontal-scroll', async () => {
    const board = page.locator('[data-backlog-board]')
    const boardOverflows = await board.evaluate(element => element.scrollWidth > element.clientWidth)
    const columnsOverflow = await page.locator('[data-backlog-column]').evaluateAll(columns => columns.some(column => column.scrollWidth > column.clientWidth))
    expect(boardOverflows).toBe(false)
    expect(columnsOverflow).toBe(false)
  })
})

Then('the In progress column holds {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-board-move', async () => {
    await expect(page.getByRole('region', { name: 'In progress column' })).toContainText(title)
    await expect(page.getByRole('region', { name: 'Inbox column' })).not.toContainText(title)
  })
})

Then('the item detail can be resized without being cut off', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-item-detail-resize', async () => {
    const detail = peek(page)
    const splitter = detail.getByRole('separator', { name: 'Resize item detail', exact: true })
    const region = page.locator('[data-backlog-content-region]')
    const before = Number(await splitter.getAttribute('aria-valuenow'))
    const splitterBox = await splitter.boundingBox()
    if (splitterBox === null) throw new Error('The item detail splitter is not visible.')
    await page.mouse.move(splitterBox.x + splitterBox.width / 2, splitterBox.y + splitterBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(splitterBox.x + splitterBox.width / 2 - 80, splitterBox.y + splitterBox.height / 2, { steps: 4 })
    await page.mouse.up()
    const after = Number(await splitter.getAttribute('aria-valuenow'))
    expect(after).toBeGreaterThan(before)
    const detailBox = await detail.boundingBox()
    const regionBox = await region.boundingBox()
    if (detailBox === null || regionBox === null) throw new Error('The item detail or its content region has no layout box.')
    expect(detailBox.y).toBeCloseTo(regionBox.y, 0)
    expect(detailBox.y + detailBox.height).toBeCloseTo(regionBox.y + regionBox.height, 0)
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

When('the project picker for item b:{int} is opened', async ({ page }: { page: Page }, id: number) => {
  await peek(page)
    .getByRole('combobox', { name: `Project of b:${String(id)}`, exact: true })
    .click()
})

Then('the project choices are visible', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('combobox', { name: 'Search projects', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'No project', exact: true })).toBeVisible()
})

When('item b:{int} is assigned to the registered project from its details', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('option', { name: /^default-workspace\b/ }).click()
  await expect(peek(page).getByRole('combobox', { name: `Project of b:${String(id)}`, exact: true })).toContainText('default-workspace')
})

Then('item b:{int} shows its selected project', async ({ page }: { page: Page }, id: number) => {
  await expect(peek(page).getByRole('combobox', { name: `Project of b:${String(id)}`, exact: true })).toContainText('default-workspace')
})

When('item b:{int} is unassigned from its details', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('option', { name: 'No project', exact: true }).click()
  await expect(peek(page).getByRole('combobox', { name: `Project of b:${String(id)}`, exact: true })).toContainText('Project')
})

Then('item b:{int} has no project', async ({ page }: { page: Page }, id: number) => {
  await expect(peek(page).getByRole('combobox', { name: `Project of b:${String(id)}`, exact: true })).toContainText('Project')
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

When('the Board view is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(page.locator('[data-backlog-column]')).not.toHaveCount(0)
})

When('the customized Board view is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(page.locator('[data-backlog-column]')).toHaveCount(4)
})

When('the scratch Host is restarted in the browser', async ({ page }: { page: Page }) => {
  await restartScratchProfileInBrowser(page)
  await expect(globalPanelLink(page, 'Backlog: Items')).toBeVisible()
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

When('backlog card b:{int} is clicked', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await page.getByRole('article', { name: `Card b:${String(id)}` }).click()
  await expect(peek(page)).toContainText(`b:${String(id)}`)
})

When('the Start thread button in the item detail is clicked', async ({ page }: { page: Page }) => {
  await peek(page).getByRole('button', { name: 'Start thread', exact: true }).click()
})

When('backlog item b:{int} is right-clicked for a thread', async ({ page }: { page: Page }, id: number) => {
  await feed(page)
    .getByRole('article', { name: `Item b:${String(id)}`, exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Start thread…', exact: true }).click()
})

Then('backlog item b:{int} offers tweet retrieval in its feed context menu', async ({ page }: { page: Page }, id: number) => {
  const target = await contextTarget(page, id, 'feed')
  await target.click({ button: 'right' })
  await expect(contextMenu(page).getByRole('menuitem', { name: 'Retrieve tweet content', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
})

Then('backlog item b:{int} exposes all context actions in the {string} view', async ({ page }: { page: Page }, id: number, view: string) => {
  await recordAssertion(page, `backlog-item-actions-${view}`, async () => {
    const target = await contextTarget(page, id, view)
    await expect(target).toBeVisible()
    await target.click({ button: 'right' })
    await expect(contextMenu(page)).toBeVisible()
    await expectItemActions(page, view !== 'details')
    if (view === 'feed') await expect(target.getByRole('button', { name: 'Run triage', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
  if (view === 'details') {
    await expect(peek(page).getByRole('button', { name: 'Run triage', exact: true })).toHaveCount(0)
    await finishJourneyAssertions(page)
  }
})

When('ArrowUp is pressed from the empty backlog composer', async ({ page }: { page: Page }) => {
  const capture = page.getByRole('textbox', { name: 'Capture', exact: true })
  await capture.fill('')
  await capture.press('ArrowUp')
})

Then('backlog item b:{int} receives composer keyboard focus', async ({ page }: { page: Page }, id: number) => {
  await expect(feed(page).getByRole('article', { name: `Item b:${String(id)}`, exact: true })).toBeFocused()
})

When('backlog item b:{int} copies its ID and link from the context menu', async ({ page }: { page: Page }, id: number) => {
  const origin = new URL(page.url()).origin
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  const target = await contextTarget(page, id, 'feed')

  await target.click({ button: 'right' })
  await contextMenu(page).getByRole('menuitem', { name: 'Copy item ID', exact: true }).click()
  await recordAssertion(page, 'backlog-copy-item-id', async () => {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(String(id))
  })

  await target.click({ button: 'right' })
  await contextMenu(page).getByRole('menuitem', { name: 'Copy item link', exact: true }).click()
  await recordAssertion(page, 'backlog-copy-item-link', async () => {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`b:${String(id)}`)
  })
})

When('backlog item b:{int} copies its Markdown from the context menu', async ({ page }: { page: Page }, id: number) => {
  const origin = new URL(page.url()).origin
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  const target = await contextTarget(page, id, 'feed')

  await target.click({ button: 'right' })
  await contextMenu(page).getByRole('menuitem', { name: 'Copy item as Markdown', exact: true }).click()
  await recordAssertion(page, 'backlog-copy-item-markdown', async () => {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`b:${String(id)}`)
  })
})

When('backlog item b:{int} is moved to {string} from its feed context menu', async ({ page }: { page: Page }, id: number, status: string) => {
  const target = await contextTarget(page, id, 'feed')
  await target.click({ button: 'right' })
  await contextMenu(page)
    .getByRole('menuitem', { name: /^Status(?: \(\d+\))?$/u })
    .hover()
  await page.getByRole('menu').last().getByRole('menuitemradio', { name: status, exact: true }).click()
  await target.click({ button: 'right' })
  await contextMenu(page)
    .getByRole('menuitem', { name: /^Status(?: \(\d+\))?$/u })
    .hover()
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

Then('the board card for b:{int} names the project it is filed under', async ({ page }: { page: Page }, id: number) => {
  await recordAssertion(page, 'backlog-board-project-label', async () => {
    await page.getByRole('textbox', { name: 'Search backlog', exact: true }).fill('')
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    const card = page.getByRole('article', { name: `Card b:${String(id)}`, exact: true })
    await expect(card).toBeVisible()
    await card.click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Project', exact: true }).hover()
    const chosen = page.getByRole('menu').last().getByRole('menuitemradio', { checked: true })
    await expect(chosen).toHaveCount(1)
    const projectName = (await chosen.innerText()).trim()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(projectName).not.toBe('No project')
    await expect(card).toContainText(projectName)

    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await page.getByRole('button', { name: 'All projects', exact: true }).click()
    const projectCard = page.getByRole('button').filter({ has: page.getByText(projectName, { exact: true }) })
    await expect(projectCard).toHaveCount(1)
    await expect(projectCard).not.toContainText('/')
  })
})

Then('the start thread dialog offers the account model and the Host default folder', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-start-thread-dialog', async () => {
    await expect(startThreadDialog(page)).toBeVisible()
    await expect(startThreadDialog(page).getByRole('combobox', { name: 'Thread project' })).toContainText('Host default workspace')
    // The fake Command Code account publishes its route a moment after it is added; the model picker stays disabled until
    // the catalog resolves and then shows the selected model.
    await expect(startThreadDialog(page).getByRole('combobox', { name: 'Thread model' })).toBeEnabled({ timeout: 20_000 })
  })
})

Then('the start thread dialog has no send-now toggle', async ({ page }: { page: Page }) => {
  await expect(startThreadDialog(page).getByRole('checkbox', { name: 'Send this message now' })).toHaveCount(0)
})

Then('the start thread dialog keeps the thread in the backlog by default', async ({ page }: { page: Page }) => {
  await expect(startThreadDialog(page).getByRole('checkbox', { name: 'Open the thread when it is created' })).not.toBeChecked()
  await expect(startThreadDialog(page)).toContainText('until you open it')
})

When('the open-when-created box is checked', async ({ page }: { page: Page }) => {
  await startThreadDialog(page).getByRole('checkbox', { name: 'Open the thread when it is created' }).check()
})

When('the thread is started from the dialog with the prefilled first message', async ({ page }: { page: Page }) => {
  await expect(startThreadDialog(page).getByLabel('First message')).toHaveValue(/^Work on b:1: /)
  await startThreadDialog(page).getByRole('button', { name: 'Start thread', exact: true }).click()
  await expect(startThreadDialog(page)).toBeHidden()
})

When('the thread is started from the dialog without a first message', async ({ page }: { page: Page }) => {
  await expect(startThreadDialog(page).getByLabel('First message')).toHaveValue(/^Work on b:1: /)
  await startThreadDialog(page).getByLabel('First message').fill('')
  await startThreadDialog(page).getByRole('button', { name: 'Start thread', exact: true }).click()
  await expect(startThreadDialog(page)).toBeHidden()
})

Then('the backlog panel stays open while the thread is created', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-start-thread-stays', async () => {
    await expect(page.getByRole('textbox', { name: 'Capture', exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Thread started for b:1', { timeout: 30_000 })
  })
})

When('the start thread report is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('alert').getByRole('button', { name: 'Open', exact: true }).click()
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
  await openGlobalPanel(page, 'Backlog: Items')
  await expect(page.getByRole('textbox', { name: 'Capture', exact: true })).toBeVisible()
})

Then('the item links the thread it started as {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-start-thread-links', async () => {
    const related = peek(page).getByRole('list', { name: 'Related' })
    // The Host names the thread after the item before it links it, so the chip carries that title.
    await expect(related.getByRole('button', { name: title, exact: true })).toBeVisible()
    await expect(related.getByRole('button', { name: /^Unlink thread session-/ })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('an item with linked title and description is captured', async ({ page }: { page: Page }) => {
  const capture = page.getByRole('textbox', { name: 'Capture', exact: true })
  const title = 'Open [guide](https://example.com/guide) https://example.com'
  const description = 'Read [description](https://example.org/description) https://example.org'
  await capture.fill(`${title}\n${description}`)
  await capture.press('Enter')
  await expect(capture).toHaveText('')
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

When('the Board view selects multiple cards with modifier clicks', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  const cardFor = (id: number) => page.getByRole('article', { name: `Card b:${String(id)}`, exact: true })
  await cardFor(1).click({ modifiers: ['ControlOrMeta'] })
  await cardFor(3).click({ modifiers: ['Shift'] })
  await expect(cardFor(1)).toHaveAttribute('aria-selected', 'true')
  await expect(cardFor(2)).toHaveAttribute('aria-selected', 'true')
  await expect(cardFor(3)).toHaveAttribute('aria-selected', 'true')
})

Then('collapsing the selected Inbox group clears its batch selection', async ({ page }: { page: Page }) => {
  await page.getByRole('checkbox', { name: 'Select all visible items', exact: true }).click()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Toggle inbox', exact: true }).click()
  await recordAssertion(page, 'backlog-selection-collapsed-scope', async () => {
    await expect(page.getByRole('row', { name: 'Item b:1', exact: true })).toHaveCount(0)
    await expect(page.getByText('2 selected', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Clear selection', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('backlog selection is filtered after opening another item', async ({ page }: { page: Page }) => {
  await page.getByRole('row', { name: 'Item b:1', exact: true }).getByText('Hidden selection item', { exact: true }).click()
  await searchInput(page).fill('Visible selection item')
  await searchInput(page).press('Enter')
  await expect(page.getByRole('listitem', { name: 'Item b:1', exact: true })).toHaveCount(0)
  await page.getByRole('listitem', { name: 'Item b:2', exact: true }).click({ modifiers: ['ControlOrMeta'] })
})

Then('only the visible item is selected', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-selection-visible-scope', async () => {
    const visible = page.getByRole('listitem', { name: 'Item b:2', exact: true })
    await expect(visible).toHaveAttribute('data-selected', 'true')
    await expect(page.locator('[data-selected]')).toHaveCount(1)
    await visible.click({ button: 'right' })
    await expect(contextMenu(page)).not.toContainText('2 selected')
  })
  await finishJourneyAssertions(page)
})

When('only board card b:{int} is selected', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await page.getByRole('article', { name: `Card b:${String(id)}`, exact: true }).click({ modifiers: ['ControlOrMeta'] })
})

Then('only board card b:2 moved to Todo', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-board-unselected-drag', async () => {
    await expect(page.locator('[data-backlog-column="todo"]').getByRole('article', { name: 'Card b:2', exact: true })).toBeVisible()
    for (const id of [1, 3])
      await expect(page.locator('[data-backlog-column="inbox"]').getByRole('article', { name: `Card b:${String(id)}`, exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the selected board cards are dragged to {string}', async ({ page }: { page: Page }, status: string) => {
  const card = page.getByRole('article', { name: 'Card b:2', exact: true })
  const source = await card.boundingBox()
  const target = await page.locator(`[data-backlog-column="${status}"]`).boundingBox()
  if (source === null || target === null) throw new Error('Board drag bounds are unavailable')
  await countViewTransitions(page)
  await page.mouse.move(source.x + 30, source.y + 20)
  await page.mouse.down()
  await page.mouse.move(target.x + 40, target.y + 60, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('html')).toHaveAttribute('data-view-transition-count', '0')
})

When('the selected board card context menu moves all selected items to {string}', async ({ page }: { page: Page }, status: string) => {
  await page.getByRole('article', { name: 'Card b:2', exact: true }).click({ button: 'right' })
  await expect(contextMenu(page)).toContainText('3 selected')
  await contextMenu(page)
    .getByRole('menuitem', { name: /^Status(?: \(\d+\))?$/u })
    .hover()
  await page.getByRole('menu').last().getByRole('menuitemradio', { name: status, exact: true }).click()
})

Then('the board context menu status action updates selected items', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-board-multi-select-context-status', async () => {
    const todo = page.locator('[data-backlog-column="todo"]')
    await expect(todo.getByRole('article', { name: 'Card b:1', exact: true })).toBeVisible()
    await expect(todo.getByRole('article', { name: 'Card b:2', exact: true })).toBeVisible()
    await expect(todo.getByRole('article', { name: 'Card b:3', exact: true })).toBeVisible()
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

When("the selected item's context menu moves all selected items to {string}", async ({ page }: { page: Page }, status: string) => {
  const row = page.getByRole('row', { name: 'Item b:2', exact: true })
  await row.click({ button: 'right' })
  await expect(contextMenu(page)).toContainText('2 selected')
  await contextMenu(page)
    .getByRole('menuitem', { name: /^Status(?: \(\d+\))?$/u })
    .hover()
  await page.getByRole('menu').last().getByRole('menuitemradio', { name: status, exact: true }).click()
})

Then('the context menu status action updates all selected items', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-multi-select-context-status', async () => {
    await expect(page.getByText('2 selected', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Status of b:1' })).toContainText('Inbox')
    await expect(page.getByRole('button', { name: 'Status of b:2' })).toContainText('Todo')
    await expect(page.getByRole('button', { name: 'Status of b:3' })).toContainText('Todo')
  })
})

When('the remaining selection is made again', async ({ page }: { page: Page }) => {
  const second = page.getByRole('row', { name: 'Item b:2', exact: true }).getByRole('checkbox', { name: 'Select b:2' })
  const third = page.getByRole('row', { name: 'Item b:3', exact: true }).getByRole('checkbox', { name: 'Select b:3' })
  await second.click()
  await third.click({ modifiers: ['ControlOrMeta'] })
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

When('Start thread is clicked for the selection', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
})

Then('the start thread dialog offers both thread-count choices', async ({ page }: { page: Page }) => {
  const dialog = startThreadDialog(page)
  await expect(dialog.getByRole('radio', { name: 'One thread for all 2 items' })).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'One thread per item (2 threads)' })).toBeVisible()
})

When('one thread per item is chosen', async ({ page }: { page: Page }) => {
  await startThreadDialog(page).getByRole('radio', { name: 'One thread per item (2 threads)' }).check()
  await expect(startThreadDialog(page).getByRole('button', { name: 'Start 2 threads', exact: true })).toBeVisible()
})

When('the selected backlog threads are started', async ({ page }: { page: Page }) => {
  await startThreadDialog(page).getByRole('button', { name: 'Start 2 threads', exact: true }).click()
})

Then('the backlog reports that two threads were started', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-multi-select-start-threads', async () => {
    await expect(page.getByRole('alert')).toContainText('Started 2 threads for', { timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

When('a thread on the fake model writes {string}', async ({ page }: { page: Page }, text: string) => {
  // A provider-less profile ends the first turn immediately and the client then drops the conversation, so the
  // reference this journey clicks would be gone; run a real turn on the local fake provider and let it settle.
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  await sendMessage(page, text)
})

When('a message with the serialized backlog mention is sent', async ({ page }: { page: Page }) => {
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  // The composer serializes a picked chip this way, so the sent text is exactly what a real mention produces.
  await sendMessage(page, 'Following b:1 "Ship the backlog reference preview" (backlog item; backlog_get has its details)')
})

Then('the sent mention renders as a backlog chip {string} titled {string}', async ({ page }: { page: Page }, reference: string, title: string) => {
  await recordAssertion(page, 'backlog-sent-mention-chip', async () => {
    const chip = page.getByRole('button', { name: `Backlog item ${reference} · ${title}`, exact: true })
    await expect(chip).toBeVisible()
    // The serialized title and tool hint must not stay in the bubble.
    await expect(page.getByText('backlog_get has its details')).toHaveCount(0)
    await chip.click()
    await expect(page.locator('[data-dshfiles-backlog-preview]')).toContainText(title)
  })
  await finishJourneyAssertions(page)
})

Then('the inline backlog preview shows {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'backlog-reference-inline-preview', async () => {
    const reference = page.getByRole('button', { name: 'Backlog item b:1', exact: true })
    await expect(reference).toBeVisible()
    const preview = page.locator('[data-dshfiles-backlog-preview]')
    // A scroll closes the card by design, and the conversation can still settle right after the turn lands, so ask
    // again rather than reading a card the page itself just took away.
    await expect(async () => {
      if ((await preview.count()) === 0) await reference.click()
      await expect(preview).toContainText(text, { timeout: 1_500 })
    }).toPass({ timeout: 30_000 })
    await expect(preview.getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
    await expect(preview.getByRole('img', { name: 'blue.png', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('an image is opened from the inline backlog preview', async ({ page }: { page: Page }) => {
  await page.locator('[data-dshfiles-backlog-preview]').getByRole('button', { name: 'Open red.png', exact: true }).click()
})

Then('the inline backlog preview gallery opens above its card and navigates both images', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-reference-image-gallery', async () => {
    const preview = page.locator('[data-dshfiles-backlog-preview]')
    const gallery = page.getByRole('dialog', { name: 'Image preview', exact: true })
    await expect(gallery).toBeVisible()
    await expect(gallery.getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
    const galleryZIndex = Number(await gallery.evaluate(element => getComputedStyle(element).zIndex))
    const previewZIndex = Number(await preview.evaluate(element => getComputedStyle(element).zIndex))
    expect(galleryZIndex).toBeGreaterThan(previewZIndex)
    await page.keyboard.press('ArrowRight')
    await expect(gallery.getByRole('img', { name: 'blue.png', exact: true })).toBeVisible()
    await expect(gallery.getByRole('button', { name: 'Image 2 of 2', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(gallery).toHaveCount(0)
    await expect(preview).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the backlog preview is opened in the Backlog panel', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Open in Backlog', exact: true }).click()
  await expect(peek(page)).toBeVisible()
})

Then('the backlog detail shows {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'backlog-reference-opened-in-panel', async () => {
    await expect(peek(page).getByText(text, { exact: true })).toBeVisible()
  })
})

When('the backlog backfill is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Backfill triage', exact: true }).click()
})

Then('the backfill dialog explains that it runs Jev and the configured triage model', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-backfill-dialog', async () => {
    const dialog = page.getByRole('dialog', { name: 'Backfill triage', exact: true })
    await expect(dialog).toContainText('Runs Jev and the configured triage model')
    await expect(dialog.getByRole('button', { name: 'Run backfill', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the captured backlog item keeps both image attachments inline', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-rich-capture-images', async () => {
    await row(page, 'Capture screenshots with the issue').click()
    const detail = peek(page)
    await expect(detail.getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
    await expect(detail.getByRole('img', { name: 'blue.png', exact: true })).toBeVisible()
    await expect(detail).not.toContainText('@Image')
  })
  await finishJourneyAssertions(page)
})

When('the item description is replaced with {string}', async ({ page }: { page: Page }, text: string) => {
  await peek(page).getByRole('button', { name: 'Edit description', exact: true }).click()
  const body = peek(page).getByRole('textbox', { name: 'Body', exact: true })
  await body.fill(text)
  await body.press('ControlOrMeta+Enter')
})

Then('the item detail shows the saved Markdown description', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-rich-text-description', async () => {
    await expect(peek(page)).toContainText('Observed')
    await expect(peek(page).locator('strong')).toContainText('Observed')
  })
})

When('a comment {string} is added', async ({ page }: { page: Page }, text: string) => {
  await peek(page).getByRole('textbox', { name: 'Comment', exact: true }).fill(text)
  await peek(page).getByRole('button', { name: 'Reply', exact: true }).click()
})

Then('the item activity shows the comment', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-rich-text-comment', async () => {
    await expect(peek(page).getByRole('list', { name: 'Activity' })).toContainText('Confirmed in the scratch profile')
  })
  await finishJourneyAssertions(page)
})

When('a reply with an image is added', async ({ page }: { page: Page }) => {
  const itemPeek = peek(page)
  await itemPeek.locator('input[type="file"]').setInputFiles(join(attachmentFixtures, 'red.png'))
  await expect(itemPeek.getByRole('button', { name: 'Open red.png', exact: true })).toBeVisible()
  const comment = itemPeek.getByRole('textbox', { name: 'Comment', exact: true })
  await comment.fill('Original reply')
  await comment.press('Enter')
  await expect(itemPeek.getByRole('list', { name: 'Activity' })).toContainText('Original reply')
})

When('the user reply is edited with keyboard navigation', async ({ page }: { page: Page }) => {
  const activity = peek(page).getByRole('list', { name: 'Activity' })
  const actions = activity.getByRole('button', { name: 'Reply actions', exact: true })
  await actions.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Edit reply', exact: true }).focus()
  await page.keyboard.press('Enter')
  const editor = activity.getByRole('textbox', { name: 'Edit reply', exact: true })
  await expect(editor).toBeVisible()
  await expect(activity.getByRole('button', { name: 'Open red.png', exact: true })).toBeVisible()
  await activity.getByRole('button', { name: 'Remove red.png', exact: true }).click()
  await activity.locator('input[type="file"]').setInputFiles(join(attachmentFixtures, 'blue.png'))
  await expect(activity.getByRole('button', { name: 'Open blue.png', exact: true })).toBeVisible()
  await editor.fill('Edited reply')
  await editor.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const save = activity.getByRole('button', { name: 'Save reply', exact: true })
  await expect(save).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(activity).toContainText('Edited reply')
})

Then('the edited reply has only its replacement attachment', async ({ page }: { page: Page }) => {
  const activity = peek(page).getByRole('list', { name: 'Activity' })
  await expect(activity).toContainText('Edited reply')
  await expect(activity.getByRole('button', { name: 'Open blue.png', exact: true })).toBeVisible()
  await expect(activity.getByRole('button', { name: 'Open red.png', exact: true })).toHaveCount(0)
})

When('the user reply is deleted after confirmation', async ({ page }: { page: Page }) => {
  const activity = peek(page).getByRole('list', { name: 'Activity' })
  let confirmationMessage: string | undefined
  page.once('dialog', dialog => {
    confirmationMessage = dialog.message()
    void dialog.accept()
  })
  await activity.getByRole('button', { name: 'Reply actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete reply', exact: true }).click()
  expect(confirmationMessage).toBe('Delete this reply? This cannot be undone.')
})

Then('the reply and its attachment are removed from the activity', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-reply-delete-attachment', async () => {
    const activity = peek(page).getByRole('list', { name: 'Activity' })
    await expect(activity).not.toContainText('Edited reply')
    await expect(activity.getByRole('button', { name: 'Open red.png', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the capture composer offers a project picker', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-project-scope-picker', async () => {
    await expect(page.getByRole('combobox', { name: 'Filter by project', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Project of the new item', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the Backlog Inbox is opened', async ({ page }: { page: Page }) => {
  const inbox = page.getByRole('navigation', { name: 'Backlog views' }).getByRole('button', { name: 'Inbox' })
  await inbox.click()
  await expect(inbox).toHaveAttribute('aria-current', 'page')
})

Then('the Inbox lists {string} under {string}', async ({ page }: { page: Page }, title: string, filter: string) => {
  await recordAssertion(page, 'backlog-attention-inbox', async () => {
    const inbox = page.getByRole('region', { name: 'Inbox', exact: true })
    const filterTab = inbox.getByRole('tab', { name: new RegExp(`^${filter}`) })
    await filterTab.click()
    await expect(filterTab).toHaveAttribute('aria-selected', 'true')
    await expect(inbox.getByRole('list')).toContainText(title)
  })
  await finishJourneyAssertions(page)
})

When('Backlog smart thread routing is enabled', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Plugins')
  await page.getByRole('button', { name: 'View @dshfiles/backlog', exact: true }).click()
  const routing = page.locator('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="smartThreadRouting"]')
  const enabled = routing.getByRole('switch')
  await expect(enabled).toBeVisible()
  if (!(await enabled.isChecked())) await enabled.click()
  await expect(enabled).toBeChecked()
})

When('Backlog notifications use both channels', async ({ page }: { page: Page }) => {
  const notificationSetting = page.getByRole('radiogroup', { name: 'Thread start notifications' })
  const bothChannels = notificationSetting.getByRole('radio', { name: 'both' })
  await bothChannels.click()
  await expect(bothChannels).toBeChecked()
  await page.evaluate(() => {
    class TestNotification {
      static permission = 'granted'
      onclick: ((this: Notification, event: Event) => void) | null = null

      constructor(title: string, options?: NotificationOptions) {
        document.body.dataset.testNotification = `${title}|${options?.body ?? ''}`
      }

      close(): void {}
    }

    Object.defineProperty(window, 'Notification', { configurable: true, value: TestNotification })
  })
})

When('Backlog AI reply answers are enabled', async ({ page }: { page: Page }) => {
  const answerSetting = page.locator('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="smartReplyAnswers"]')
  const enabled = answerSetting.getByRole('switch')
  await expect(enabled).toBeVisible()
  if (!(await enabled.isChecked())) await enabled.click()
  await expect(enabled).toBeChecked()
  const preferredAgent = page.locator('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="replyAgent"] input')
  await preferredAgent.fill('reply-helper')
  await preferredAgent.press('Tab')
  await expect(preferredAgent).toHaveValue('reply-helper')
})

When('Backlog uses a configured fake-model agent for replies', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Agents: Directory')
  await page.getByRole('button', { name: 'New agent', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('reply-helper')
  await page.getByRole('textbox', { name: /^Instructions/u }).fill('Answer briefly and directly.')
  const route = page.getByRole('combobox', { name: 'Model route', exact: true })
  await route.click()
  const model = page.getByRole('option', { name: /gpt-6-luna/u })
  await expect(model).toBeVisible()
  await model.click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
})

Then('the reply starts a linked work thread with an in-app and browser notice', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-smart-reply-routing', async () => {
    await expect(page.getByRole('alert')).toContainText('Thread started for b:1', { timeout: 30_000 })
    await expect(page.locator('body')).toHaveAttribute('data-test-notification', 'Backlog thread started|b:1 · Improve the flaky test')
    await expect(peek(page).getByRole('list', { name: 'Activity' })).toContainText('Please fix the flaky test')
    await expect(peek(page).getByRole('list', { name: 'Related' }).getByRole('listitem')).toHaveCount(1)
  })
})

Then('the discussion reply gets an AI answer without starting another thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-smart-reply-discussion', async () => {
    const activity = peek(page).getByRole('list', { name: 'Activity' })
    await expect(activity).toContainText('Why is this flaky?')
    await expect(activity).toContainText('@reply-helper')
    await expect(activity).toContainText('Answered by ALPHA1', { timeout: 30_000 })
    await expect(peek(page).getByRole('list', { name: 'Related' }).getByRole('listitem')).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

When('Backlog automatic triage is configured to use the local fake model', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Plugins')
  await page.getByRole('button', { name: 'View @dshfiles/backlog', exact: true }).click()
  const settings = page.locator('[data-settings-namespace="dshfiles-backlog"]')
  await expect(settings.locator('[data-setting-path="jevSecret"]')).toBeVisible()
  await settings.locator('[data-setting-path="triageProvider"] input').fill('commandcode_work')
  await settings.locator('[data-setting-path="triageModel"] input').fill('gpt-6-luna')
  const autoTriage = settings.getByRole('switch', { name: 'Auto triage', exact: true })
  if (!(await autoTriage.isChecked())) await autoTriage.click()
  await expect(autoTriage).toBeChecked()
  await expect(settings.locator('[data-setting-path="triageProvider"] input')).toHaveValue('commandcode_work')
  await expect(settings.locator('[data-setting-path="triageModel"] input')).toHaveValue('gpt-6-luna')
  await expect(settings.locator('[data-setting-path="triageProvider"]')).toHaveAttribute('data-modified', '')
  await expect(settings.locator('[data-setting-path="triageModel"]')).toHaveAttribute('data-modified', '')
  await expect(settings.locator('[data-setting-path="autoTriage"]')).toHaveAttribute('data-modified', '')
})

When('an item with a deterministic fake triage proposal is captured', async ({ page }: { page: Page }) => {
  const capture = page.getByRole('textbox', { name: 'Capture', exact: true })
  await capture.fill('[[answer {"confidence":0.99,"title":"Automatic triage proposal"}]]')
  await capture.press('Enter')
  await expect(capture).toHaveText('')
})

Then('automatic triage applies the fake model title to the item', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-auto-triage-proposal-applied', async () => {
    await expect(row(page, 'Automatic triage proposal')).toBeVisible({ timeout: 30_000 })
    await row(page, 'Automatic triage proposal').click()
    await expect(peek(page)).toContainText('Automatic triage proposal')
    await expect(peek(page).getByRole('list', { name: 'Activity' })).toContainText('triage applied title')
  })
  await finishJourneyAssertions(page)
})

Then('the item detail links the thread that mentioned it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-lifecycle-thread-link', async () => {
    const related = peek(page).getByRole('list', { name: 'Related' })
    await expect(related.getByRole('button', { name: 'Fake thread title', exact: true })).toBeVisible()
    await expect(related.getByText('idle', { exact: true })).toBeVisible()
    await expect(peek(page).getByRole('button', { name: 'Status of b:1', exact: true })).toContainText('In progress')
  })
  await finishJourneyAssertions(page)
})

When('the comment box searches for the backlog item mention', async ({ page }: { page: Page }) => {
  const comment = peek(page).getByRole('textbox', { name: 'Comment', exact: true })
  await comment.fill('')
  await comment.pressSequentially('@target')
  await expect(peek(page).getByRole('listbox', { name: 'Reply suggestions', exact: true })).toBeVisible()
})

Then('the comment suggestions include {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-mentions-suggestion', async () => {
    await expect(peek(page).getByRole('option', { name: new RegExp(title) })).toBeVisible()
  })
})

Then('the comment suggestions fit the viewport and scroll when needed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-mention-menu-viewport', async () => {
    const menu = peek(page).getByRole('listbox', { name: 'Reply suggestions', exact: true })
    await expect(menu).toHaveCSS('overflow-y', 'auto')
    const dimensions = await menu.evaluate(element => ({
      maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
      viewportHeight: window.innerHeight,
    }))
    expect(dimensions.maxHeight).toBeGreaterThan(0)
    expect(dimensions.maxHeight).toBeLessThan(dimensions.viewportHeight)
  })
})

When('the backlog item mention is picked', async ({ page }: { page: Page }) => {
  await peek(page)
    .getByRole('option', { name: /A target for a composer reference/ })
    .click()
})

Then('the comment box contains {string}', async ({ page }: { page: Page }, value: string) => {
  await recordAssertion(page, 'backlog-mentions-inserted', async () => {
    await expect(peek(page).getByRole('textbox', { name: 'Comment', exact: true })).toHaveText(value)
  })
  await finishJourneyAssertions(page)
})

When('the Activity panel is opened from the Backlog journey', async ({ page }: { page: Page }) => {
  await openActivity(page)
})

Then('the Activity Timeline shows the backlog creation and status change', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-shared-activity-timeline', async () => {
    const creation = page.getByRole('button').filter({ hasText: 'You created b:1 Shared timeline event' }).first()
    const move = page.getByRole('button').filter({ hasText: 'You moved b:1 Shared timeline event' }).first()
    await expect(creation).toBeVisible({ timeout: 15_000 })
    await expect(move).toBeVisible({ timeout: 15_000 })
    await expect(creation).toContainText('System')
  })
  await finishJourneyAssertions(page)
})

Then('the captured item displays its project when one is available', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-capture-project-target', async () => {
    const item = row(page, 'An item captured in the current project')
    await expect(item).toBeVisible()
    const project = item.locator('[title]').filter({ hasText: /.+/ })
    await expect(async () => {
      const count = await project.count()
      expect(count === 0 || count === 1).toBe(true)
    }).toPass()
  })
  await finishJourneyAssertions(page)
})

const inlineTitle = (page: Page) => page.getByRole('textbox', { name: 'Item title', exact: true })
const itemsRow = (page: Page, id: number) => page.getByRole('row', { name: `Item b:${String(id)}`, exact: true })
const boardCard = (page: Page, id: number) => page.getByRole('article', { name: `Card b:${String(id)}`, exact: true })

When('backlog item b:{int} is double-clicked in the feed', async ({ page }: { page: Page }, id: number) => {
  await showFeed(page)
  // The centre of an entry can land on the status picker or a chip, so aim at the title row under the author line.
  await feed(page)
    .getByRole('article', { name: `Item b:${String(id)}`, exact: true })
    .dblclick({ position: { x: 160, y: 40 } })
})

Then('the feed edits item b:{int} inline without opening it', async ({ page }: { page: Page }, id: number) => {
  await recordAssertion(page, 'backlog-inline-edit-open', async () => {
    await expect(inlineTitle(page)).toHaveValue('Rename me in the feed')
    // The rename is the quick path, so the gesture must not open the item beside the feed.
    await expect(peek(page)).toHaveCount(0)
    await expect(feed(page).getByRole('article', { name: `Item b:${String(id)}`, exact: true })).toBeVisible()
  })
})

When('the inline title is replaced with {string}', async ({ page }: { page: Page }, title: string) => {
  await inlineTitle(page).fill(title)
  await inlineTitle(page).press('Enter')
})

Then('the feed titles item b:{int} {string}', async ({ page }: { page: Page }, id: number, title: string) => {
  await recordAssertion(page, 'backlog-inline-edit-saved', async () => {
    const article = feed(page).getByRole('article', { name: `Item b:${String(id)}`, exact: true })
    await expect(article).toContainText(title)
    await expect(inlineTitle(page)).toHaveCount(0)
    // Leave the peek closed: the Items and board steps below assert the gesture opens nothing.
    await expect(peek(page)).toHaveCount(0)
  })
})

When('backlog row b:{int} is double-clicked in the Items view', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('button', { name: 'Items', exact: true }).click()
  // The row's right half holds status and kind menus; the title sits just after the id column.
  await itemsRow(page, id).dblclick({ position: { x: 140, y: 20 } })
})

Then('the Items view edits b:{int} inline without opening it', async ({ page }: { page: Page }, id: number) => {
  await recordAssertion(page, 'backlog-inline-edit-items-open', async () => {
    await expect(inlineTitle(page)).toHaveValue('Renamed in the feed')
    await expect(peek(page)).toHaveCount(0)
    await expect(itemsRow(page, id)).toBeVisible()
  })
})

Then('the Items view titles b:{int} {string}', async ({ page }: { page: Page }, id: number, title: string) => {
  await recordAssertion(page, 'backlog-inline-edit-items-saved', async () => {
    await expect(itemsRow(page, id)).toContainText(title)
    await expect(inlineTitle(page)).toHaveCount(0)
  })
})

When('backlog card b:{int} is double-clicked on the board', async ({ page }: { page: Page }, id: number) => {
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  // A card's lower half holds its preview and status picker; the title sits under the top padding.
  await boardCard(page, id).dblclick({ position: { x: 100, y: 20 } })
})

Then('the board edits b:{int} inline without opening it', async ({ page }: { page: Page }, id: number) => {
  await recordAssertion(page, 'backlog-inline-edit-board-open', async () => {
    await expect(inlineTitle(page)).toHaveValue('Renamed in the table')
    await expect(peek(page)).toHaveCount(0)
    await expect(boardCard(page, id)).toBeVisible()
  })
})

Then('the board card for b:{int} is titled {string}', async ({ page }: { page: Page }, id: number, title: string) => {
  await recordAssertion(page, 'backlog-inline-edit-board-saved', async () => {
    await expect(boardCard(page, id)).toContainText(title)
    await expect(inlineTitle(page)).toHaveCount(0)
    await boardCard(page, id)
      .getByText(`b:${String(id)}`, { exact: true })
      .click()
    await expect(peek(page)).toContainText(title)
  })
  await finishJourneyAssertions(page)
})

When('Backlog Jev is enabled without a secret reference', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await page.getByRole('group', { name: 'Plugins' }).getByRole('button', { name: 'Backlog', exact: true }).click()
  const enabled = page.locator('[data-setting-path="jevEnabled"]').getByRole('switch')
  if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click()
  await expect(enabled).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('[data-setting-path="jevSecret"] [data-secret-input="reference"]')).toHaveValue('')
  await page.keyboard.press('Escape')
})

Then('the chat tail offers Jev secret setup', async ({ page }: { page: Page }) => {
  const offer = page.getByTestId('secret-setup-offer')
  await recordAssertion(page, 'backlog-jev-setup-offer-appears-when-key-is-missing', async () => {
    await expect(offer).toBeVisible({ timeout: 30_000 })
    await expect(offer).toContainText('Required secrets are missing')
    await expect(offer).toContainText('TypeSafe API key')
  })
})

When('the Jev setup offer stores and binds a synthetic value', async ({ page }: { page: Page }) => {
  const offer = page.getByTestId('secret-setup-offer')
  await offer.getByRole('button', { name: 'Set up missing secrets', exact: true }).click()
  const value = offer.getByRole('textbox', { name: 'Secret value', exact: true })
  await expect(value).toHaveAttribute('type', 'password')
  await value.fill('synthetic-jev-setup-value')
  await offer.getByRole('button', { name: 'Create and bind', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Jev key stored; only its reference was saved to Backlog.' })).toBeVisible({ timeout: 30_000 })
})

Then('Backlog stores only the secret reference for Jev', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await page.getByRole('group', { name: 'Plugins' }).getByRole('button', { name: 'Backlog', exact: true }).click()
  const reference = page.locator('[data-setting-path="jevSecret"] [data-secret-input="reference"]')
  await recordAssertion(page, 'backlog-jev-persists-reference-not-value', async () => {
    await expect(reference).toHaveValue('secret:TYPESAFE_API_KEY')
    expect(await page.locator('body').innerText()).not.toContain('synthetic-jev-setup-value')
  })
  await finishJourneyAssertions(page)
})

Then('the Jev setup journey is complete', async ({ page }: { page: Page }) => {
  await finishJourneyAssertions(page)
})
