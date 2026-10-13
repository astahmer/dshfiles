import { expect, type Page } from '@playwright/test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const fakeServer = join(dirname(fileURLToPath(import.meta.url)), '..', 'fake-mcp-server.mjs')
const addForm = (page: Page) => page.getByRole('form', { name: 'Add MCP server', exact: true })
const servers = (page: Page) => page.getByRole('region', { name: 'Registered servers', exact: true })
const serverRow = (page: Page, name: string) => servers(page).getByRole('listitem').filter({ hasText: name })

When('the MCP servers page is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'MCP servers', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Global MCP servers', exact: true })).toBeVisible()
})

When('the local echo MCP server is added as a stdio command', async ({ page }: { page: Page }) => {
  await addForm(page).getByRole('combobox', { name: 'Transport', exact: true }).click()
  await page.getByRole('option', { name: 'Local command (stdio)', exact: true }).click()
  await addForm(page).getByRole('textbox', { name: 'Display name', exact: true }).fill('Echo server')
  await addForm(page).getByRole('textbox', { name: 'Command and arguments', exact: true }).fill(`node ${fakeServer}`)
  await addForm(page).getByRole('button', { name: 'Add server', exact: true }).click()
  await expect(serverRow(page, 'Echo server')).toBeVisible()
})

When('the Echo server is {string}', async ({ page }: { page: Page }, action: string) => {
  await serverRow(page, 'Echo server').getByRole('button', { name: action, exact: true }).click()
})

Then('plain-HTTP and credential-bearing endpoints are refused on submit', async ({ page }: { page: Page }) => {
  const endpoint = addForm(page).getByRole('textbox', { name: 'HTTPS endpoint', exact: true })
  const submit = addForm(page).getByRole('button', { name: 'Add server', exact: true })
  await addForm(page).getByRole('textbox', { name: 'Display name', exact: true }).fill('Leaky')
  for (const [url, id] of [
    ['http://example.com/mcp', 'mcp-servers-plain-http-is-refused'],
    ['https://user:secret@example.com/mcp', 'mcp-servers-inline-credentials-are-refused'],
  ] as const) {
    await endpoint.fill(url)
    if (await submit.isEnabled()) await submit.click()
    await recordAssertion(page, id, async () => {
      await expect(addForm(page).getByRole('alert').filter({ hasText: 'Use an HTTPS endpoint without embedded credentials.' })).toBeVisible()
      await expect(servers(page).getByText('No MCP servers configured yet.', { exact: true })).toBeVisible()
    })
  }
  await endpoint.fill('https://example.com/mcp')
  await recordAssertion(page, 'mcp-servers-https-endpoint-clears-the-error', () =>
    expect(addForm(page).getByRole('alert').filter({ hasText: 'Use an HTTPS endpoint without embedded credentials.' })).toHaveCount(0),
  )
  await finishJourneyAssertions(page)
})

Then('the Echo server reads {string}', async ({ page }: { page: Page }, status: string) => {
  await recordAssertion(page, `mcp-servers-status-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 64), () =>
    expect(serverRow(page, 'Echo server')).toContainText(status, { timeout: 30_000 }),
  )
})

Then('it never claims a remote health ping', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-servers-health-is-not-invented', () =>
    expect(serverRow(page, 'Echo server')).toContainText('Remote connection health: not reported'),
  )
})

Then('removing the Echo server after confirmation empties the list', async ({ page }: { page: Page }) => {
  await serverRow(page, 'Echo server').getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click()
  await recordAssertion(page, 'mcp-servers-remove-drops-the-server', () => expect(servers(page).getByText('No MCP servers configured yet.', { exact: true })).toBeVisible())
  await finishJourneyAssertions(page)
})
