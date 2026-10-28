import { expect, type Page } from '@playwright/test'
import { globalPanelLink } from '../plugin-view-names.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { After, Then, When } from '../bdd.js'
import { fakeOAuthMcpFor, startFakeOAuthMcp, stopFakeOAuthMcp } from '../fake-oauth-mcp.js'
import { allowLoopbackBrowserOrigin, finishJourneyAssertions, recordAssertion } from '../steps.js'

const fakeServer = join(dirname(fileURLToPath(import.meta.url)), '..', 'fake-mcp-server.mjs')
const newThreadComposerName = 'Describe what you want to build, / commands, @ files or sessions'
const addForm = (page: Page) => page.getByRole('form', { name: 'Add MCP server', exact: true })
const servers = (page: Page) => page.getByRole('region', { name: 'Registered servers', exact: true })
const serverRow = (page: Page, name: string) => servers(page).getByRole('listitem').filter({ hasText: name })

When('the MCP servers page is opened', async ({ page }: { page: Page }) => {
  await page
    .getByRole('navigation', { name: 'Sidebar navigation', exact: true })
    .or(page.getByRole('navigation', { name: 'Global panels', exact: true }))
    .getByRole('button', { name: 'MCP Servers: Servers', exact: true })
    .first()
    .click()
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

When('the composer searches MCP @ autocomplete for {string}', async ({ page }: { page: Page }, query: string) => {
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  const composer = page.getByRole('textbox', { name: newThreadComposerName, exact: true })
  await expect(composer).toBeVisible()
  await composer.fill('MCP autocomplete tool context')
  const sendButton = page.getByRole('button', { name: 'Send message', exact: true })
  await expect(sendButton).toBeEnabled()
  await sendButton.click()
  await expect(page.getByText(/This turn failed/)).toBeVisible()
  await page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true }).fill(`@${query}`)
})

Then('the Echo server and its tool appear as @ suggestions', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-servers-autocomplete-shows-server', async () => {
    await expect(page.getByRole('option').filter({ hasText: 'Echo server' })).toBeVisible()
  })
  await page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true }).fill('@e2e')
  await recordAssertion(page, 'mcp-servers-autocomplete-shows-tool', async () => {
    await expect(page.getByRole('option').filter({ hasText: 'e2e_echo' })).toBeVisible()
  })
  await finishJourneyAssertions(page)
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
  await recordAssertion(page, 'mcp-servers-remove-drops-the-server', () =>
    expect(servers(page).getByText('No MCP servers configured yet.', { exact: true })).toBeVisible(),
  )
  await finishJourneyAssertions(page)
})

const selectEchoForBatch = async (page: Page): Promise<void> => {
  await serverRow(page, 'Echo server').getByRole('checkbox', { name: 'Select server Echo server', exact: true }).check()
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
}

When('the Echo server is selected for batch actions', async ({ page }: { page: Page }) => {
  await selectEchoForBatch(page)
})

When('the selected servers are disabled', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Disable selected', exact: true }).click()
  await expect(page.getByText('1 selected', { exact: true })).toHaveCount(0)
})

When('the selected servers are enabled', async ({ page }: { page: Page }) => {
  await selectEchoForBatch(page)
  await page.getByRole('button', { name: 'Enable selected', exact: true }).click()
})

Then('the Echo server is enabled again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-servers-batch-enable-restores-the-client', async () => {
    await expect(serverRow(page, 'Echo server')).toContainText('Native client loaded', { timeout: 30_000 })
    await expect(serverRow(page, 'Echo server')).not.toContainText('Disabled in configuration')
  })
})

When('the selected Echo server is removed after confirmation', async ({ page }: { page: Page }) => {
  await selectEchoForBatch(page)
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Remove this server and stop its native client?')
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
})

Then('the registered server list is empty', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-servers-batch-remove-empties-the-list', () =>
    expect(servers(page).getByText('No MCP servers configured yet.', { exact: true })).toBeVisible(),
  )
  await finishJourneyAssertions(page)
})

const preferences = (page: Page) => page.getByRole('region', { name: 'Preferences', exact: true })

