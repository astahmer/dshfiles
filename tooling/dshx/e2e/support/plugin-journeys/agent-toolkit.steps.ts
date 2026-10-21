import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const NEW_THREAD_COMPOSER = 'Describe what you want to build, / commands, @ files or sessions'
const toolkit = (page: Page) => page.getByTestId('agent-toolkit')
const section = (page: Page, name: RegExp) => toolkit(page).getByRole('region', { name })

When('the Agent toolkit is opened from the sidebar', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Agent toolkit', exact: true }).click()
  await expect(toolkit(page).getByRole('heading', { name: 'Agent toolkit', exact: true })).toBeVisible()
})

Then(
  'the Agent toolkit lists the registry tool, the plugin APIs, the plugins with versions, MCP servers, the skill and memory',
  async ({ page }: { page: Page }) => {
    await recordAssertion(page, 'agent-toolkit-lists-tools', async () => {
      const tools = section(page, /^Tools \(\d+\)$/)
      const capabilities = tools.getByRole('row').filter({ hasText: 'dshx_capabilities' })
      await expect(capabilities).toContainText('read-only')
      await expect(tools.getByRole('row').filter({ hasText: 'memory_note' })).toContainText('memory')
    })
    await recordAssertion(page, 'agent-toolkit-lists-plugin-apis', async () => {
      await expect(
        section(page, /^Plugin API methods \(\d+\)$/)
          .getByRole('row')
          .filter({ hasText: 'agent-toolkit.versions' }),
      ).toBeVisible()
    })
    await recordAssertion(page, 'agent-toolkit-lists-plugins-with-versions', async () => {
      const plugin = section(page, /^Plugins \(\d+\)$/)
        .getByRole('row')
        .filter({ hasText: '@dshfiles/agent-toolkit' })
      await expect(plugin).toContainText('0.1.0')
      await expect(plugin.getByRole('button', { name: 'Open the settings of @dshfiles/agent-toolkit', exact: true })).toBeVisible()
    })
    await recordAssertion(page, 'agent-toolkit-lists-mcp-servers', async () => {
      await expect(section(page, /^MCP servers \(\d+\)$/)).toBeVisible()
    })
    await recordAssertion(page, 'agent-toolkit-lists-skills', async () => {
      const skill = section(page, /^Skills \(\d+\)$/)
        .getByRole('row')
        .filter({ hasText: '/e2e-skill-mentions' })
      await expect(skill).toContainText('/name only')
      await expect(skill).toContainText('user · .dsh')
      await expect(skill).toContainText('filesystem')
      await expect(skill.locator('[title*="/skills/e2e-skill-mentions/"]')).toHaveCount(0)
    })
    await recordAssertion(page, 'agent-toolkit-shows-memory', async () => {
      const memory = section(page, /^Memory$/)
      await expect(memory).toContainText('Start block for')
      await expect(memory.getByRole('button', { name: 'Open the Memory panel', exact: true })).toBeVisible()
    })
  },
)

When('the Agent toolkit shows only {string} matching {string}', async ({ page }: { page: Page }, filter: string, query: string) => {
  await toolkit(page).getByRole('radio', { name: filter, exact: true }).click()
  await toolkit(page).getByRole('searchbox', { name: 'Search the agent toolkit', exact: true }).fill(query)
})

Then('only the agent toolkit plugin, its API and no tool remain', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'agent-toolkit-filters-by-source-and-text', async () => {
    await expect(section(page, /^Tools \(0\)$/)).toBeVisible()
    await expect(section(page, /^Plugins \(1\)$/)).toContainText('@dshfiles/agent-toolkit')
    await expect(section(page, /^Plugin API methods \(1\)$/)).toContainText('agent-toolkit.versions')
    await expect(section(page, /^MCP servers/)).toHaveCount(0)
    await expect(section(page, /^Skills/)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('a thread {string} is started from the composer', async ({ page }: { page: Page }, text: string) => {
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  const composer = page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true })
  await composer.fill(text)
  await composer.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
})

When('the Agent toolkit is opened from the command palette', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Meta+Shift+P')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('agent toolkit')
  await palette.getByRole('option', { name: /^Open the agent toolkit/ }).click()
})

Then('the Agent toolkit is about the thread {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'agent-toolkit-opens-about-the-thread', async () => {
    await expect(toolkit(page).getByRole('heading', { name: 'Agent toolkit', exact: true })).toBeVisible()
    await expect(toolkit(page).getByRole('combobox', { name: 'Thread', exact: true })).toContainText(title)
  })
  await finishJourneyAssertions(page)
})
