import { expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { When, Then } from '../bdd.js'
import { DSHFILES_ROOT } from '../../../packages/dshx/src/project/local-bundles.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const PLUGIN_DIRECTORY = join(DSHFILES_ROOT, 'plugins/@dshfiles/mermaid-diagrams')
const FLOWCHART = ['flowchart LR', '  A[Plan] --> B{Ship?}', '  B -->|yes| C[Done]', '  B -->|no| A'].join('\n')
const answer = (source: string): string => `[[answer Here is the flow:\n\n\`\`\`mermaid\n${source}\n\`\`\`\n]]`

const send = async (page: Page, text: string): Promise<void> => {
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(text)
  await composer.press('Enter')
}

const diagrams = (page: Page) => page.getByRole('figure', { name: 'Mermaid diagram' })

When('the fake model answers with a mermaid flowchart', async ({ page }: { page: Page }) => {
  await registerWorkspaceFolder(page, PLUGIN_DIRECTORY)
  await startThreadWithModel(page, { project: 'mermaid-diagrams', model: 'commandcode_work/gpt-6-luna' })
  const rendererRequest = page.waitForResponse(response => response.url().includes('/dshfiles-mermaid-diagrams/renderer/lazy.js'), { timeout: 60_000 })
  await send(page, answer(FLOWCHART))
  expect((await rendererRequest).status()).toBe(200)
})

Then('the answer shows the flowchart as a diagram drawn by the renderer the Host serves', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mermaid-diagram-renders', async () => {
    const card = diagrams(page).last()
    await expect(card).toHaveAttribute('data-mermaid-diagram', 'ready', { timeout: 30_000 })
    const svg = card.locator('svg.pele-flowchart')
    await expect(svg).toBeVisible()
    for (const label of ['Plan', 'Ship?', 'Done', 'yes']) await expect(svg.getByText(label, { exact: true })).toBeVisible()
    // The sanitizer keeps pele's inline theme variables and drops anything that could navigate or fetch.
    await expect(card.locator('svg a, svg image, svg foreignObject, svg style')).toHaveCount(0)
  })
})

Then('Show code shows its source and Show diagram brings the diagram back', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mermaid-diagram-code-toggle', async () => {
    const card = diagrams(page).last()
    await card.getByRole('button', { name: 'Show code' }).click()
    await expect(card).toHaveAttribute('data-mermaid-diagram', 'code')
    await expect(card.locator('.md-code-block')).toContainText('A[Plan] --> B{Ship?}')
    await expect(card.locator('svg.pele')).toHaveCount(0)
    await card.getByRole('button', { name: 'Show diagram' }).click()
    await expect(card).toHaveAttribute('data-mermaid-diagram', 'ready', { timeout: 20_000 })
  })
})

Then('the diagram expands full size and closes', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mermaid-diagram-expands', async () => {
    await diagrams(page).last().getByRole('button', { name: 'Expand diagram' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Mermaid diagram' })
    await expect(dialog.locator('img[src^="blob:"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

When('the fake model answers with a mermaid fence it cannot parse', async ({ page }: { page: Page }) => {
  await send(page, answer('flowchart LR\n  A --> '))
  await expect(diagrams(page)).toHaveCount(2, { timeout: 60_000 })
})

Then('the card shows the parse error above the source', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mermaid-diagram-parse-error', async () => {
    const card = diagrams(page).last()
    await expect(card).toHaveAttribute('data-mermaid-diagram', 'failed', { timeout: 30_000 })
    await expect(card.getByRole('alert')).toContainText('ask the agent to correct it')
    await expect(card.locator('.md-code-block')).toContainText('A --> ')
  })
  await finishJourneyAssertions(page)
})
