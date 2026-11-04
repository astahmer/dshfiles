import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const gallery = (page: Page) => page.getByRole('heading', { name: 'Components', exact: true, level: 1 })
const cards = (page: Page, category: string) => page.getByRole('list', { name: `${category} components`, exact: true }).getByRole('listitem')

When('the component gallery is opened', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Component Gallery: Components')
  await expect(gallery(page)).toBeVisible()
})

Then('the gallery shows the {string} category with its components', async ({ page }: { page: Page }, category: string) => {
  await recordAssertion(page, 'component-gallery-category-renders', async () => {
    await expect(page.getByRole('tab', { name: new RegExp(`^${category}`), selected: true })).toBeVisible()
    await expect(cards(page, category).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Replay / }).first()).toBeVisible()
  })
})

When('the gallery switches to the {string} category', async ({ page }: { page: Page }, category: string) => {
  await page.getByRole('tab', { name: new RegExp(`^${category}`) }).click()
  await expect(cards(page, category).first()).toBeVisible()
})

When('the gallery is filtered by {string}', async ({ page }: { page: Page }, query: string) => {
  await page.getByRole('textbox', { name: 'Filter components', exact: true }).fill(query)
})

Then('only the {string} component is listed', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'component-gallery-filter-narrows', async () => {
    await expect(cards(page, 'Kit')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: title, exact: true, level: 2 })).toBeVisible()
  })
})

Then('the gallery says nothing matches and how to recover', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'component-gallery-no-match-recovery', async () => {
    await expect(page.getByText(/No component matches .*Clear the filter/)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
