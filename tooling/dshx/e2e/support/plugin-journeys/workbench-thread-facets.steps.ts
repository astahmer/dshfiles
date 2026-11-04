import { expect, type Locator, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { recordAssertion } from '../steps.js'

const regions = ['main', 'right', 'left', 'bottom'] as const
type Region = (typeof regions)[number]
const regionOf = (name: string): Region => {
  const region = regions.find(value => value === name)
  if (region === undefined) throw new Error(`Unknown Workbench pane ${name}`)
  return region
}
const pane = (page: Page, region: Region): Locator => page.locator(`[data-workbench-region="${region}"]`).first()
const threadOnScreen = (page: Page): string | null => new URL(page.url()).searchParams.get('thread')
/** The facet bodies the native seat portals into a pane, by the tab title the pane shows for them. */
const facetBodies = (scope: Locator): Locator => scope.locator('[data-sidebar-resource-panel]')
/** Evidence ids are static per step occurrence: one per check of the bound thread. */
const boundChecks = new WeakMap<Page, number>()

When('the {string} pane opens the {string} thread facet from its view chooser', async ({ page }: { page: Page }, regionName: string, facet: string) => {
  const region = regionOf(regionName)
  const target = pane(page, region)
  if (region === 'right' && !(await target.isVisible())) {
    await pane(page, 'main').getByRole('button', { name: 'Pane options', exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('menuitem', { name: 'Open right pane', exact: true }).click()
    await expect(target).toBeVisible()
  }
  let chooser = target.getByRole('region', { name: 'Choose a view', exact: true }).filter({ visible: true })
  if ((await chooser.count()) === 0) {
    await target.getByRole('button', { name: 'New tab', exact: true }).filter({ visible: true }).first().click()
    chooser = target.getByRole('region', { name: 'Choose a view', exact: true }).filter({ visible: true })
  }
  await expect(chooser).toHaveCount(1)
  const facets = chooser.getByRole('group', { name: 'Thread panels', exact: true })
  const row = facets.getByRole('button', { name: new RegExp(`^${facet}`, 'u') })
  await recordAssertion(page, facet === 'Cost' ? 'thread-facets-chooser-lists-cost' : 'thread-facets-chooser-lists-jobs', async () => {
    // Listed from the native guide entry: its title and its one-line description.
    await expect(row).toBeEnabled()
    await expect(row).toContainText("This thread's")
  })
  const before = await facetBodies(target).count()
  await row.click()
  await expect(chooser).toBeHidden()
  await expect(facetBodies(target)).toHaveCount(before + 1)
})

Then('the {string} pane shows the {string} and {string} facets for the thread on screen', async ({ page }: { page: Page }, regionName: string, first: string, second: string) => {
  const region = regionOf(regionName)
  const target = pane(page, region)
  const sessionId = threadOnScreen(page)
  if (sessionId === null) throw new Error('No thread is on screen')
  const check = (boundChecks.get(page) ?? 0) + 1
  boundChecks.set(page, check)
  await recordAssertion(page, check === 1 ? 'thread-facets-bound-to-first-thread' : 'thread-facets-follow-the-next-thread', async () => {
    await expect(target).toBeVisible()
    for (const title of [first, second]) await expect(target.getByRole('tab', { name: title, exact: true })).toHaveCount(1)
    // Every facet body in the pane renders for the thread on screen, through its sessionId.
    await expect
      .poll(async () => (await facetBodies(target).evaluateAll(bodies => bodies.map(body => body.getAttribute('data-sidebar-right-session')))).join(','))
      .toBe([sessionId, sessionId].join(','))
  })
})

When('another thread comes on screen', async ({ page }: { page: Page }) => {
  const previous = threadOnScreen(page)
  await page.getByRole('button', { name: 'New thread', exact: true }).filter({ visible: true }).first().click()
  await expect.poll(() => threadOnScreen(page)).not.toBe(previous)
  await expect.poll(() => threadOnScreen(page)).not.toBeNull()
})
