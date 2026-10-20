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
  const modelBounds = await trigger.boundingBox()
  const effortBounds = await effortLabel.boundingBox()
  if (modelBounds === null || effortBounds === null) throw new Error('The composer model and reasoning labels have no visible bounds.')
  expect(Math.abs(modelBounds.y - effortBounds.y)).toBeLessThan(2)
  pickerSelectionByPage.set(page, { model: selectedModel, effort: selectedEffort })
  await trigger.click()

  await expect(page.getByText('Choose a model', { exact: true })).toHaveCount(0)
  const modelList = page.getByRole('list', { name: 'Models grouped by provider', exact: true })
  const providerGroups = modelList.locator('section[aria-label]')
  await expect(providerGroups.first()).toBeVisible()
  const search = page.getByRole('textbox', { name: 'Search models and providers', exact: true })
  const modelOptions = modelList.locator('[data-model-picker-option]')
  await search.press('ArrowDown')
  await expect(modelOptions.first()).toBeFocused()
  await modelOptions.first().press('ArrowDown')
  await expect(modelOptions.nth(1)).toBeFocused()
  await modelOptions.nth(1).press('ArrowUp')
  await expect(modelOptions.first()).toBeFocused()
  await modelOptions.first().press('ArrowUp')
  await expect(search).toBeFocused()

  const popoverBounds = await page.getByRole('dialog').boundingBox()
  if (popoverBounds === null) throw new Error('The model picker popover has no visible bounds.')
  expect(popoverBounds.width).toBeLessThanOrEqual(430)
  const effort = reasoningEffort(page)
  const providerDefault = effort.getByRole('button', { name: 'Use provider default', exact: true })
  await expect(providerDefault).toBeVisible()
  const defaultBounds = await providerDefault.boundingBox()
  const slider = effort.getByRole('slider')
  const sliderBounds = await slider.boundingBox()
  if (defaultBounds === null || sliderBounds === null) throw new Error('The reasoning controls have no visible bounds.')
  expect(defaultBounds.y + defaultBounds.height).toBeLessThan(sliderBounds.y)
  const trackBounds = await effort.locator('[data-model-effort-slider] [data-slot="slider-track"]').boundingBox()
  if (trackBounds === null) throw new Error('The effort slider track has no visible bounds.')
  expect(trackBounds.height).toBeGreaterThanOrEqual(10)
  expect(sliderBounds.width).toBeGreaterThanOrEqual(20)
  const accentRange = await effort.locator('[data-model-effort-slider] [data-slot="slider-range"]').evaluate(element => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--dsw-alias-state-business-primary)'
    document.body.append(probe)
    const accentColor = getComputedStyle(probe).backgroundColor
    probe.remove()
    return accentColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(element).backgroundColor === accentColor
  })
  expect(accentRange).toBe(true)
  expect(await effort.locator('[data-model-effort-slider-markers] [data-model-effort-marker]').count()).toBe(
    await effort.locator('[data-model-effort-option]').count(),
  )

  await expect(modelList.getByText(selectedModel, { exact: true })).toBeVisible()
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

  const targetEffort = (await effort.locator('[data-model-effort-option]').nth(targetValue).innerText()).trim()
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
