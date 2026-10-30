import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { selectModelForNewThread } from '../threads.js'

const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const paletteInput = (page: Page) => paletteDialog(page).getByRole('combobox')
const paletteOption = (page: Page, name: RegExp) => paletteDialog(page).getByRole('option', { name })
const contentSearchJourneys = new WeakMap<Page, { readonly marker: string; readonly releasePrompt: () => void }>()

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

When('the Threads tab is selected', async ({ page }: { page: Page }) => {
  await paletteDialog(page).getByRole('tab', { name: 'Threads' }).click()
})

When('the Everything tab is selected', async ({ page }: { page: Page }) => {
  await paletteDialog(page).getByRole('tab', { name: 'Everything' }).click()
})

When('Escape is pressed in the command palette', async ({ page }: { page: Page }) => {
  await paletteInput(page).press('Escape')
})

When('the Go to file action is selected', async ({ page }: { page: Page }) => {
  await paletteOption(page, /Go to file/).click()
})

When('the dark-theme action is selected', async ({ page }: { page: Page }) => {
  await paletteOption(page, /Use dark theme/).click()
})

Then('the notification sound mute palette action toggles both ways', async ({ page }: { page: Page }) => {
  const dialog = paletteDialog(page)
  const muteAction = paletteOption(page, /^Mute notification sounds\b/u)
  await recordAssertion(page, 'notification-sound-mute-action-is-searchable', () => expect(muteAction).toBeVisible())
  await muteAction.click()
  await expect(dialog).not.toBeVisible()
  await openPalette(page)
  await paletteInput(page).fill('Unmute notification sounds')
  const unmuteAction = paletteOption(page, /^Unmute notification sounds\b/u)
  await recordAssertion(page, 'notification-sound-unmute-action-is-searchable', () => expect(unmuteAction).toBeVisible())
  await unmuteAction.click()
  await expect(dialog).not.toBeVisible()
  await openPalette(page)
  await paletteInput(page).fill('Mute notification sounds')
  await recordAssertion(page, 'notification-sound-action-returns-to-mute-state', () => expect(muteAction).toBeVisible())
  await finishJourneyAssertions(page)
})

Then('the New thread action is available and can run', async ({ page }: { page: Page }) => {
  const newThreadAction = paletteDialog(page).locator('[data-value="destination:@dshfiles/command-palette/new-thread"]')
  await recordAssertion(page, 'new-thread-action-is-searchable', () => expect(newThreadAction).toBeVisible())
  await newThreadAction.click()
  await recordAssertion(page, 'new-thread-action-closes-palette', () => expect(paletteDialog(page)).not.toBeVisible())
  await finishJourneyAssertions(page)
})

