import { expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'

const COMPOSER_LABEL = 'Describe what you want to build, / commands, @ files or sessions'

const composerInput = ({ page }: { page: Page }) => page.getByRole('textbox', { name: COMPOSER_LABEL, exact: true })

const promptOption = ({ page, title }: { page: Page; title: string }) => page.getByRole('option', { name: title, exact: false })

const openPromptLibrary = async ({ page }: { page: Page }): Promise<void> => {
  await page.getByRole('button', { name: 'Prompts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved prompts', exact: true })).toBeVisible()
}

const createSavedPrompt = async ({ page, title, text }: { page: Page; title: string; text: string }): Promise<void> => {
  await page.getByRole('button', { name: 'New prompt', exact: true }).click()
  await expect(page.getByLabel('Prompt text', { exact: true })).toBeFocused()
  await page.getByLabel('Label (optional)', { exact: true }).fill(title)
  await page.getByLabel('Prompt text', { exact: true }).fill(text)
  await page.getByRole('button', { name: 'Save prompt', exact: true }).click()
  await expect(promptOption({ page, title })).toBeVisible()
}

const openPromptForEditing = async ({ page, title }: { page: Page; title: string }): Promise<void> => {
  const prompt = promptOption({ page, title })
  await prompt.hover()
  await prompt.getByRole('button', { name: 'Edit', exact: true }).click()
}

const composerText = async ({ page }: { page: Page }): Promise<string> => (await composerInput({ page }).innerText()).trim()

When('the prompt library is opened', async ({ page }: { page: Page }) => {
  await openPromptLibrary({ page })
})

When('a saved prompt {string} with text {string} is created', async ({ page }: { page: Page }, title: string, text: string) => {
  await createSavedPrompt({ page, title, text })
})

When('the composer text {string} is saved as a prompt', async ({ page }: { page: Page }, text: string) => {
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  const composer = composerInput({ page })
  await composer.click()
  await composer.fill(text)
  await page.getByRole('button', { name: 'Prompts', exact: true }).click()
  await page.getByRole('button', { name: 'Save current', exact: true }).click()
})

Then('current composer text {string} remains and prompt {string} is saved', async ({ page }: { page: Page }, text: string, title: string) => {
  await recordAssertion(page, 'prompt-library-save-current-preserves-composer', async () => {
    await expect(composerInput({ page })).toHaveText(text)
    await expect(promptOption({ page, title })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Current composer text saved as a prompt. The composer was not changed.')
  })
  await finishJourneyAssertions(page)
})

When('the saved prompts are searched for {string}', async ({ page }: { page: Page }, query: string) => {
  await page.getByPlaceholder('Search saved prompts', { exact: true }).fill(query)
})

Then('only the saved prompt {string} is listed', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'prompt-library-search-filters-by-title', async () => {
    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(promptOption({ page, title })).toBeVisible()
  })
})

When(
  'the saved prompt {string} is edited to {string} with text {string}',
  async ({ page }: { page: Page }, currentTitle: string, title: string, text: string) => {
    await openPromptForEditing({ page, title: currentTitle })
    await page.getByLabel('Label (optional)', { exact: true }).fill(title)
    await page.getByLabel('Prompt text', { exact: true }).fill(text)
    await page.getByRole('button', { name: 'Save prompt', exact: true }).click()
  },
)

Then('the saved prompt {string} is listed with text {string}', async ({ page }: { page: Page }, title: string, text: string) => {
  await recordAssertion(page, 'prompt-library-edit-is-visible-in-list', async () => {
    await expect(promptOption({ page, title })).toContainText(text)
  })
})

When('deletion of the saved prompt {string} is canceled', async ({ page }: { page: Page }, title: string) => {
  const prompt = promptOption({ page, title })
  await prompt.hover()
  await prompt.getByRole('button', { name: 'Delete', exact: true }).click()
  await prompt.getByRole('button', { name: 'Confirm delete', exact: true }).waitFor({ state: 'visible' })
  await prompt.getByRole('button', { name: 'Keep', exact: true }).click()
})

Then('the saved prompt {string} remains listed', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'prompt-library-delete-cancel-keeps-prompt', () => expect(promptOption({ page, title })).toBeVisible())
})

When('the saved prompt {string} is deleted', async ({ page }: { page: Page }, title: string) => {
  const prompt = promptOption({ page, title })
  await prompt.hover()
  await prompt.getByRole('button', { name: 'Delete', exact: true }).click()
  await prompt.getByRole('button', { name: 'Confirm delete', exact: true }).click()
})

