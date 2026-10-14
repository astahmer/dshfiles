import { expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor, type FakeChatRequest } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { startThreadWithModel } from '../threads.js'

const LONG_TAIL = 'x'.repeat(260)
const queueDock = (page: Page) => page.locator('[data-queue-dock]')
const composerInput = (page: Page) => page.locator('[data-composer-card]').getByRole('textbox')
const queuedRows = (page: Page) => queueDock(page).locator('li:not([data-queue-edit-placeholder])')

const latestUserText = (request: FakeChatRequest): string =>
  request.messages.filter(message => message.role === 'user' && !message.text.startsWith('Current runtime context.')).at(-1)?.text ?? ''

const queueMessage = async (page: Page, text: string): Promise<void> => {
  const composer = composerInput(page)
  await composer.fill(text)
  await composer.press('Enter')
  await expect(composer).toHaveText('')
}

/** Fires the same HTML5 drag sequence a pointer drag does, from one row's grip onto another row. */
const dragRow = async (page: Page, input: { readonly from: number; readonly to: number }): Promise<void> => {
  await queueDock(page).evaluate((dock, positions) => {
    const rows = Array.from(dock.querySelectorAll<HTMLElement>('li:not([data-queue-edit-placeholder])'))
    const grip = rows[positions.from]?.querySelector<HTMLElement>('[draggable="true"]')
    const target = rows[positions.to]
    if (grip === null || grip === undefined || target === undefined) throw new Error('The queued rows to drag between are missing.')
    const dataTransfer = new DataTransfer()
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }))
  }, input)
}

When('a thread on the fake model is kept busy by a held turn', async ({ page }: { page: Page }) => {
  await startThreadWithModel(page, { project: 'Default workspace', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('queue journey [[hold]]')
  await composer.press('Enter')
  await expect.poll(() => fakeCommandCodeFor(page).requests.filter(request => request.kind === 'turn').length).toBe(1)
})

When('the messages {string}, {string} and a long third one are queued', async ({ page }: { page: Page }, first: string, second: string) => {
  await queueMessage(page, first)
  await queueMessage(page, second)
  await queueMessage(page, `third queued\nline ${LONG_TAIL}`)
})

When('the first queued message is moved down', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Move queued message 1 down', exact: true }).click()
})

When('the third queued message is dragged onto the first', async ({ page }: { page: Page }) => {
  await dragRow(page, { from: 2, to: 0 })
})

When('the held turn finishes', async ({ page }: { page: Page }) => {
  fakeCommandCodeFor(page).releaseHeldTurns()
})

When('the second queued message is edited in the composer', async ({ page }: { page: Page }) => {
  await queuedRows(page).nth(1).getByRole('button', { name: 'Edit queued message', exact: true }).click()
})

When('queued messages are set to start collapsed with 40-character previews', async ({ page }: { page: Page }) => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: 'View Queue Reorder', exact: true }).click()
  const expand = page.getByRole('switch', { name: 'Expand by default', exact: true })
  await expand.click()
  await expect(expand).not.toBeChecked()
  await page.getByRole('textbox', { name: 'Preview length', exact: true }).fill('40')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

Then('the queue reads {string}, {string}, {string}', async ({ page }: { page: Page }, first: string, second: string, third: string) => {
  await recordAssertion(page, `queue-reorder-order-${[first, second, third].map(text => text.split(' ')[0]).join('-')}`, async () => {
    await expect(queuedRows(page)).toHaveCount(3)
    for (const [index, text] of [first, second, third].entries()) await expect(queuedRows(page).nth(index)).toContainText(text)
  })
})

