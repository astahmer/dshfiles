import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion, browserDiagnosticsFor } from '../steps.js'
import { sendMessage, startThreadWithModel } from '../threads.js'

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'
const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'
const sideChat = (page: Page) => page.locator('[data-dshfiles-btw]')
const sideChatTab = (page: Page) => page.locator('[data-dockkit-tab]').filter({ hasText: 'btw ·' })
const questionDialog = (page: Page) => page.getByRole('dialog', { name: 'Ask a side question', exact: true })
const ASK_LABEL = 'Ask a side question (btw)'
const threadComposer = (page: Page) => page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true }).first()
const commandChip = (page: Page) => page.locator('[data-composer-command="btw"]')

When('a thread on the fake model is asked {string}', async ({ page }: { page: Page }, text: string) => {
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  await sendMessage(page, text)
})

When('{string} is sent from the thread composer', async ({ page }: { page: Page }, text: string) => {
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true }).first()
  await composer.fill(text)
  await composer.press('Enter')
})

Then("a side chat tab answers on the thread's model while the thread keeps one message", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'btw-side-chat-answers', async () => {
    await expect(sideChatTab(page)).toContainText('btw · what was my first question?')
    await expect(sideChat(page).getByText('what was my first question?', { exact: true })).toBeVisible()
    await expect(
      sideChat(page)
        .getByText(/^Answered by /)
        .last(),
    ).toBeVisible()
    // The fork carries the thread's history, so the provider saw the first question before the side one.
    const btwRequest = fakeCommandCodeFor(page)
      .requests.filter(request => request.kind === 'turn')
      .at(-1)
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

When('the side question is opened from the command palette', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Meta+Shift+P')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('btw')
  await palette.getByRole('option', { name: new RegExp(`^${ASK_LABEL.replace(/[()]/g, '\\$&')}`) }).click()
})

When('the side question is opened with its shortcut', async ({ page }: { page: Page }) => {
  await page.keyboard.press('ControlOrMeta+Alt+Slash')
})

When('the side question is opened from the composer chip', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: ASK_LABEL, exact: true }).click()
})

Then('the side question dialog from the {word} is about the thread and cancels without a fork', async ({ page }: { page: Page }, entry: string) => {
  await recordAssertion(page, `btw-ask-dialog-from-${entry}-names-the-thread`, async () => {
    await expect(questionDialog(page)).toContainText(/About “.+”/)
    await expect(questionDialog(page).getByRole('textbox', { name: 'Side question', exact: true })).toBeFocused()
  })
  await questionDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await recordAssertion(page, `btw-ask-cancel-from-${entry}-forks-nothing`, async () => {
    await expect(questionDialog(page)).toHaveCount(0)
    await expect(sideChatTab(page)).toHaveCount(0)
  })
})

When('{string} is asked in the side question dialog', async ({ page }: { page: Page }, question: string) => {
  await questionDialog(page).getByRole('textbox', { name: 'Side question', exact: true }).fill(question)
  await questionDialog(page).getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(questionDialog(page)).toHaveCount(0)
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

When('{string} is typed in the thread composer without sending it', async ({ page }: { page: Page }, text: string) => {
  const composer = threadComposer(page)
  await composer.fill(text)
  await composer.press('Enter')
  // The trigger menu's Enter picks the row and leaves the command chip; typing then fills its arguments.
  await expect(commandChip(page)).toHaveCount(1)
  await composer.pressSequentially('what was my first question?')
})

Then('the thread composer holds the command chip', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'btw-command-chip-typed', async () => {
    await expect(commandChip(page)).toHaveCount(1)
    await expect(threadComposer(page)).toContainText('what was my first question?')
  })
})

When('the page is reloaded', async ({ page }: { page: Page }) => {
  await page.reload()
  await threadComposer(page).waitFor({ state: 'visible' })
})

Then('the thread composer restores the command chip without an input error', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'btw-command-chip-restored', async () => {
    // The persisted draft seeds a command chip, which the trigger pipeline rebuilds through resolveClaim.
    await expect(commandChip(page)).toHaveCount(1)
    await expect(threadComposer(page)).toContainText('what was my first question?')
    expect(browserDiagnosticsFor(page).filter(line => line.includes('resolveClaim'))).toEqual([])
  })
  await finishJourneyAssertions(page)
})
