import { expect, type Locator, type Page } from '@playwright/test'
import { bootComposedPluginProfile } from '../boot.js'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'

// Port 0 lets every scenario bind its own receiver port; the receiver publishes it to dshx tracing in-process.
const freePortPatch = `- id: dshfiles-traces
  config:
    port: 0
`

const childDirective = String.raw`\u005b\u005bonce call bash \u007b\u0022command\u0022:\u0022echo child-trace\u0022,\u0022description\u0022:\u0022Child trace\u0022\u007d\u005d\u005d`
const turnDirective = `[[once call ai_accounts_native_providers {}]] [[once call subagent {"description":"Child trace","prompt":"${childDirective}"}]]`

const waterfall = (page: Page): Locator => page.getByRole('tree', { name: 'Span waterfall' })
const spanRow = (page: Page, level: number, name: string): Locator => waterfall(page).getByRole('treeitem', { level }).filter({ hasText: name })

Given('the isolated Agent telemetry profile is booted with the Traces receiver on a free port', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/agent-telemetry', '@dshfiles/traces', '@dshfiles/ai-accounts'],
    profileLabel: 'agent-telemetry',
    cordisPatch: freePortPatch,
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('a new thread asks the model for a plugin tool and a subagent', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await page.getByRole('menuitemradio', { name: 'commandcode_work/gpt-6-luna', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill(turnDirective)
  await composer.press('Enter')
  await expect(page.getByText(/^Answered by /).first()).toBeVisible({ timeout: 60_000 })
})

Then('the Traces panel lists the turn as a trace of the thread', async ({ page }: { page: Page }) => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Traces', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Traces', exact: true, level: 1 })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search traces', exact: true }).fill('execute_tool subagent')
  const turn = page.getByRole('row', { name: 'dshfiles enter_ai_application_system', exact: true })
  await recordAssertion(page, 'agent-telemetry-turn-exported-in-process', () => expect(turn).toHaveCount(1, { timeout: 30_000 }))
  await turn.click()
})

Then('its waterfall nests the plugin API under its tool and the subagent turn under the subagent tool', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'agent-telemetry-turn-step-tool-tree', async () => {
    await expect(spanRow(page, 1, 'enter_ai_application_system')).toHaveCount(1)
    await expect(spanRow(page, 2, 'invoke_agent')).toHaveCount(1)
    await expect(spanRow(page, 3, 'react step').first()).toBeVisible()
    await expect(spanRow(page, 4, 'chat gpt-6-luna').first()).toBeVisible()
  })
  await recordAssertion(page, 'agent-telemetry-plugin-api-nests-under-its-tool', async () => {
    await expect(spanRow(page, 4, 'execute_tool ai_accounts_native_providers')).toHaveCount(1)
    await expect(spanRow(page, 5, 'ai-accounts/nativeProviders')).toHaveCount(1)
  })
  await recordAssertion(page, 'agent-telemetry-subagent-joins-the-parent-trace', async () => {
    // The subagent's turn can end after its parent's: the open trace refetches until its spans arrive.
    await expect(spanRow(page, 5, 'enter_ai_application_system')).toHaveCount(1, { timeout: 30_000 })
    await expect(spanRow(page, 8, 'execute_tool bash')).toHaveCount(1, { timeout: 30_000 })
  })
})

Then("the subagent's bash call holds the background job it started", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'agent-telemetry-job-span-under-its-tool', () => expect(spanRow(page, 9, 'job bash')).toHaveCount(1, { timeout: 30_000 }))
  await finishJourneyAssertions(page)
})