Then('the edges of the queue cannot move further', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'queue-reorder-boundary-moves-are-disabled', async () => {
    await expect(page.getByRole('button', { name: 'Move queued message 1 up', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Move queued message 3 down', exact: true })).toBeDisabled()
  })
})

Then('the long message previews as one truncated line', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'queue-reorder-preview-is-one-bounded-line', async () => {
    const preview = queuedRows(page).filter({ hasText: 'third queued' }).locator('span[title]')
    const text = (await preview.textContent()) ?? ''
    expect(text.startsWith('third queued line xxx')).toBe(true)
    expect(text).not.toContain('\n')
    expect([...text].length).toBeLessThanOrEqual(201)
    expect(text.length).toBeLessThan(`third queued line ${LONG_TAIL}`.length)
  })
})

Then('the provider receives the queued messages in the reordered order', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'queue-reorder-runs-in-the-new-order', async () => {
    await expect
      .poll(
        () =>
          fakeCommandCodeFor(page)
            .requests.filter(request => request.kind === 'turn')
            .map(latestUserText)
            .slice(1)
            .map(text => text.split(/\s/)[0]),
        { timeout: 60_000 },
      )
      .toEqual(['third', 'second', 'first'])
  })
  await finishJourneyAssertions(page)
})

Then('the composer holds its text while the queue locks and Escape puts it back', async ({ page }: { page: Page }) => {
  const composer = composerInput(page)
  await recordAssertion(page, 'queue-reorder-edit-moves-the-message-into-the-composer', async () => {
    await expect(composer).toContainText('second queued')
    await expect(queueDock(page).locator('[data-queue-edit-placeholder]')).toContainText('Editing')
    await expect(queuedRows(page)).toHaveCount(2)
  })
  await recordAssertion(page, 'queue-reorder-editing-locks-other-queue-actions', async () => {
    for (const name of ['Move queued message 1 down', 'Move queued message 2 up', 'Edit queued message', 'Remove queued message']) {
      for (const button of await queueDock(page).getByRole('button', { name, exact: true }).all()) await expect(button).toBeDisabled()
    }
  })
  await composer.press('Escape')
  await recordAssertion(page, 'queue-reorder-cancelled-edit-restores-its-position', async () => {
    await expect(queueDock(page).locator('[data-queue-edit-placeholder]')).toHaveCount(0)
    await expect(queuedRows(page)).toHaveCount(3)
    await expect(queuedRows(page).nth(1)).toContainText('second queued')
  })
  await finishJourneyAssertions(page)
})

Then('the queue starts collapsed and previews at most 40 characters', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'queue-reorder-dock-starts-collapsed', async () => {
    await expect(queueDock(page)).toBeVisible()
    await expect(queuedRows(page).first()).toBeHidden()
  })
  await queueDock(page).getByRole('button').first().click()
  await recordAssertion(page, 'queue-reorder-preview-length-applies', async () => {
    const text = (await queuedRows(page).filter({ hasText: 'third queued' }).locator('span[title]').textContent()) ?? ''
    expect([...text].length).toBeLessThanOrEqual(41)
  })
  await finishJourneyAssertions(page)
})

const ATTACHMENT_FIXTURES = fileURLToPath(new URL('../../fixtures/attachments/', import.meta.url))

