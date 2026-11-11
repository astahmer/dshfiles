import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const popover = (page: Page) => page.getByRole('dialog', { name: 'Phone pairing', exact: true })

When('the pairing QR code is opened from the sidebar footer', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Show pairing QR code', exact: true }).click()
})

Then('the phone pairing popover says phone access is off and mints no code', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'phone-pairing-sidebar-qr-off', async () => {
    await expect(popover(page).getByText('Phone access is off. Ask the agent to enable it, then open this again.', { exact: true })).toBeVisible()
    await expect(popover(page).getByRole('img', { name: 'Phone pairing QR code', exact: true })).toHaveCount(0)
    await expect(popover(page).getByTestId('pairing-code')).toHaveCount(0)
  })
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await finishJourneyAssertions(page)
})
