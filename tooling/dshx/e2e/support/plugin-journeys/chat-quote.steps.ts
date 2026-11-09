import { expect, type Page } from '@playwright/test'
import { When, Then } from '../bdd.js'
import { profileFor, recordAssertion, finishJourneyAssertions } from '../steps.js'
import { QUOTE_FIXTURE_PROMPT, seedChatQuoteSession } from '../seed-chat-quote-session.mjs'

const composer = (page: Page) =>
  page.getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/ })
/**
 * The draft text, line breaks kept: paragraphs and line-break nodes are `\n`; the sentinel `<br>` Lexical adds after a
 * trailing break only makes that empty line visible, so it is not text.
 */
const draftLines = async (page: Page): Promise<string> =>
  composer(page).evaluate(root =>
    [...root.children]
      .map(paragraph =>
        [...paragraph.childNodes]
          .map(node =>
            node instanceof HTMLBRElement
              ? node.hasAttribute('data-lexical-managed-linebreak')
                ? ''
                : '\n'
              : (node.textContent ?? '').replaceAll('\u200b', ''),
          )
          .join(''),
      )
      .join('\n'),
  )

const openQuoteFixture = async (page: Page): Promise<void> => {
  await seedChatQuoteSession({ homeRoot: profileFor(page).homeRoot })
  const fixture = page.getByRole('treeitem', { name: /Untitled|Chat quote fixture/ })
  await expect
    .poll(
      async () => {
        await page.reload()
        if ((await fixture.count()) === 0) await page.getByText('Ungrouped', { exact: true }).first().click()
        await fixture
          .first()
          .waitFor({ state: 'attached', timeout: 3_000 })
          .catch(() => undefined)
        return fixture.count()
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  await fixture.first().click()
  await expect(page.getByText(/First line of the answer/u).first()).toBeVisible()
}

When('the assistant reply of a chat thread is quoted', async ({ page }: { page: Page }) => {
  await openQuoteFixture(page)
  await page.locator('[data-chat-flow-kind="turn-tail"]').last().hover()
  await page.locator('button[data-message-quote="assistant"]').last().click()
})

Then('the draft holds the reply as a blockquote with its source, unsent', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-quote-assistant-reply', async () => {
    await expect
      .poll(() => draftLines(page))
      .toMatch(/^> First line of the answer\n> second line\n>\n>> an earlier quote\n> closing line\n— Assistant · turn 1 · \S.*\n\n$/u)
    await expect(composer(page)).toBeFocused()
    // Nothing was sent: the transcript still holds exactly one user message.
    await expect(page.locator('[data-chat-flow-kind="user"]')).toHaveCount(1)
  })
  await page.keyboard.type('My reply')
  await expect.poll(() => draftLines(page)).toMatch(/\nMy reply$/u)
  await page.reload()
  await page
    .getByRole('treeitem', { name: /Chat quote fixture/ })
    .first()
    .click()
  await recordAssertion(page, 'chat-quote-draft-persists', async () => {
    await expect.poll(() => draftLines(page)).toMatch(/^> First line of the answer\n[\s\S]*\nMy reply$/u)
  })
  await finishJourneyAssertions(page)
})

When('part of the user message is selected and quoted', async ({ page }: { page: Page }) => {
  await openQuoteFixture(page)
  await composer(page).click()
  await page.keyboard.type('Context first')
  const userRow = page.locator('[data-chat-flow-kind="user"]').first()
  // A mouse selection in the transcript takes focus from the composer first; a still-focused editor reclaims it.
  await composer(page).blur()
  await userRow.getByText(QUOTE_FIXTURE_PROMPT, { exact: true }).evaluate(element => {
    const text = element.firstChild
    if (text === null) throw new Error('user message has no text node')
    const start = (text.textContent ?? '').indexOf('quoting')
    const range = document.createRange()
    range.setStart(text, start)
    range.setEnd(text, start + 'quoting works'.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await userRow.hover()
  await userRow.locator('button[data-message-quote="user"]').click()
})

Then('the draft adds only the selected words after the existing text', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-quote-selection', async () => {
    await expect.poll(() => draftLines(page)).toMatch(/^Context first\n\n> quoting works\n— You · turn 1 · \S.*\n\n$/u)
  })
  await finishJourneyAssertions(page)
})
