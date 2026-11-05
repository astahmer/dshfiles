import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const DRAFT_HEADER = 'Plugin Guide · Native slots · sidebar'

const guide = (page: Page) => page.getByRole('main', { name: 'Plugin guide', exact: true })
const detail = (page: Page, title: string) => guide(page).getByRole('region', { name: `${title} details`, exact: true })

When('the Plugin guide is opened from the sidebar', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Plugin guide')
  await expect(guide(page).getByRole('heading', { name: 'Plugin guide', exact: true })).toBeVisible()
})

Then('the Plugin guide names its static catalog version and never claims live occupancy', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'plugin-guide-static-version', async () => {
    await expect(guide(page).getByText(/^Static catalog · DSH \d+\.\d+\.\d+/u)).toBeVisible()
    await expect(guide(page).getByText(/Occupancy is a build-time snapshot or unavailable, never live/u)).toBeVisible()
  })
})

When('the Plugin guide shows the {string} native slot', async ({ page }: { page: Page }, slot: string) => {
  await guide(page)
    .getByRole('button', { name: /^Native slots/u })
    .click()
  await guide(page).getByRole('textbox', { name: 'Search extension surfaces', exact: true }).fill(slot)
  await guide(page)
    .getByRole('list', { name: 'Extension surfaces', exact: true })
    .getByRole('button', { name: new RegExp(`^${slot} `, 'u') })
    .first()
    .click()
  await expect(detail(page, slot)).toBeVisible()
})

Then('the slot is marked shell-owned and high risk', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'plugin-guide-shell-slot-risk', async () => {
    const card = detail(page, 'sidebar')
    await expect(card.getByText('Shell-owned · high risk', { exact: true })).toBeVisible()
    await expect(card.getByText(/any registration replaces shipped shell UI/u)).toBeVisible()
    await expect(card.getByText(/^Static \(build time\): ui-sidebar · not live$/u)).toBeVisible()
  })
})

When('the guidance is drafted for an agent', async ({ page }: { page: Page }) => {
  await detail(page, 'sidebar').getByRole('button', { name: 'Draft for agent', exact: true }).click()
})

Then('a new thread holds the guidance in its composer, unsent', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'plugin-guide-draft-only', async () => {
    const composer = page.getByRole('textbox').filter({ hasText: DRAFT_HEADER })
    await expect(composer).toHaveCount(1, { timeout: 20_000 })
    await expect(guide(page)).toBeHidden()
    // Only the composer holds it: no transcript message was sent.
    await expect(page.getByText(DRAFT_HEADER, { exact: false })).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})
