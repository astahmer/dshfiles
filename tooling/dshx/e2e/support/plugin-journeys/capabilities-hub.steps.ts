import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const hub = (page: Page) => page.getByRole('main', { name: 'Capabilities hub', exact: true })
const section = (page: Page, name: string) => hub(page).getByRole('region', { name, exact: true })

When('the Capabilities hub is opened from the sidebar', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Capabilities hub')
  await expect(hub(page).getByRole('heading', { name: 'Capabilities hub', exact: true })).toBeVisible()
})

Then('the Capabilities hub shows skills, MCP servers and DSH plugins with separate trust labels', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'capabilities-hub-trust-labels', async () => {
    await expect(section(page, 'Skills').getByText('Agent instructions', { exact: true })).toBeVisible()
    await expect(section(page, 'MCP servers').getByText('Tools and credentials', { exact: true })).toBeVisible()
    await expect(section(page, 'DSH plugins').getByText('Executable code', { exact: true })).toBeVisible()
  })
  await recordAssertion(page, 'capabilities-hub-owner-counts', async () => {
    await expect(section(page, 'MCP servers').getByText('0 configured, 0 enabled', { exact: true })).toBeVisible()
    await expect(section(page, 'DSH plugins').getByText(/^\d+ loaded, \d+ enabled$/u)).toBeVisible()
  })
})

Then('the Capabilities hub links out to skills.sh with a telemetry-off command', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'capabilities-hub-skills-sh-link-out', async () => {
    const skills = section(page, 'Skills')
    await expect(skills.getByRole('link', { name: 'Open skills.sh', exact: true })).toHaveAttribute('href', 'https://skills.sh')
    await expect(skills.getByText(/^DISABLE_TELEMETRY=1 npx skills@\d+\.\d+\.\d+ add /u)).toBeVisible()
  })
})

When('the MCP servers manager is opened from the Capabilities hub', async ({ page }: { page: Page }) => {
  await section(page, 'MCP servers').getByRole('button', { name: 'Open MCP servers', exact: true }).click()
})

Then('the MCP servers manager owns the page', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'capabilities-hub-opens-owner', async () => {
    await expect(page.getByRole('heading', { name: 'Global MCP servers', exact: true })).toBeVisible()
    await expect(hub(page)).toBeHidden()
  })
  await finishJourneyAssertions(page)
})