const queueWithAttachments = async (page: Page, text: string, files: readonly string[]): Promise<void> => {
  await composerInput(page).fill(text)
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles(files.map(name => join(ATTACHMENT_FIXTURES, name)))
  for (const name of files) {
    await expect(page.getByRole('button', { name: new RegExp(`^Remove (image|file) ${name.replace('.', '\\.')}$`) })).toBeVisible()
  }
  // Enter is refused until the file upload finishes, so it is pressed again until the composer empties.
  await expect(async () => {
    await composerInput(page).press('Enter')
    await expect(composerInput(page)).toHaveText('', { timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}

const openThread = async (page: Page, title: string): Promise<void> => {
  await page.getByText(title, { exact: true }).first().click()
  // The sidebar row and the open thread's header both name it.
  await expect(page.getByText(title, { exact: true }).nth(1)).toBeVisible()
  await expect(composerInput(page)).toBeVisible()
}

When('an idle thread {string} and a busy thread {string} exist', async ({ page }: { page: Page }, idle: string, busy: string) => {
  for (const [title, directive] of [
    [idle, ''],
    [busy, ' [[hold]]'],
  ] as const) {
    await startThreadWithModel(page, { project: 'Default workspace', model: 'commandcode_work/gpt-6-luna' })
    const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
    await composer.fill(`${title} [[title ${title}]]${directive}`)
    await composer.press('Enter')
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  }
})

When('the thread {string} is opened again', async ({ page }: { page: Page }, title: string) => {
  await openThread(page, title)
  await expect(queueDock(page)).toBeVisible()
})

When('{string} is queued with an image and a file, then {string} with an image', async ({ page }: { page: Page }, first: string, second: string) => {
  await queueWithAttachments(page, first, ['red.png', 'note.txt'])
  await queueWithAttachments(page, second, ['blue.png'])
  await expect(queuedRows(page)).toHaveCount(2)
})

When('the queued message {string} is moved to {string}', async ({ page }: { page: Page }, text: string, title: string) => {
  await queuedRows(page).filter({ hasText: text }).getByRole('button', { name: 'Move queued message to another thread', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Move to thread', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByRole('option', { name: title }).click()
})

Then('the dock says it moved to the queue of {string} and keeps only {string}', async ({ page }: { page: Page }, title: string, remaining: string) => {
  await recordAssertion(page, 'queue-reorder-move-to-busy-thread-queues-it-there', async () => {
    await expect(page.locator('[data-queue-transfer-outcome]')).toHaveText(new RegExp(`Moved to the queue of ${title}\\.`))
    await expect(queuedRows(page)).toHaveCount(1)
    await expect(queuedRows(page).first()).toContainText(remaining)
  })
})

Then('{string} opens with {string} and its image in the composer', async ({ page }: { page: Page }, title: string, text: string) => {
  await recordAssertion(page, 'queue-reorder-move-to-idle-thread-fills-its-composer', async () => {
    await expect(composerInput(page)).toHaveText(text)
    await expect(page.getByRole('button', { name: 'Remove image blue.png', exact: true })).toBeVisible()
    await expect(page.getByText(title, { exact: true }).nth(1)).toBeVisible()
  })
})

Then('{string} ran {string} with its image and file', async ({ page }: { page: Page }, title: string, text: string) => {
  await openThread(page, title)
  await recordAssertion(page, 'queue-reorder-moved-message-keeps-its-attachments', async () => {
    await expect
      .poll(
        () =>
          fakeCommandCodeFor(page)
            .requests.filter(request => request.kind === 'turn')
            .map(latestUserText),
        { timeout: 60_000 },
      )
      .toContainEqual(expect.stringContaining(text))
    await expect(page.getByText('note.txt', { exact: true })).toBeVisible()
    await expect(page.getByText(text, { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('{string} shows a thumbnail of {string} and a chip for {string}', async ({ page }: { page: Page }, text: string, image: string, file: string) => {
  const row = queuedRows(page).filter({ hasText: text })
  await recordAssertion(page, 'queue-reorder-attachment-previews-show-images-and-files', async () => {
    await expect(row.getByRole('group', { name: '2 attachments', exact: true })).toBeVisible()
    await expect(row.getByRole('img', { name: image, exact: true })).toBeVisible()
    await expect(row.locator('[data-queue-attachment="file"]')).toHaveText(file)
    await expect(row.locator('span[title]').first()).toHaveText(text)
  })
})

When('queued attachment previews are turned off', async ({ page }: { page: Page }) => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: 'View Queue Reorder', exact: true }).click()
  const previews = page.getByRole('switch', { name: 'Attachment previews', exact: true })
  await previews.click()
  await expect(previews).not.toBeChecked()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

Then('the queued messages show no attachment previews', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'queue-reorder-attachment-previews-setting-hides-them', async () => {
    await expect(queuedRows(page)).toHaveCount(2)
    await expect(queueDock(page).locator('[data-queue-attachment]')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