When('public Registry search is turned off and the tool call timeout set to 45 seconds', async ({ page }: { page: Page }) => {
  const registrySearch = preferences(page).getByRole('switch', { name: 'Search the public MCP Registry', exact: true })
  await expect(registrySearch).toBeChecked()
  await registrySearch.click()
  await preferences(page).getByRole('spinbutton', { name: 'Tool call timeout (seconds)' }).fill('45')
  await preferences(page).getByRole('button', { name: 'Save preferences', exact: true }).click()
  await expect(preferences(page).getByRole('status').filter({ hasText: 'Preferences saved.' })).toBeVisible()
})

Then('the preferences survive a reload', async ({ page }: { page: Page }) => {
  await page.reload()
  await globalPanelLink(page, 'MCP Servers: Servers').click()
  await recordAssertion(page, 'mcp-servers-preferences-persist-in-the-profile', async () => {
    await expect(preferences(page).getByRole('switch', { name: 'Search the public MCP Registry', exact: true })).not.toBeChecked()
    await expect(preferences(page).getByRole('spinbutton', { name: 'Tool call timeout (seconds)' })).toHaveValue('45')
    await expect(preferences(page).getByRole('switch', { name: 'Connect servers when DSH starts', exact: true })).toBeChecked()
  })
})

Then('the catalog no longer searches the public Registry', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Browse MCPs', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search providers and Registry…', exact: true }).fill('postgres')
  await recordAssertion(page, 'mcp-servers-registry-search-follows-the-preference', () =>
    expect(page.getByText('Public Registry search is turned off in Preferences.', { exact: true })).toBeVisible(),
  )
  await finishJourneyAssertions(page)
})

const oauthRow = (page: Page) => serverRow(page, 'Fake OAuth')

When('a loopback OAuth-protected MCP server is added with OAuth sign-in', async ({ page }: { page: Page }) => {
  const fake = await startFakeOAuthMcp(page)
  allowLoopbackBrowserOrigin(page, fake.origin)
  await addForm(page).getByRole('textbox', { name: 'Display name', exact: true }).fill('Fake OAuth')
  await addForm(page).getByRole('textbox', { name: 'HTTPS endpoint', exact: true }).fill(fake.endpoint)
  await addForm(page).getByRole('checkbox', { name: 'Sign in with OAuth (discovery, dynamic client registration, PKCE)', exact: true }).click()
  await addForm(page).getByRole('button', { name: 'Add server', exact: true }).click()
  await expect(oauthRow(page)).toBeVisible()
})

Then('the server asks for sign-in and registers no tools', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-servers-oauth-server-waits-for-sign-in', async () => {
    await expect(oauthRow(page)).toContainText('Sign-in required', { timeout: 30_000 })
    await expect(oauthRow(page).getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    expect(fakeOAuthMcpFor(page).acceptedTokens.size).toBe(0)
  })
})

When('the server is signed in through the provider page', async ({ page }: { page: Page }) => {
  const providerPage = page.context().waitForEvent('page')
  await oauthRow(page).getByRole('button', { name: 'Sign in', exact: true }).click()
  const popup = await providerPage
  await expect(popup.getByText('Signed in. The MCP server is reconnecting.', { exact: true })).toBeVisible({ timeout: 30_000 })
  await popup.close()
  // Returning to the tab refetches on focus in a real browser; a headless page gets no focus event, so refresh by hand.
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
})

Then("the server loads with the provider's tool and reads {string}", async ({ page }: { page: Page }, status: string) => {
  await recordAssertion(page, 'mcp-servers-oauth-sign-in-loads-the-server', async () => {
    await expect(oauthRow(page)).toContainText(status, { timeout: 30_000 })
    await expect(oauthRow(page)).toContainText('1 Host tools registered', { timeout: 30_000 })
    expect(fakeOAuthMcpFor(page).acceptedTokens.size).toBe(1)
    expect(fakeOAuthMcpFor(page).registeredClientNames).toEqual(['DSH MCP servers'])
  })
})

When('the server is signed out', async ({ page }: { page: Page }) => {
  await oauthRow(page).getByRole('button', { name: 'Sign out', exact: true }).click()
})

Then('the server asks for sign-in again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-servers-oauth-sign-out-drops-the-grant', async () => {
    await expect(oauthRow(page)).toContainText('Sign-in required', { timeout: 30_000 })
    await expect(oauthRow(page)).not.toContainText('1 Host tools registered')
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  await stopFakeOAuthMcp(page)
})