Then('the Backlog capture composer opens with {string}', async ({ page }: { page: Page }, text: string) => {
  const dialog = paletteDialog(page)
  await paletteOption(page, new RegExp(`Open capture composer: ${text}`, 'u')).click()
  await recordAssertion(page, 'backlog-prefix-opens-capture-composer-with-draft', async () => {
    await expect(dialog).not.toBeVisible()
    const capture = page.getByRole('textbox', { name: 'Capture' })
    await expect(capture).toBeVisible()
    await expect(capture).toHaveValue(text)
    await expect(page.getByRole('button', { name: 'Add a file or a reference' })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('Everything, Threads, Files, and Backlog tabs are available', async ({ page }: { page: Page }) => {
  const tabs = paletteDialog(page).getByRole('tab')
  await recordAssertion(page, 'palette-search-tabs-are-visible', async () => {
    await expect(tabs).toHaveCount(4)
    await expect(tabs.nth(0)).toHaveAccessibleName('Everything')
    await expect(tabs.nth(1)).toHaveAccessibleName('Threads')
    await expect(tabs.nth(2)).toHaveAccessibleName('Files')
    await expect(tabs.nth(3)).toHaveAccessibleName('Backlog')
  })
})

Then('the Threads tab is active', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-search-tab-is-selected', () =>
    expect(paletteDialog(page).getByRole('tab', { name: 'Threads' })).toHaveAttribute('aria-selected', 'true'),
  )
})

Then('the thread prefix opens a backable thread subview', async ({ page }: { page: Page }) => {
  const dialog = paletteDialog(page)
  await recordAssertion(page, 'thread-prefix-enters-thread-subview', async () => {
    await expect(dialog.getByRole('button', { name: 'Back' })).toBeVisible()
    await expect(dialog.getByText('Threads', { exact: true })).toBeVisible()
    await expect(
      dialog.getByText('Session session-e2e-missing was not found. It may have been deleted or belong to another profile.', { exact: true }),
    ).toBeVisible()
  })
})

Then('the palette returns to Threads search', async ({ page }: { page: Page }) => {
  const dialog = paletteDialog(page)
  await recordAssertion(page, 'escape-returns-to-parent-thread-search', async () => {
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('tab', { name: 'Threads' })).toHaveAttribute('aria-selected', 'true')
    await expect(paletteInput(page)).toHaveValue('session-e2e-missing')
    await expect(dialog.getByRole('button', { name: 'Back' })).toHaveCount(0)
  })
})

Then('Escape clears the palette query without closing it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'escape-clears-root-query', async () => {
    await expect(paletteInput(page)).toHaveValue('')
    await expect(paletteDialog(page)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the palette reports that session {string} was not found', async ({ page }: { page: Page }, sessionId: string) => {
  await recordAssertion(page, 'session-link-reports-an-unknown-session-without-query-data', () =>
    expect(
      paletteDialog(page).getByText(`Session ${sessionId} was not found. It may have been deleted or belong to another profile.`, { exact: true }),
    ).toBeVisible(),
  )
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
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')

  let releasePrompt: () => void = () => {}
  const promptGate = new Promise<void>(resolve => {
    releasePrompt = () => resolve()
  })
  await page.route('**/api/session/prompt', async route => {
    await promptGate
    await route.continue()
  })
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions' })
  await composer.fill(marker)
  await composer.press('Enter')
  await expect(page.getByText(marker, { exact: true }).first()).toBeVisible()
  contentSearchJourneys.set(page, { marker, releasePrompt })
})

Then('thread content search finds the message and opens its thread', async ({ page }: { page: Page }) => {
  const journey = contentSearchJourneys.get(page)
  if (journey === undefined) throw new Error('No user-message thread was recorded for this content-search journey.')

  const matchingResult = paletteDialog(page).getByRole('option').filter({ hasText: journey.marker })
  try {
    await recordAssertion(page, 'thread-content-search-first-observes-pending-submission-as-empty', () =>
      expect(paletteDialog(page).getByText('No matches.', { exact: true })).toBeVisible({ timeout: 30_000 }),
    )
  } finally {
    journey.releasePrompt()
  }
  await recordAssertion(page, 'thread-content-search-refreshes-after-host-accepts-message', () => expect(matchingResult).toBeVisible({ timeout: 30_000 }))
  await page.unroute('**/api/session/prompt')
  await matchingResult.click()
  await recordAssertion(page, 'thread-content-search-opens-the-matching-session', async () => {
    await expect(paletteDialog(page)).not.toBeVisible()
    await expect(page.getByRole('treeitem', { name: /^Fake thread title/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(journey.marker, { exact: true }).last()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the Ask DSH entry appears on the empty palette', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ask-dsh-entry-is-visible-on-an-empty-palette', async () => {
    const entry = paletteDialog(page).getByRole('button', { name: 'Ask DSH', exact: true })
    await expect(entry).toBeVisible()
    await expect(entry.getByText('Tab', { exact: true })).toBeVisible()
  })
})

When('Tab is pressed in the command palette', async ({ page }: { page: Page }) => {
  await paletteInput(page).press('Tab')
})

Then('the palette asks for an Ask DSH question', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'tab-opens-the-ask-dsh-bar', async () => {
    await expect(paletteInput(page)).toHaveAttribute('placeholder', 'Ask DSH anything about using or operating it…')
    await expect(paletteDialog(page).getByText('Type a question about DSH, then press Enter.', { exact: true })).toBeVisible()
  })
})

When('the Ask DSH question {string} is sent', async ({ page }: { page: Page }, question: string) => {
  await paletteInput(page).fill(question)
  await paletteDialog(page)
    .getByRole('option', { name: `Ask DSH: ${question}` })
    .click()
  await expect(paletteDialog(page)).not.toBeVisible()
})

Then('a new thread opens with that question', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ask-dsh-opens-its-new-thread-with-the-question', async () => {
    await expect(page.getByText('how do I rebind a shortcut?', { exact: true }).last()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Ask DSH · how do I rebind a shortcut?', { exact: true }).last()).toBeVisible()
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

Then('selecting active light and dark actions toggles the theme', async ({ page }: { page: Page }) => {
  const selectTheme = async (name: RegExp) => {
    await openPalette(page)
    await paletteInput(page).fill('>')
    await paletteOption(page, name).click()
    await expect(paletteDialog(page)).not.toBeVisible()
  }
  const isDark = async () => page.locator('body').evaluate(body => body.hasAttribute('data-ds-dark-theme'))

  await selectTheme(/Use light theme/)
  await recordAssertion(page, 'light-action-selects-light', async () => expect.poll(isDark).toBe(false))
  await selectTheme(/Use light theme/)
  await recordAssertion(page, 'active-light-action-toggles-to-dark', async () => expect.poll(isDark).toBe(true))
  await selectTheme(/Use dark theme/)
  await recordAssertion(page, 'active-dark-action-toggles-to-light', async () => expect.poll(isDark).toBe(false))
  await selectTheme(/Use dark theme/)
  await recordAssertion(page, 'dark-action-selects-dark', async () => expect.poll(isDark).toBe(true))
  await finishJourneyAssertions(page)
})

Then('the contributed Toggle sidebar command is listed with its keys and runs', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'contributed-command-is-listed', () => expect(paletteOption(page, /Toggle sidebar/)).toBeVisible())
  await paletteOption(page, /Toggle sidebar/).click()
  await recordAssertion(page, 'contributed-command-closes-palette', () => expect(paletteDialog(page)).not.toBeVisible())
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
  await recordAssertion(page, 'help-prefix-routes-to-prefix-list', () => expect(paletteOption(page, /Commands and destinations/)).toBeVisible())

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

Then('the empty palette suggests {string} with the keys {string}', async ({ page }: { page: Page }, title: string, keys: string) => {
  const option = paletteOption(page, new RegExp(title))
  await recordAssertion(page, 'suggested-command-shows-before-typing', () => expect(option).toBeVisible())
  await recordAssertion(page, 'suggested-command-shows-effective-keys', () => expect(option).toContainText(keys))
  await finishJourneyAssertions(page)
})