Then('the saved prompt {string} is no longer listed', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'prompt-library-confirmed-delete-removes-prompt', () => expect(promptOption({ page, title })).toHaveCount(0))
})

When('the saved prompt {string} is opened for editing', async ({ page }: { page: Page }, title: string) => {
  await openPromptForEditing({ page, title })
})

When('the prompt editor is changed to title {string} and text {string}', async ({ page }: { page: Page }, title: string, text: string) => {
  await page.getByLabel('Label (optional)', { exact: true }).fill(title)
  await page.getByLabel('Prompt text', { exact: true }).fill(text)
})

When(
  'the saved prompt {string} is changed in another tab to title {string} and text {string}',
  async ({ page }: { page: Page }, currentTitle: string, title: string, text: string) => {
    const otherTab = await page.context().newPage()
    try {
      await otherTab.goto(page.url(), { waitUntil: 'domcontentloaded' })
      await otherTab.getByRole('button', { name: 'Prompts', exact: true }).waitFor({ state: 'visible' })

      const previewNotice = otherTab.getByRole('dialog', { name: 'Preview Notice', exact: true })
      if (await previewNotice.isVisible()) {
        await previewNotice.getByRole('button', { name: 'Continue', exact: true }).click()
      }

      await StartupDialogs.dismissProviderSetupDuringStartup(otherTab)

      await openPromptLibrary({ page: otherTab })
      await openPromptForEditing({ page: otherTab, title: currentTitle })
      await otherTab.getByLabel('Label (optional)', { exact: true }).fill(title)
      await otherTab.getByLabel('Prompt text', { exact: true }).fill(text)
      await otherTab.getByRole('button', { name: 'Save prompt', exact: true }).click()
      await expect(promptOption({ page: otherTab, title })).toBeVisible()
    } finally {
      await otherTab.close()
    }
  },
)

Then('the local editor is marked stale and keeps its edits', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'prompt-library-conflict-preserves-local-editor', async () => {
    await expect(page.getByText('The saved version changed elsewhere. Your edits remain here.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Label (optional)', { exact: true })).toHaveValue('Local draft')
    await expect(page.getByLabel('Prompt text', { exact: true })).toHaveValue('Local edits stay in this editor.')
    await expect(page.getByRole('button', { name: 'Save as new copy', exact: true })).toBeVisible()
  })
})

When('the local edits are saved as a separate copy', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Save as new copy', exact: true }).click()
})

Then('both the updated prompt and local copy remain listed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'prompt-library-conflict-keeps-updated-original-and-copy', async () => {
    await expect(page.getByRole('option')).toHaveCount(2)
    await expect(promptOption({ page, title: 'Updated elsewhere' })).toBeVisible()
    await expect(promptOption({ page, title: 'Local draft' })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the composer contains {string} with its cursor before {string}', async ({ page }: { page: Page }, text: string, finalWord: string) => {
  const composer = composerInput({ page })
  await composer.fill(text)
  for (let index = 0; index < finalWord.length; index += 1) await composer.press('ArrowLeft')
})

When('the saved prompt {string} is inserted', async ({ page }: { page: Page }, title: string) => {
  await promptOption({ page, title }).click()
})

Then('the composer contains {string} and confirms no message was sent', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'prompt-library-inserts-at-captured-cursor-without-sending', async () => {
    await expect(composerInput({ page })).toHaveText(text)
    await expect(page.getByText('Inserted at the saved cursor position. The message was not sent.', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the recent messages tab is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: /^Recent here/ }).click()
  await expect(page.getByRole('heading', { name: 'Recent messages', exact: true })).toBeVisible()
})

Then('the recent list explains that no sent text prompts are loaded', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'recent-prompts-explain-empty-loaded-conversation', async () => {
    await expect(page.getByRole('tab', { name: 'Recent here (0)', exact: true })).toBeVisible()
    await expect(page.getByText('No sent text prompts are loaded from this conversation.', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the empty draft panel is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Saved drafts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved drafts', exact: true })).toBeVisible()
})

Then('saving is disabled for an empty draft and sent history is empty', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'empty-draft-cannot-be-saved-and-sent-history-is-empty', async () => {
    await expect(page.getByRole('button', { name: 'Save current', exact: true })).toBeDisabled()
    await expect(page.getByText('No saved drafts yet.', { exact: true })).toBeVisible()
    await expect(page.getByText('No sent text prompts are loaded for this session.', { exact: true })).toBeVisible()
  })
})

