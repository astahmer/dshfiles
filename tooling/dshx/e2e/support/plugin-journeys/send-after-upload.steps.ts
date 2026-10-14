import { expect, type Page, type Route } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const ATTACHMENT_FIXTURES = fileURLToPath(new URL('../../fixtures/attachments/', import.meta.url))
const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'
const UPLOAD_ROUTE = '**/api/session/uploadFileBinary**'

const held = new WeakMap<Page, Route[]>()
const threadComposer = (page: Page) => page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true })
const banner = (page: Page) => page.getByTestId('dshfiles-pending-send')
// A sent user message, never the composer's own draft.
const userBubble = (page: Page, text: string) => page.locator('[data-conversation-session]:visible [class*="_userRow"]').getByText(text, { exact: true })

const attachHeldFile = async (page: Page, text: string): Promise<void> => {
  await threadComposer(page).fill(text)
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles(join(ATTACHMENT_FIXTURES, 'note.txt'))
  await expect(page.getByText('Uploading…').first()).toBeVisible()
}

const releaseUploads = async (page: Page): Promise<void> => {
  const routes = held.get(page) ?? []
  held.set(page, [])
  for (const route of routes) await route.continue()
}

When('a thread is started and its file upload is held', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: /^New (thread|session)$/i }).filter({ visible: true }).first().click()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('upload thread')
  await composer.press('Enter')
  await expect(threadComposer(page)).toBeVisible()
  held.set(page, [])
  await page.route(UPLOAD_ROUTE, route => {
    held.get(page)?.push(route)
  })
})

When('{string} is typed with the file attached and Enter is pressed', async ({ page }: { page: Page }, text: string) => {
  await attachHeldFile(page, text)
  await threadComposer(page).press('Enter')
})

Then('the composer shows {string} and keeps the draft', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'send-after-upload-banner', async () => {
    await expect(banner(page)).toContainText(text)
    await expect(threadComposer(page)).not.toHaveText('')
  })
})

When('the upload finishes', async ({ page }: { page: Page }) => {
  await releaseUploads(page)
})

Then('{string} is sent with its file', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'send-after-upload-sends-when-ready', async () => {
    await expect(userBubble(page, text)).toBeVisible()
    await expect(page.locator('[data-message-attachments]').getByText('note.txt')).toBeVisible()
    await expect(banner(page)).toHaveCount(0)
    await expect(threadComposer(page)).toHaveText('')
  })
})

When('{string} is typed with a held file attached and Enter is pressed', async ({ page }: { page: Page }, text: string) => {
  await attachHeldFile(page, text)
  await threadComposer(page).press('Enter')
  await expect(banner(page)).toBeVisible()
})

When('the draft is edited', async ({ page }: { page: Page }) => {
  await threadComposer(page).press('End')
  await threadComposer(page).pressSequentially('!')
})

Then('the pending send is cancelled and nothing is sent after the upload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'send-after-upload-edit-cancels', async () => {
    await expect(banner(page)).toHaveCount(0)
    await releaseUploads(page)
    await page.waitForTimeout(1_000)
    await expect(userBubble(page, 'second try!')).toHaveCount(0)
    await expect(threadComposer(page)).toHaveText('second try!')
  })
})

When('Enter is pressed with a held file attached and then Escape', async ({ page }: { page: Page }) => {
  await attachHeldFile(page, 'third try')
  await threadComposer(page).press('Enter')
  await expect(banner(page)).toBeVisible()
  await threadComposer(page).press('Escape')
})

Then('the pending send is cancelled', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'send-after-upload-escape-cancels', async () => {
    await expect(banner(page)).toHaveCount(0)
  })
})

When('the disabled Send button is pressed while the file uploads', async ({ page }: { page: Page }) => {
  const send = page.locator('[data-composer-card] button[class*="_primary"]:visible')
  await expect(send).toBeDisabled()
  await send.click({ force: true })
})

Then('the Send press queues the send too', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'send-after-upload-send-button', async () => {
    await expect(banner(page)).toContainText('Sending when upload finishes…')
  })
  await finishJourneyAssertions(page)
})
