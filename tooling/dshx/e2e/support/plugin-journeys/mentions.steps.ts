import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const NEW_THREAD_COMPOSER = 'Describe what you want to build, / commands, @ files or sessions'
const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'

const newThreadComposer = (page: Page) => page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true })
const mentionRows = (page: Page) => page.getByRole('listbox').getByRole('option')

// A click while the previous turn settles can be dropped, so the New-thread screen is awaited and the click retried.
const openNewThread = async (page: Page): Promise<void> => {
  await expect(async () => {
    await page.getByRole('button', { name: /^New (thread|session)$/i }).filter({ visible: true }).first().click()
    await expect(newThreadComposer(page)).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

const startThread = async (page: Page, text: string): Promise<void> => {
  await openNewThread(page)
  await newThreadComposer(page).fill(text)
  await newThreadComposer(page).press('Enter')
  await expect(page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true })).toBeVisible()
}

const typeInNewThread = async (page: Page, text: string): Promise<void> => {
  await openNewThread(page)
  // The New-thread screen reuses its blank Session, draft included.
  await newThreadComposer(page).click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await expect(newThreadComposer(page)).toHaveText('')
  await newThreadComposer(page).pressSequentially(text)
  await expect(mentionRows(page).first()).toBeVisible()
}

When('threads named {string} and {string} are started', async ({ page }: { page: Page }, first: string, second: string) => {
  await startThread(page, first)
  await startThread(page, second)
})

When('a new thread composer types {string}', async ({ page }: { page: Page }, text: string) => {
  await typeInNewThread(page, text)
})

Then('the first mention row is the thread {string} under the heading {string}', async ({ page }: { page: Page }, title: string, heading: string) => {
  await recordAssertion(page, 'mentions-exact-thread-first', async () => {
    await expect(page.getByText(heading, { exact: true })).toBeVisible()
    await expect(mentionRows(page).first()).toContainText(title)
    await expect(mentionRows(page).first()).not.toContainText('fix the')
  })
})

Then('only thread rows are listed under the heading {string}', async ({ page }: { page: Page }, heading: string) => {
  await recordAssertion(page, 'mentions-thread-scope', async () => {
    await expect(page.getByText(heading, { exact: true })).toBeVisible()
    await expect(mentionRows(page).filter({ hasText: 'deploy' })).toHaveCount(2)
    await expect(mentionRows(page).filter({ hasText: /\.\w+$|\/$/ })).toHaveCount(0)
  })
})

Then('no thread row is listed under the heading {string}', async ({ page }: { page: Page }, heading: string) => {
  await recordAssertion(page, 'mentions-file-scope', async () => {
    await expect(page.getByText(heading, { exact: true })).toBeVisible()
    await expect(mentionRows(page).filter({ hasText: 'deploy' })).toHaveCount(0)
  })
})

When('the highlighted mention row is picked with the keyboard', async ({ page }: { page: Page }) => {
  await newThreadComposer(page).press('ArrowDown')
  await newThreadComposer(page).press('ArrowUp')
  await newThreadComposer(page).press('Enter')
})

Then('the composer holds a native reference chip', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mentions-native-chip', async () => {
    await expect(page.locator('[data-composer-card] [data-composer-chip="reference"]')).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})
