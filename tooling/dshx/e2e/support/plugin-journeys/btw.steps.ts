import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { sendMessage, startThreadWithModel } from '../threads.js'

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'
const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'
const sideChat = (page: Page) => page.locator('[data-dshfiles-btw]')
const sideChatTab = (page: Page) => page.locator('[data-dockkit-tab]').filter({ hasText: 'btw ·' })

When('a thread on the fake model is asked {string}', async ({ page }: { page: Page }, text: string) => {
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  await sendMessage(page, text)
})

When('{string} is sent from the thread composer', async ({ page }: { page: Page }, text: string) => {
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true }).first()
  await composer.fill(text)
  await composer.press('Enter')
})

Then('a side chat tab answers on the thread\'s model while the thread keeps one message', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'btw-side-chat-answers', async () => {
    await expect(sideChatTab(page)).toContainText('btw · what was my first question?')
    await expect(sideChat(page).getByText('what was my first question?', { exact: true })).toBeVisible()
    await expect(sideChat(page).getByText(/^Answered by /).last()).toBeVisible()
    // The fork carries the thread's history, so the provider saw the first question before the side one.
    const btwRequest = fakeCommandCodeFor(page).requests.filter(request => request.kind === 'turn').at(-1)
    expect(btwRequest?.messages.map(message => message.text).join('\n')).toContain('first question')
  })
  await recordAssertion(page, 'btw-side-chat-keeps-the-model', async () => {
    await expect(sideChat(page).getByRole('button', { name: new RegExp(`^Select model, current ${FAKE_MODEL.replaceAll('/', '\\/')}`) })).toBeVisible()
  })
  await recordAssertion(page, 'btw-main-thread-untouched', async () => {
    const main = page.locator('[data-conversation-session]').first()
    await expect(main.getByText('what was my first question?', { exact: true })).toHaveCount(0)
  })
})

When('the side chat tab is closed', async ({ page }: { page: Page }) => {
  await sideChatTab(page).hover()
  await sideChatTab(page).locator('button, [role=button]').last().click()
})

Then('the side chat tab is gone', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'btw-tab-closed', async () => {
    await expect(sideChatTab(page)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
