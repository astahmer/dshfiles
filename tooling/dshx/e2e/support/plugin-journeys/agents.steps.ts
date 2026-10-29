import { expect, type Page } from '@playwright/test'
import { openGlobalPanel } from '../plugin-view-names.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const peek = (page: Page) => page.getByRole('complementary', { name: 'Item detail' })

When('{string} is commented on the open item', async ({ page }: { page: Page }, text: string) => {
  const comment = peek(page).getByRole('textbox', { name: 'Comment', exact: true })
  await comment.fill(text)
  await peek(page).getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(comment).toHaveValue('')
})

Then('the agent thread {string} opens with its instructions for {string}', async ({ page }: { page: Page }, title: string, task: string) => {
  await recordAssertion(page, 'agents-comment-dispatch-starts-a-thread', async () => {
    await expect(page.getByRole('treeitem', { name: new RegExp(`^${title}\\b`, 'u') })).toHaveAttribute('aria-selected', 'true')
    // The sent message renders the agent mention as a chip, then its instructions, then the item heading the backlog
    // adds before the task, so the thread can find the item it was started for.
    await expect(page.getByText('Work as', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'dsh', exact: true })).toBeVisible()
    await expect(page.getByText(new RegExp(`---\\s*Work on b:\\d+: ${title}[\\s\\S]*${task}`, 'u'))).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the start thread dialog offers the agent {string}', async ({ page }: { page: Page }, handle: string) => {
  await peek(page).getByRole('button', { name: 'Start thread', exact: true }).click()
  const agents = page.getByRole('combobox', { name: 'Thread agent', exact: true })
  await expect(agents).toBeVisible()
  await agents.click()
  await expect(page.getByRole('option', { name: new RegExp(handle, 'u') })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await finishJourneyAssertions(page)
})

Then('the item links the @{word} thread {string}', async ({ page }: { page: Page }, handle: string, title: string) => {
  await recordAssertion(page, 'agents-comment-dispatch-links-the-item', async () => {
    await expect(peek(page).getByRole('button', { name: /^Unlink thread session-/ })).toBeVisible()
    await expect(peek(page).getByRole('button', { name: title, exact: true })).toBeVisible()
    await expect(
      peek(page)
        .getByText(new RegExp(`@${handle}\\b`, 'u'))
        .first(),
    ).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const openAgentsPanel = async (page: Page): Promise<void> => {
  await openGlobalPanel(page, 'Agents: Directory')
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible()
}

const instructionsField = (page: Page) => page.getByRole('textbox', { name: /^Instructions/u })

Then('the agent {string} is saved with instructions {string}', async ({ page }: { page: Page }, name: string, instructions: string) => {
  await openAgentsPanel(page)
  await page.getByRole('button', { name: 'New agent', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await instructionsField(page).fill(instructions)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
})

Then('the agent {string} may only message {string}', async ({ page }: { page: Page }, _name: string, peer: string) => {
  await page.getByRole('combobox', { name: 'Delegation (messages)', exact: true }).click()
  await page.getByRole('option', { name: 'Listed peers only', exact: true }).click()
  await page.getByRole('textbox', { name: 'Peers (handles)', exact: true }).fill(peer)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
})

When("the built-in agent's start-thread workspace picker is opened", async ({ page }: { page: Page }) => {
  await openAgentsPanel(page)
  await page.getByText('@dsh', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible()
})

Then('the workspace picker is a Combobox listing registered projects only', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'agents-thread-workspace-picker', async () => {
    const picker = page.getByRole('combobox', { name: 'Thread workspace', exact: true })
    await expect(picker).toHaveJSProperty('tagName', 'BUTTON')
    await picker.click()
    await expect(page.getByRole('option', { name: 'Host default workspace', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: /thread-[0-9a-f]{6}/u })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the Agents panel lists {string} with those instructions', async ({ page }: { page: Page }, name: string) => {
  await recordAssertion(page, 'agents-registry-persists-a-new-agent', async () => {
    const row = page.getByRole('button', { name: new RegExp(`@${name.toLowerCase()}$`, 'u') })
    await expect(row).toBeVisible()
    await row.click()
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name)
    await expect(instructionsField(page)).toHaveValue('Prefer small findings.')
    await expect(page.getByRole('combobox', { name: 'Delegation (messages)', exact: true })).toContainText('Listed peers only')
    await expect(page.getByRole('textbox', { name: 'Peers (handles)', exact: true })).toHaveValue('dsh')
  })
  await finishJourneyAssertions(page)
})

When('a thread is started from the agent {string} with {string}', async ({ page }: { page: Page }, handle: string, prompt: string) => {
  await openAgentsPanel(page)
  await page.getByRole('button', { name: new RegExp(`@${handle}$`, 'u') }).click()
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill(prompt)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('treeitem', { name: new RegExp(`^${prompt}\\b`, 'u') })).toHaveAttribute('aria-selected', 'true')
})

When('the browser page is reloaded with the Agents panel open', async ({ page }: { page: Page }) => {
  await page.reload()
  await openAgentsPanel(page)
})

Then('the agent {string} lists {string} and counts {int} thread', async ({ page }: { page: Page }, handle: string, title: string, count: number) => {
  await recordAssertion(page, 'agents-thread-history-survives-a-reload', async () => {
    await page.getByRole('button', { name: new RegExp(`@${handle}$`, 'u') }).click()
    await expect(page.getByText(new RegExp(`@${handle} · ${String(count)} thread\\b`, 'u'))).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`^${title}\\b`, 'u') })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const commentBox = (page: Page) => peek(page).getByRole('textbox', { name: 'Comment', exact: true })

When('{string} is typed in the open item comment box', async ({ page }: { page: Page }, text: string) => {
  const box = commentBox(page)
  await box.click()
  await box.press('End')
  await box.type(text)
})

Then('the agent suggestion {string} is offered', async ({ page }: { page: Page }, handle: string) => {
  await recordAssertion(page, 'agents-comment-box-completes-a-handle', async () => {
    const list = peek(page).getByRole('listbox', { name: 'Reply suggestions', exact: true })
    await expect(list).toBeVisible()
    await expect(list.getByRole('option', { name: new RegExp(`${handle}$`, 'u') })).toBeVisible()
  })
})

When('the agent suggestion {string} is picked', async ({ page }: { page: Page }, handle: string) => {
  const list = peek(page).getByRole('listbox', { name: 'Reply suggestions', exact: true })
  await list.getByRole('option', { name: new RegExp(`${handle}$`, 'u') }).click()
})

Then('the comment box reads {string}', async ({ page }: { page: Page }, text: string) => {
  await expect(commentBox(page)).toHaveValue(text)
})

Then('no agent suggestion is offered', async ({ page }: { page: Page }) => {
  await expect(peek(page).getByRole('listbox', { name: 'Reply suggestions', exact: true })).toHaveCount(0)
  await finishJourneyAssertions(page)
})

const agentPreview = (page: Page) => page.locator('[data-dshfiles-agent-preview]')

When('the mention {string} is clicked in the open item', async ({ page }: { page: Page }, mention: string) => {
  const handle = mention.replace(/^@\{([^}]+)\}$/u, '@$1')
  await peek(page)
    .getByRole('link', { name: `Preview agent ${handle}`, exact: true })
    .first()
    .click()
})

Then('the agent preview shows {string} with instructions {string}', async ({ page }: { page: Page }, name: string, instructions: string) => {
  await recordAssertion(page, 'agents-mention-opens-a-preview-card', async () => {
    await expect(agentPreview(page)).toBeVisible()
    await expect(agentPreview(page).getByText(name, { exact: true })).toBeVisible()
    await expect(agentPreview(page).getByText(instructions, { exact: true })).toBeVisible()
  })
})

Then('the preview opens {string} in the Agents panel', async ({ page }: { page: Page }, name: string) => {
  await agentPreview(page).getByRole('button', { name: 'Open in Agents', exact: true }).click()
  await recordAssertion(page, 'agents-mention-preview-opens-the-agent', async () => {
    await expect(agentPreview(page)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name)
  })
  await finishJourneyAssertions(page)
})
