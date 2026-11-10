import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { seedWebCitationsSession } from '../seed-web-citations-session.mjs'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'

const PACKAGE_ID = '@dshfiles/web-fetch-readable'

When('the readable web fetch plugin is opened in the Plugins panel', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Plugins')
  await page.getByRole('button', { name: `View ${PACKAGE_ID}`, exact: true }).click()
})

Then('its fetch provider component is running', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'web-fetch-readable-component-running', async () => {
    const component = page.getByRole('listitem').filter({ hasText: 'dshfiles-web-fetch-readable' })
    await expect(component).toContainText('Running')
    await expect(component.getByRole('switch', { name: `Enable component ${PACKAGE_ID}`, exact: true })).toBeChecked()
  })
  await finishJourneyAssertions(page)
})

When('a thread whose web search and fetch returned pages is opened', async ({ page }: { page: Page }) => {
  await seedWebCitationsSession({ homeRoot: profileFor(page).homeRoot })
  const fixture = page.getByRole('treeitem', { name: /Untitled|Web citations fixture/ })
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
  const details = page.getByText(/^Completed in /).last()
  await expect(details).toBeVisible({ timeout: 30_000 })
  await details.click()
  // The turn's tool calls are summarized behind one disclosure; open it so each web row renders its own card.
  await page.getByText('Searched the web and visited web pages').click()
})

Then('each web result shows a source chip with its host and title', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'web-fetch-readable-citation-chips', async () => {
    const search = page.locator('[data-web-citations]').filter({ has: page.locator('[data-web-citation="github.com"]') })
    await expect(search.getByRole('link', { name: 'Working copy - Jujutsu docs (https://jj-vcs.github.io/jj/latest/working-copy/)' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(search.getByRole('link', { name: 'jj-vcs/jj: A Git-compatible VCS (https://github.com/jj-vcs/jj)' })).toBeVisible()
    const fetched = page.locator('[data-web-citations]').filter({ hasNotText: 'github.com' })
    await expect(fetched.getByRole('link', { name: 'Working copy (https://jj-vcs.github.io/jj/latest/working-copy/)' })).toBeVisible()
  })
  const shots = process.env.DSHX_E2E_SHOT_DIR
  if (shots !== undefined) await page.screenshot({ path: `${shots}/web-citations.png` })
})

When('a source chip is clicked', async ({ page }: { page: Page }) => {
  const chip = page.locator('[data-web-citation="github.com"]').first()
  await expect(chip).toHaveAttribute('href', 'https://github.com/jj-vcs/jj')
  await expect(chip).toHaveAttribute('target', '_blank')
  const popup = page.context().waitForEvent('page', { timeout: 10_000 }).catch(() => undefined)
  await chip.click()
  const opened = await popup
  await recordAssertion(page, 'web-fetch-readable-citation-opens', async () => {
    // A scratch Host has no external network, so the tab may stay blank; the click either opened it or the pane took it.
    expect(opened !== undefined || (await page.getByTitle('https://github.com/jj-vcs/jj').count()) > 0).toBe(true)
  })
  await opened?.close().catch(() => undefined)
  await finishJourneyAssertions(page)
})