When('the composer text {string} is saved as {string}', async ({ page }: { page: Page }, text: string, title: string) => {
  const composer = composerInput({ page })
  await composer.click()
  await composer.fill(text)
  await page.getByRole('button', { name: 'Saved drafts', exact: true }).click()
  await page.getByLabel('Draft title', { exact: true }).fill(title)
  await page.getByRole('button', { name: 'Save current', exact: true }).click()
})

Then('saving leaves the current composer text unchanged', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'saving-draft-keeps-current-composer-text', async () => {
    await expect(composerInput({ page })).toHaveText('Draft body to keep')
    await expect(page.getByRole('status')).toHaveText('Saved to the thread-sidebar stash. The composer draft remains unchanged.')
  })
})

When('the composer is cleared and the saved draft {string} is restored', async ({ page }: { page: Page }, title: string) => {
  const composer = composerInput({ page })
  await composer.click()
  await composer.press('ControlOrMeta+A')
  await composer.press('Backspace')
  await page.getByRole('button', { name: 'Saved drafts', exact: true }).click()
  await promptOption({ page, title }).click()
})

Then('the draft is restored without sending and can be removed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'saved-draft-restores-text-without-sending', async () => {
    await expect(composerInput({ page })).toHaveText('Draft body to keep')
    await expect(page.getByRole('status')).toHaveText('Inserted at the saved composer position. Existing text and attachments were kept.')
  })

  const removeButton = page.getByRole('button', { name: 'Remove Planning prompt', exact: true })
  await removeButton.hover()
  await removeButton.click()
  await recordAssertion(page, 'removed-draft-leaves-empty-draft-list', () => expect(page.getByText('No saved drafts yet.', { exact: true })).toBeVisible())
  await finishJourneyAssertions(page)
})

const THREAD_COMPOSER_LABEL = 'Message or run a task, / commands, @ files or sessions'
const ATTACHMENT_FIXTURES = fileURLToPath(new URL('../../fixtures/attachments/', import.meta.url))
const threadComposer = ({ page }: { page: Page }) => page.getByRole('textbox', { name: THREAD_COMPOSER_LABEL, exact: true })
const removeAttachment = ({ page, name }: { page: Page; name: string }) => page.getByRole('button', { name, exact: true })

const startThread = async ({ page, text }: { page: Page; text: string }): Promise<void> => {
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click()
  await composerInput({ page }).fill(text)
  await composerInput({ page }).press('Enter')
  await expect(threadComposer({ page })).toBeVisible()
}

When('a thread drafts {string} with an image and a file attached', async ({ page }: { page: Page }, text: string) => {
  await startThread({ page, text: 'Attachment draft thread' })
  await threadComposer({ page }).fill(text)
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles([join(ATTACHMENT_FIXTURES, 'red.png'), join(ATTACHMENT_FIXTURES, 'note.txt')])
  await expect(removeAttachment({ page, name: 'Remove image red.png' })).toBeVisible()
  await expect(removeAttachment({ page, name: 'Remove file note.txt' })).toBeVisible()
})

When('another thread is opened', async ({ page }: { page: Page }) => {
  await startThread({ page, text: 'Other thread' })
  await expect(removeAttachment({ page, name: 'Remove image red.png' })).toHaveCount(0)
})

When('the sidebar goes back to the drafting thread', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Attachment draft thread' }).or(page.getByText('Attachment draft thread', { exact: true }).first()),
  ).toBeVisible()
})

Then('the draft still reads {string} with its image and file attached', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'prompt-stash-draft-attachments-survive-back', async () => {
    await expect(threadComposer({ page })).toHaveText(text)
    await expect(removeAttachment({ page, name: 'Remove image red.png' })).toBeVisible()
    await expect(removeAttachment({ page, name: 'Remove file note.txt' })).toBeVisible()
  })
})

When('the attachments are removed from the draft', async ({ page }: { page: Page }) => {
  await removeAttachment({ page, name: 'Remove image red.png' }).click()
  await removeAttachment({ page, name: 'Remove file note.txt' }).click()
  await expect(removeAttachment({ page, name: 'Remove file note.txt' })).toHaveCount(0)
})

Then('the drafting thread holds no attachments after another round trip', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Forward', exact: true }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await recordAssertion(page, 'prompt-stash-removed-attachments-stay-removed', async () => {
    await expect(threadComposer({ page })).toBeVisible()
    await expect(removeAttachment({ page, name: 'Remove image red.png' })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
