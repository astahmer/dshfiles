import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import type {} from '../../../packages/dshx/src/client/broker.js'
import type { ConfirmInput, DialogsService, ToastInput, ToastsService } from '../../../packages/dshx/src/client/app-services.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const ANSWER_ATTRIBUTE = 'data-dialogs-journey-answer'

/** Waits for a contract on the page-wide dshx broker, the one every plugin's `api.dialogs` / `api.toast` reads. */
const waitForProvider = async (page: Page, contract: 'dshx.dialogs' | 'dshx.toasts'): Promise<void> => {
  await page.waitForFunction(id => globalThis.__dshxBrokerV1?.contracts.get(id)?.live.status === 'active', contract)
}

When('a plugin asks to confirm deleting {string}', async ({ page }: { page: Page }, name: string) => {
  await waitForProvider(page, 'dshx.dialogs')
  const input: ConfirmInput = { title: `Delete ${name}?`, confirm: 'Delete', danger: true }
  await page.evaluate(
    ({ confirm, attribute }) => {
      const live = globalThis.__dshxBrokerV1?.contracts.get('dshx.dialogs')?.live
      if (live?.status !== 'active') throw new Error('dshx.dialogs is not provided')
      // SAFETY: the broker stores contract values untyped; `dshx.dialogs` is only ever provided with a DialogsService.
      const dialogs = live.value as DialogsService
      document.body.removeAttribute(attribute)
      void dialogs.confirm(confirm).then(answer => document.body.setAttribute(attribute, String(answer)))
    },
    { confirm: input, attribute: ANSWER_ATTRIBUTE },
  )
})

Then('the app dialog asks about {string} with focus on Cancel', async ({ page }: { page: Page }, name: string) => {
  const dialog = page.getByRole('alertdialog', { name: `Delete ${name}?` })
  await recordAssertion(page, 'dialogs-confirm-opens-app-dialog', () => expect(dialog).toBeVisible())
  await recordAssertion(page, 'dialogs-danger-focuses-cancel', () => expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused())
})

When('the user presses {string}', async ({ page }: { page: Page }, label: string) => {
  await page.getByRole('alertdialog').getByRole('button', { name: label }).click()
})

Then('the plugin receives the answer true', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'dialogs-confirm-resolves-true', async () => {
    await expect(page.locator('body')).toHaveAttribute(ANSWER_ATTRIBUTE, 'true')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('a plugin shows a sticky toast {string}', async ({ page }: { page: Page }, title: string) => {
  await waitForProvider(page, 'dshx.toasts')
  const input: ToastInput = { title, tone: 'success', duration: 0 }
  await page.evaluate(toast => {
    const live = globalThis.__dshxBrokerV1?.contracts.get('dshx.toasts')?.live
    if (live?.status !== 'active') throw new Error('dshx.toasts is not provided')
    // SAFETY: the broker stores contract values untyped; `dshx.toasts` is only ever provided with a ToastsService.
    const toasts = live.value as ToastsService
    toasts.show(toast)
  }, input)
})

Then('the toast {string} shows in the bottom-right corner', async ({ page }: { page: Page }, title: string) => {
  const toast = page.getByRole('status').filter({ hasText: title })
  await recordAssertion(page, 'dialogs-toast-visible', () => expect(toast).toBeVisible())
  await recordAssertion(page, 'dialogs-toast-bottom-right', async () => {
    const box = await toast.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    if (box === null || viewport === null) return
    expect(box.x + box.width).toBeGreaterThan(viewport.width / 2)
    expect(box.y + box.height).toBeGreaterThan(viewport.height / 2)
  })
})

When('the user dismisses the toast', async ({ page }: { page: Page }) => {
  await page.getByRole('list', { name: 'Notifications' }).getByRole('button', { name: 'Dismiss' }).click()
})

Then('no toast remains', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'dialogs-toast-dismissed', () => expect(page.getByRole('list', { name: 'Notifications' })).toHaveCount(0))
  await finishJourneyAssertions(page)
})
