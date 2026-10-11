import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const paletteInput = (page: Page) => paletteDialog(page).getByRole('combobox')
const paletteOption = (page: Page, name: RegExp) => paletteDialog(page).getByRole('option', { name })
const contentSearchJourneys = new WeakMap<Page, { readonly marker: string }>()

const openPalette = async (page: Page): Promise<void> => {
  await page.keyboard.press('Meta+Shift+P')
  await expect(paletteDialog(page)).toBeVisible()
}

When('the command palette is opened', async ({ page }: { page: Page }) => {
  await openPalette(page)
})

When('Cmd+K opens the command palette', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Meta+K')
  await expect(paletteDialog(page)).toBeVisible()
})

When('the command palette is reopened', async ({ page }: { page: Page }) => {
  await openPalette(page)
})

When('the palette query is {string}', async ({ page }: { page: Page }, query: string) => {
  await paletteInput(page).fill(query)
})

When('the Go to file action is selected', async ({ page }: { page: Page }) => {
  await paletteOption(page, /Go to file/).click()
})

When('the dark-theme action is selected', async ({ page }: { page: Page }) => {
  await paletteOption(page, /Use dark theme/).click()
})

Then('the New thread action is available and can run', async ({ page }: { page: Page }) => {
  const newThreadAction = paletteDialog(page).locator('[data-value="destination:@dshfiles/command-palette/new-thread"]')
  await recordAssertion(page, 'new-thread-action-is-searchable', () => expect(newThreadAction).toBeVisible())
  await newThreadAction.click()
  await recordAssertion(page, 'new-thread-action-closes-palette', () => expect(paletteDialog(page)).not.toBeVisible())
  await finishJourneyAssertions(page)
})

Then('thread search reports no matches', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-search-has-no-match-in-empty-profile', async () => {
    await expect(paletteInput(page)).toBeVisible()
    await expect(page.getByText('No matches.', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('a searchable user message is sent to a new thread', async ({ page }: { page: Page }) => {
  const marker = 'dshx-content-search-e2e-marker'
  await openPalette(page)
  await paletteInput(page).fill('New thread')
  await paletteOption(page, /New thread/).click()
  await expect(paletteDialog(page)).not.toBeVisible()

  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions' })
  await composer.fill(marker)
  await composer.press('Enter')
  await expect(page.getByText(marker, { exact: true }).first()).toBeVisible()
  contentSearchJourneys.set(page, { marker })
})

Then('thread content search finds the message and opens its thread', async ({ page }: { page: Page }) => {
  const journey = contentSearchJourneys.get(page)
  if (journey === undefined) throw new Error('No user-message thread was recorded for this content-search journey.')

  const matchingResult = paletteDialog(page).getByRole('option').filter({ hasText: journey.marker })
  await recordAssertion(page, 'thread-content-search-settles-with-matching-snippet', () =>
    expect(matchingResult).toBeVisible({ timeout: 30_000 }),
  )
  await matchingResult.click()
  await recordAssertion(page, 'thread-content-search-opens-the-matching-session', async () => {
    await expect(paletteDialog(page)).not.toBeVisible()
    await expect(page.getByRole('treeitem', { name: new RegExp(journey.marker) })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(journey.marker, { exact: true }).last()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('file search explains that the Editor plugin is unavailable', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'file-search-requires-editor-integration', () =>
    expect(page.getByText('File search needs the Editor plugin.', { exact: true })).toBeVisible(),
  )
  await finishJourneyAssertions(page)
})

Then('the registered dark-theme action is available and can run', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'registered-theme-action-is-visible', () => expect(paletteOption(page, /Use dark theme/)).toBeVisible())
  await paletteOption(page, /Use dark theme/).click()
  await recordAssertion(page, 'registered-theme-action-closes-palette', () => expect(paletteDialog(page)).not.toBeVisible())
  await finishJourneyAssertions(page)
})

Then('the recently used dark-theme action ranks first', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'recent-theme-action-ranks-before-other-actions', () =>
    expect(paletteDialog(page).getByRole('option').first()).toHaveAccessibleName(/Use dark theme/),
  )
  await finishJourneyAssertions(page)
})

Then('command, content, line, and help prefixes open their matching views', async ({ page }: { page: Page }) => {
  const input = paletteInput(page)
  await input.fill('?')
  await recordAssertion(page, 'help-prefix-routes-to-prefix-list', () =>
    expect(paletteOption(page, /Commands and destinations/)).toBeVisible(),
  )

  await input.fill('>')
  await recordAssertion(page, 'command-prefix-routes-to-commands', async () => {
    await expect(paletteDialog(page).getByText('Commands', { exact: true })).toBeVisible()
    await expect(paletteOption(page, /Use dark theme/)).toBeVisible()
  })

  await input.fill('#')
  await recordAssertion(page, 'content-prefix-routes-to-thread-content', async () => {
    await expect(input).toHaveAttribute('placeholder', 'Search what was said in threads…')
    await expect(paletteDialog(page).getByText('Thread content', { exact: true })).toBeVisible()
  })

  await input.fill(':')
  await recordAssertion(page, 'line-prefix-routes-to-line-navigation', async () => {
    await expect(input).toHaveAttribute('placeholder', 'Type a line number in the open editor file…')
    await expect(paletteDialog(page).getByText('Go to line', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
