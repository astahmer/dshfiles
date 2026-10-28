import { expect, test, type Page } from '@playwright/test'
import { globalPanelLink } from '../plugin-view-names.js'
import { Then, When } from '../bdd.js'
import { browserDiagnosticsFor, finishJourneyAssertions, recordAssertion, reloadPastProviderSetup } from '../steps.js'

const navigationAborts = new WeakMap<Page, Set<number>>()

const editDialog = (page: Page) => page.getByRole('dialog', { name: 'Edit resource', exact: true })
const rowFor = (page: Page, label: string) => page.getByRole('row').filter({ has: page.getByRole('button', { name: `Edit ${label}`, exact: true }) })

const openEditor = async (page: Page, label: string): Promise<void> => {
  await page.getByRole('button', { name: `Edit ${label}`, exact: true }).click()
  await expect(editDialog(page)).toBeVisible()
}

const selectPack = async (page: Page, label: string): Promise<void> => {
  await page.getByRole('combobox', { name: 'Property pack', exact: true }).click()
  await page
    .getByRole('option')
    .filter({ has: page.getByText(label, { exact: true }) })
    .click()
  await expect(page.getByRole('combobox', { name: 'Property pack', exact: true })).toBeFocused()
}

When('the Resources page is opened', async ({ page }: { page: Page }) => {
  await globalPanelLink(page, 'Resource Packs: Resources').click()
  await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Property pack', exact: true })).toBeVisible()
})

When(
  'a resource {string} references {string} {string} {string}',
  async ({ page }: { page: Page }, label: string, provider: string, kind: string, id: string) => {
    await page.getByRole('button', { name: 'Add resource', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add resource', exact: true })
    await dialog.getByRole('textbox', { name: 'Provider', exact: true }).fill(provider)
    await dialog.getByRole('combobox', { name: 'Kind', exact: true }).click()
    await page.getByRole('option', { name: kind, exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Native ID', exact: true }).fill(id)
    await dialog.getByRole('textbox', { name: 'Resource label', exact: true }).fill(label)
    await dialog.getByRole('button', { name: 'Register resource', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(rowFor(page, label)).toBeVisible()
  },
)

When('the Tracking pack is attached to resource {string}', async ({ page }: { page: Page }, label: string) => {
  await selectPack(page, 'Tracking')
  await openEditor(page, label)
  await editDialog(page).getByRole('button', { name: 'Attach pack', exact: true }).click()
  await expect(editDialog(page).getByLabel('Assignee', { exact: true })).toBeVisible()
  await editDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editDialog(page)).toBeHidden()
})

When(
  'the Tracking values of {string} are saved as assignee {string} and due date {string}',
  async ({ page }: { page: Page }, label: string, assignee: string, date: string) => {
    await openEditor(page, label)
    const dialog = editDialog(page)
    await dialog.getByLabel('Assignee', { exact: true }).fill(assignee)
    await dialog.getByLabel('Due date', { exact: true }).fill(date)
    await dialog.getByRole('combobox', { name: 'Status', exact: true }).click()
    await page.getByRole('option', { name: 'In progress', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
  },
)

Then('the resource table shows {string} with {string}', async ({ page }: { page: Page }, label: string, value: string) => {
  await expect(rowFor(page, label)).toBeVisible()
  await expect(rowFor(page, label)).toContainText(value)
})

When('the Resources page is reloaded', async ({ page }: { page: Page }) => {
  const before = browserDiagnosticsFor(page).length
  await reloadPastProviderSetup(page)
  // Chromium cancels the native SSE stream during an explicit reload. Admit only that exact
  // cancellation, within this navigation interval; keep every other diagnostic as a failure.
  const admitted = navigationAborts.get(page) ?? new Set<number>()
  browserDiagnosticsFor(page).forEach((diagnostic, index) => {
    if (index >= before && diagnostic === 'requestfailed: eventsource net::ERR_ABORTED') admitted.add(index)
  })
  navigationAborts.set(page, admitted)
  await globalPanelLink(page, 'Resource Packs: Resources').click()
  await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible()
})

When('the Tracking pack is detached from resource {string} with confirmation', async ({ page }: { page: Page }, label: string) => {
  await openEditor(page, label)
  await editDialog(page).getByRole('button', { name: 'Detach pack', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm detach', exact: true }).click()
  await expect(editDialog(page).getByRole('button', { name: 'Attach pack', exact: true })).toBeVisible()
  await editDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

Then('the resource editor retains {string} and {string}', async ({ page }: { page: Page }, assignee: string, date: string) => {
  await openEditor(page, 'Review conversation')
  await recordAssertion(page, 'reattach-retains-values', async () => {
    await expect(editDialog(page).getByLabel('Assignee', { exact: true })).toHaveValue(assignee)
    await expect(editDialog(page).getByLabel('Due date', { exact: true })).toHaveValue(date)
  })
  await editDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

When('a Review pack with a Reviewer text property is created', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New pack', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New pack', exact: true })
  await dialog.getByRole('textbox', { name: 'Pack label', exact: true }).fill('Review')
  await dialog.getByRole('textbox', { name: 'Pack ID', exact: true }).fill('review')
  await dialog.getByRole('textbox', { name: 'Field 1 label', exact: true }).fill('Reviewer')
  await dialog.getByRole('textbox', { name: 'Field 1 ID', exact: true }).fill('reviewer')
  await dialog.getByRole('button', { name: 'Create pack', exact: true }).click()
  await expect(dialog).toBeHidden()
  await selectPack(page, 'Review')
})

When('the Review pack is attached to resource {string}', async ({ page }: { page: Page }, label: string) => {
  await selectPack(page, 'Review')
  await openEditor(page, label)
  await editDialog(page).getByRole('button', { name: 'Attach pack', exact: true }).click()
  await expect(editDialog(page).getByLabel('Reviewer', { exact: true })).toBeVisible()
  await editDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

When('resource {string} is assigned reviewer {string}', async ({ page }: { page: Page }, label: string, reviewer: string) => {
  await openEditor(page, label)
  await editDialog(page).getByLabel('Reviewer', { exact: true }).fill(reviewer)
  await editDialog(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editDialog(page)).toBeHidden()
})

When('the Review pack is selected', async ({ page }: { page: Page }) => selectPack(page, 'Review'))

Then('the Resources journey has no browser errors', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'clean-browser', () => {
    const unexpected = browserDiagnosticsFor(page).filter((_diagnostic, index) => navigationAborts.get(page)?.has(index) !== true)
    expect(unexpected).toEqual([])
  })
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await recordAssertion(page, 'responsive-resource-table', async () => {
    for (const width of [360, 480, 768, 1024]) {
      await page.setViewportSize({ width, height: 800 })
      const region = page.getByRole('region', { name: 'Resource table', exact: true })
      await expect(region).toBeVisible()
      const geometry = await region.evaluate(element => ({
        pageWidth: document.documentElement.scrollWidth,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }))
      expect(geometry.pageWidth).toBeLessThanOrEqual(width + 1)
      if (geometry.scrollWidth > geometry.clientWidth) {
        const moved = await region.evaluate(element => {
          element.scrollLeft = element.scrollWidth
          return element.scrollLeft
        })
        expect(moved).toBeGreaterThan(0)
      }
      await region.evaluate(element => {
        element.scrollLeft = 0
      })
    }
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click({ trial: true })
  await page.screenshot({ path: test.info().outputPath('local-properties.png') })
  await finishJourneyAssertions(page)
})
