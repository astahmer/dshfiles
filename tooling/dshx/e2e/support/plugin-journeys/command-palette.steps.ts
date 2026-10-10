import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const paletteInput = (page: Page) => paletteDialog(page).getByRole('combobox')
const paletteOption = (page: Page, name: RegExp) => paletteDialog(page).getByRole('option', { name })

const openPalette = async (page: Page): Promise<void> => {
  await page.keyboard.press('Meta+Shift+P')
  await expect(paletteDialog(page)).toBeVisible()
}

When('the command palette is opened', async ({ page }: { page: Page }) => {
  await openPalette(page)
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

Then('thread search reports no matches', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-search-has-no-match-in-empty-profile', async () => {
    await expect(paletteInput(page)).toBeVisible()
    await expect(page.getByText('No matches.', { exact: true })).toBeVisible()
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
