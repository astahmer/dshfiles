import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { sendMessage } from '../threads.js'

const goToList = (page: Page) => page.getByRole('listbox', { name: '/goto matches', exact: true })
const goToGroup = (page: Page, name: string) => goToList(page).getByRole('group', { name, exact: true })

const openGoTo = async (page: Page): Promise<void> => {
  const composer = page.getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/ })
  await composer.fill('')
  await composer.pressSequentially('/goto')
  await expect(page.getByRole('option', { name: /^Go to goto/ })).toBeVisible()
  await composer.press('Enter')
  await expect(goToList(page)).toBeVisible()
}

When('a thread named {string} is started and a blank one is opened', async ({ page }: { page: Page }, title: string) => {
  await sendMessage(page, title)
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeVisible()
})

When('the \\/goto command is opened from the composer', async ({ page }: { page: Page }) => {
  await openGoTo(page)
})

When('the AI Accounts plugin is disabled from another tab', async ({ page }: { page: Page }) => {
  const otherTab = await page.context().newPage()
  try {
    await otherTab.goto(page.url())
    const preview = otherTab.getByRole('dialog', { name: 'Preview Notice', exact: true })
    if (await preview.isVisible()) await preview.getByRole('button', { name: 'Continue', exact: true }).click()
    await otherTab.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Plugins', exact: true }).click()
    const enabled = otherTab.getByRole('switch', { name: 'Enable AI Accounts', exact: true })
    await enabled.click()
    await expect(enabled).not.toBeChecked()
  } finally {
    await otherTab.close()
  }
  await expect(page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'AI Accounts', exact: true })).toHaveCount(0)
})

Then('\\/goto offers palette actions, registered panels and only the nonblank recent thread {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'sidebar-commands-palette-actions-follow-the-palette-probe', async () => {
    await expect(goToGroup(page, 'Actions').getByRole('option')).toHaveText([/^Open command palette/, /^Search threads/])
  })
  await recordAssertion(page, 'sidebar-commands-panels-follow-registered-panels', async () => {
    await expect(goToGroup(page, 'Panels').getByRole('option')).toHaveText([/^AI Accounts/, /^Plugins/, /^Usage history/])
  })
  await recordAssertion(page, 'sidebar-commands-recent-sessions-skip-blank-threads', async () => {
    await expect(goToGroup(page, 'Sessions').getByRole('option')).toHaveCount(1)
    await expect(goToGroup(page, 'Sessions').getByRole('option')).toHaveText(new RegExp(`^${title}`))
  })
})

Then('picking a panel, the thread and the palette action each opens its target', async ({ page }: { page: Page }) => {
  await goToGroup(page, 'Panels')
    .getByRole('option', { name: /^Plugins/ })
    .click()
  await recordAssertion(page, 'sidebar-commands-panel-row-opens-the-panel', () =>
    expect(page.getByRole('heading', { name: 'Plugins', exact: true, level: 1 })).toBeVisible(),
  )
  await page
    .getByRole('treeitem', { name: /^New Session/ })
    .first()
    .click()
  await openGoTo(page)
  await goToGroup(page, 'Sessions').getByRole('option').first().click()
  await recordAssertion(page, 'sidebar-commands-session-row-opens-the-thread', () =>
    expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('goto session alpha'),
  )
  await openGoTo(page)
  await goToGroup(page, 'Actions')
    .getByRole('option', { name: /^Open command palette/ })
    .click()
  await recordAssertion(page, 'sidebar-commands-palette-row-opens-the-palette', () =>
    expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toBeVisible(),
  )
  await finishJourneyAssertions(page)
})

Then('\\/goto offers no palette actions', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'sidebar-commands-no-palette-no-actions', async () => {
    await expect(goToGroup(page, 'Panels')).toBeVisible()
    await expect(goToGroup(page, 'Actions')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('picking the AI Accounts row reports a stale panel and stays put', async ({ page }: { page: Page }) => {
  await goToGroup(page, 'Panels')
    .getByRole('option', { name: /^AI Accounts/ })
    .click()
  await recordAssertion(page, 'sidebar-commands-stale-panel-is-reported', async () => {
    await expect(page.getByRole('alert').filter({ hasText: 'That panel is no longer registered.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Plugins', exact: true, level: 1 })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
