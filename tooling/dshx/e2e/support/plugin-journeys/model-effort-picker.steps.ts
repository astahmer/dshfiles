import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const reasoningEffort = (page: Page) => page.getByRole('region', { name: 'Reasoning effort', exact: true })
const pickerSelectionByPage = new WeakMap<Page, { readonly model: string; readonly effort: string }>()

When('a submitted prompt opens a scratch Session', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await expect(composer).toBeVisible()
  await composer.fill('Open a scratch Session for the model picker')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('Open a scratch Session for the model picker', { exact: true })).toBeVisible()
  await expect(page.getByText('MISSING_CREDENTIAL', { exact: true })).toBeVisible()
})

When('the composer model picker is searched for an unavailable model', async ({ page }: { page: Page }) => {
  const trigger = page.locator('[data-model-picker-text]')
  const selectedModel = (await trigger.innerText()).trim()
  const effortLabel = page.locator('[data-model-picker-effort]')
  const selectedEffort = (await effortLabel.innerText()).trim()
  await expect(trigger).toBeVisible()
  await expect(effortLabel).toBeVisible()
  pickerSelectionByPage.set(page, { model: selectedModel, effort: selectedEffort })
  await trigger.click()

  const modelList = page.getByRole('list', { name: 'Models grouped by provider', exact: true })
  const providerGroups = modelList.locator('section[aria-label]')
  await expect(providerGroups.first()).toBeVisible()
  await expect(modelList.getByText(selectedModel, { exact: true })).toBeVisible()

  const search = page.getByRole('textbox', { name: 'Search models and providers', exact: true })
  await expect(search).toBeVisible()
  await search.fill('zz-no-provider-model-83914')
  await expect(modelList.getByText('No matching models.', { exact: true })).toBeVisible()
})

Then('an empty search preserves the selected model and reasoning controls', async ({ page }: { page: Page }) => {
  const selection = pickerSelectionByPage.get(page)
  if (selection === undefined) throw new Error('The model picker selection was not captured before search.')

  await recordAssertion(page, 'empty-search-preserves-model-and-reasoning', async () => {
    const model = page.locator('[data-model-picker-text]')
    const effortLabel = page.locator('[data-model-picker-effort]')
    await expect(model).toHaveText(selection.model)
    await expect(effortLabel).toHaveText(selection.effort)
    await expect(page.getByRole('list', { name: 'Models grouped by provider', exact: true }).getByText('No matching models.', { exact: true })).toBeVisible()

    const effort = reasoningEffort(page)
    await expect(effort.getByRole('slider')).toBeVisible()
    await expect(effort.getByRole('button', { name: selection.effort, exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
})

When('the reasoning-effort slider is adjusted one step', async ({ page }: { page: Page }) => {
  const selection = pickerSelectionByPage.get(page)
  if (selection === undefined) throw new Error('The model picker selection was not captured before adjusting reasoning effort.')

  const effort = reasoningEffort(page)
  const slider = effort.getByRole('slider')
  await expect(slider).toBeVisible()
  const currentValueAttribute = await slider.getAttribute('aria-valuenow')
  const minimumAttribute = await slider.getAttribute('aria-valuemin')
  const maximumAttribute = await slider.getAttribute('aria-valuemax')
  if (currentValueAttribute === null || minimumAttribute === null || maximumAttribute === null) {
    throw new Error('The reasoning slider did not expose its accessible value range.')
  }

  const currentValue = Number(currentValueAttribute)
  const minimum = Number(minimumAttribute)
  const maximum = Number(maximumAttribute)
  if (![currentValue, minimum, maximum].every(Number.isInteger)) throw new Error('The reasoning slider exposed a non-integer value range.')

  const direction = currentValue > minimum ? 'ArrowLeft' : 'ArrowRight'
  const targetValue = direction === 'ArrowLeft' ? currentValue - 1 : currentValue + 1
  if (targetValue < minimum || targetValue > maximum) throw new Error('The reasoning slider has no adjacent value to select.')

  const targetEffort = (await effort.getByRole('button').nth(targetValue).innerText()).trim()
  await slider.press(direction)
  await expect(slider).toHaveAttribute('aria-valuenow', String(targetValue))
  pickerSelectionByPage.set(page, { model: selection.model, effort: targetEffort })
})

Then('the picker reflects the adjusted reasoning effort', async ({ page }: { page: Page }) => {
  const selection = pickerSelectionByPage.get(page)
  if (selection === undefined) throw new Error('The adjusted model picker selection was not captured.')

  await recordAssertion(page, 'reasoning-slider-updates-selected-effort', async () => {
    await expect(page.locator('[data-model-picker-text]')).toHaveText(selection.model)
    await expect(page.locator('[data-model-picker-effort]')).toHaveText(selection.effort)
    await expect(reasoningEffort(page).getByRole('button', { name: selection.effort, exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
  await finishJourneyAssertions(page)
})
