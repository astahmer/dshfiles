import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { selectModelForNewThread } from '../threads.js'

const NEW_THREAD_COMPOSER = 'Describe what you want to build, / commands, @ files or sessions'
const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'

const newThreadComposer = (page: Page) => page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true })
const mentionRows = (page: Page) => page.getByRole('listbox').getByRole('option')
const threadHeader = (page: Page, title: string) => page.locator('[data-conversation-session]:visible').getByText(title, { exact: true }).first()

// A click while the previous turn settles can be dropped, so the New-thread screen is awaited and the click retried.
const openNewThread = async (page: Page): Promise<void> => {
  await expect(async () => {
    await page
      .getByRole('button', { name: /^New (thread|session)$/i })
      .filter({ visible: true })
      .first()
      .click()
    await expect(newThreadComposer(page)).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

const startThread = async (page: Page, text: string): Promise<void> => {
  await openNewThread(page)
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  await newThreadComposer(page).fill(`${text}\n\n[[title ${text}]]`)
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

Then('a mention row includes the thread {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'mentions-quoted-multiword-thread-search', async () => {
    await expect(mentionRows(page).filter({ hasText: title })).toHaveCount(1)
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

When('the composer appends a reference to thread {string}', async ({ page }: { page: Page }, title: string) => {
  const composer = newThreadComposer(page)
  await composer.pressSequentially(` and @t:${title.split(' ')[0] ?? ''}`)
  const row = mentionRows(page).filter({ hasText: title }).first()
  await expect(row).toBeVisible()
  await row.click()
})

Then('the composer holds two native reference chips', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mentions-two-native-chips', async () => {
    await expect(page.locator('[data-composer-card] [data-composer-chip="reference"]')).toHaveCount(2)
  })
  await finishJourneyAssertions(page)
})

Then('the composer holds a native reference chip', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mentions-native-chip', async () => {
    await expect(page.locator('[data-composer-card] [data-composer-chip="reference"]')).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

When('a new thread mentions {string} and is sent', async ({ page }: { page: Page }, title: string) => {
  await typeInNewThread(page, `@t:${title.split(' ')[0] ?? ''}`)
  await mentionRows(page).filter({ hasText: title }).first().click()
  await newThreadComposer(page).pressSequentially(' what changed there?')
  await newThreadComposer(page).press('Enter')
  await expect(page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true })).toBeVisible()
})

Then('the sent message links to {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'mentions-sent-reference-is-a-link', async () => {
    await expect(page.getByRole('link', { name: `Referenced session · ${title}` })).toBeVisible()
    await expect(page.locator('[data-ref-chip="session"][role="link"]:visible')).toHaveCount(1)
  })
})

When('the {string} link is clicked', async ({ page }: { page: Page }, name: string) => {
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).click({ position: { x: 150, y: 8 } })
})

Then('the thread {string} is shown', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'mentions-link-opens-thread', async () => {
    await expect(threadHeader(page, title)).toBeVisible()
  })
})

When('the sending thread is shown again and its thread chip is Cmd-clicked', async ({ page }: { page: Page }) => {
  await page.getByText('Mention target what changed there?', { exact: false }).first().click()
  const chip = page.locator('[data-ref-chip="session"][role="link"]:visible')
  await expect(chip).toHaveCount(1)
  await chip.click({ modifiers: ['ControlOrMeta'] })
})

Then('the thread {string} is shown in a tab of its own', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'mentions-mod-click-new-tab', async () => {
    await expect(threadHeader(page, title)).toBeVisible()
    await expect(page.getByRole('tab').filter({ hasText: new RegExp(`^${title}$`) })).toHaveCount(1)
    await expect(page.getByRole('tab').filter({ hasText: 'what changed' })).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

const skillRow = (page: Page, name: string) => mentionRows(page).filter({ hasText: name })

Then('the skill {string} and the thread {string} are both offered', async ({ page }: { page: Page }, skill: string, thread: string) => {
  await recordAssertion(page, 'mentions-skill-beside-threads', async () => {
    await expect(skillRow(page, skill)).toHaveCount(1)
    await expect(mentionRows(page).filter({ hasText: thread })).toHaveCount(1)
  })
})

Then('only the skill {string} is offered', async ({ page }: { page: Page }, skill: string) => {
  await recordAssertion(page, 'mentions-skill-scope', async () => {
    await expect(skillRow(page, skill)).toHaveCount(1)
    await expect(mentionRows(page)).toHaveCount(1)
  })
})

Then('the thread {string} is offered without the skill', async ({ page }: { page: Page }, thread: string) => {
  await recordAssertion(page, 'mentions-thread-scope-hides-skills', async () => {
    await expect(mentionRows(page).filter({ hasText: thread })).toHaveCount(1)
    await expect(skillRow(page, 'e2e-skill-mentions')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
