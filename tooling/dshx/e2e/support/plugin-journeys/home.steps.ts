import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

// The native hero names its headline only by a hashed CSS-module class; the home brand style keys on the same suffix.
const heroHeadline = (page: Page) => page.locator('[class*="_headline"]').first()
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })

const openNewThreadSettings = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await settingsDialog(page).getByRole('button', { name: 'New thread', exact: true }).click()
  await expect(settingsDialog(page).getByRole('textbox', { name: 'Headline', exact: true })).toBeVisible()
}

const closeSettings = async (page: Page): Promise<void> => {
  await settingsDialog(page).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(settingsDialog(page)).toBeHidden()
}

When('the New thread headline is set to {string} with the mark {string}', async ({ page }: { page: Page }, headline: string, mark: string) => {
  await openNewThreadSettings(page)
  const dialog = settingsDialog(page)
  const headlineInput = dialog.getByRole('textbox', { name: 'Headline', exact: true })
  await headlineInput.fill(headline)
  await headlineInput.blur()
  await dialog.getByRole('combobox', { name: 'Mark', exact: true }).click()
  await page.getByRole('option', { name: 'Text or emoji', exact: true }).click()
  const markInput = dialog.getByRole('textbox', { name: 'Mark text', exact: true })
  await markInput.fill(mark)
  await markInput.blur()
  await closeSettings(page)
})

When('recent threads are turned off in the New thread settings', async ({ page }: { page: Page }) => {
  await openNewThreadSettings(page)
  const recentThreads = settingsDialog(page).getByRole('switch', { name: 'Recent threads', exact: true })
  await recentThreads.click()
  await expect(recentThreads).not.toBeChecked()
  await closeSettings(page)
})

// The work-to-rebase count is cached for a minute per project (each New thread remounts the strip), so the revision
// described a moment ago shows only on a fresh read; a reload stands in for the agent's next turn.
When('the page is reloaded so the home screen reads the thread workspaces afresh', async ({ page }: { page: Page }) => {
  await page.reload()
})

When('a new thread is started from the sidebar', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeVisible()
})

Then('the New thread headline names the project {string} instead of the DeepSeek headline', async ({ page }: { page: Page }, project: string) => {
  await recordAssertion(page, 'home-headline-names-the-selected-project', async () => {
    await expect(heroHeadline(page)).toContainText(project)
    await expect(page.getByText('Into the Unknown', { exact: true })).toBeHidden()
  })
})

Then('the New thread screen shows the mark {string} and the headline {string}', async ({ page }: { page: Page }, mark: string, headline: string) => {
  await recordAssertion(page, 'home-settings-replace-the-mark-and-headline', async () => {
    await expect(heroHeadline(page).getByText(mark, { exact: true })).toBeVisible()
    await expect(heroHeadline(page).getByText(headline, { exact: true })).toBeVisible()
  })
  await page.reload()
  await recordAssertion(page, 'home-brand-settings-survive-reload', () => expect(heroHeadline(page).getByText(headline, { exact: true })).toBeVisible())
})

Then('the thread details do not show the New thread shortcuts', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'home-strip-stays-hidden-in-thread-details', async () => {
    await expect(page.getByText('Resume', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /threads? has work to rebase/ })).toHaveCount(0)
  })
})

Then('the New thread screen offers to resume {string} and reports one thread with work to rebase', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'home-strip-lists-the-project-recent-thread', async () => {
    await expect(page.getByText('Resume', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  })
  await recordAssertion(page, 'home-strip-counts-thread-workspaces-with-work-to-rebase', () =>
    expect(page.getByRole('button', { name: '1 thread has work to rebase', exact: true })).toBeVisible(),
  )
})

Then('the resume list appears below the chat composer', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'home-resume-list-follows-composer', async () => {
    const resume = await page.getByText('Resume', { exact: true }).boundingBox()
    const sendMessage = await page.getByRole('button', { name: 'Send message', exact: true }).boundingBox()
    if (resume === null || sendMessage === null) throw new Error('Resume or composer control is not visible')
    expect(resume.y).toBeGreaterThan(sendMessage.y + sendMessage.height)
  })
})

Then('the work to rebase opens the Thread workspaces panel', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: '1 thread has work to rebase', exact: true }).click()
  await recordAssertion(page, 'home-work-to-rebase-opens-thread-workspaces', async () => {
    await expect(page.getByRole('heading', { name: 'Thread integration', exact: true })).toBeVisible()
    await expect(page.getByText('1 revision(s)', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the New thread screen no longer offers to resume {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'home-recent-threads-setting-hides-the-resume-list', async () => {
    await expect(page.getByRole('button', { name: '1 thread has work to rebase', exact: true })).toBeVisible()
    await expect(page.getByText('Resume', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0)
  })
})
