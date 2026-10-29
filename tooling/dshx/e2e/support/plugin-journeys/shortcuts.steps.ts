import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

type ModifierKey = 'Control' | 'Meta'

const collapsedSidebar = (page: Page) => page.locator('[data-sidebar-collapsed]')
const composerInput = (page: Page) => page.getByRole('textbox').first()

const primaryModifierFor = async (page: Page): Promise<ModifierKey> => {
  const platform = await page.evaluate(() => navigator.platform)
  if (platform === 'macOS' || platform.startsWith('Mac')) return 'Meta'
  return 'Control'
}

const alternateModifierFor = async (page: Page): Promise<ModifierKey> => ((await primaryModifierFor(page)) === 'Meta' ? 'Control' : 'Meta')

const pressPrimaryB = async (page: Page): Promise<void> => {
  await page.keyboard.press(`${await primaryModifierFor(page)}+b`)
}

const recordExpandedSidebar = async (page: Page, assertionId: string): Promise<void> => {
  await recordAssertion(page, assertionId, () => expect(collapsedSidebar(page)).toHaveCount(0))
}

const recordCollapsedSidebar = async (page: Page, assertionId: string): Promise<void> => {
  await recordAssertion(page, assertionId, () => expect(collapsedSidebar(page)).toHaveCount(1))
}

When('the composer is focused', async ({ page }: { page: Page }) => {
  const input = composerInput(page)
  await expect(input).toBeVisible()
  await input.focus()
})

When('the platform primary+B chord is pressed', async ({ page }: { page: Page }) => {
  await pressPrimaryB(page)
})

When('the alternate platform modifier+B chord is pressed', async ({ page }: { page: Page }) => {
  await page.keyboard.press(`${await alternateModifierFor(page)}+b`)
})

When('the platform primary+B key is held and repeated before release', async ({ page }: { page: Page }) => {
  const primaryModifier = await primaryModifierFor(page)
  await page.keyboard.down(primaryModifier)
  await page.keyboard.down('b')
  await page.keyboard.down('b')
  await page.keyboard.up('b')
  await page.keyboard.up(primaryModifier)
})

When('primary+Shift+B is pressed', async ({ page }: { page: Page }) => {
  await page.keyboard.press(`${await primaryModifierFor(page)}+Shift+b`)
})

Then('the sidebar starts expanded', async ({ page }: { page: Page }) => {
  await recordExpandedSidebar(page, 'shortcuts-sidebar-starts-expanded')
})

Then('the sidebar toggles closed and reopens', async ({ page }: { page: Page }) => {
  await recordCollapsedSidebar(page, 'shortcuts-primary-b-collapses-sidebar')
  await pressPrimaryB(page)
  await recordExpandedSidebar(page, 'shortcuts-primary-b-reopens-sidebar')
  await finishJourneyAssertions(page)
})

Then('the sidebar remains expanded after the alternate chord', async ({ page }: { page: Page }) => {
  await recordExpandedSidebar(page, 'shortcuts-alternate-modifier-does-not-toggle-sidebar')
})

Then('the sidebar toggles and is restored with the primary modifier', async ({ page }: { page: Page }) => {
  await recordCollapsedSidebar(page, 'shortcuts-current-platform-primary-toggles-sidebar')
  await pressPrimaryB(page)
  await recordExpandedSidebar(page, 'shortcuts-current-platform-primary-restores-sidebar')
  await finishJourneyAssertions(page)
})

Then('the sidebar toggles only once for the repeated keydown', async ({ page }: { page: Page }) => {
  await recordCollapsedSidebar(page, 'shortcuts-repeated-primary-b-toggles-only-once')
  await pressPrimaryB(page)
  await recordExpandedSidebar(page, 'shortcuts-repeated-primary-b-restores-sidebar')
  await finishJourneyAssertions(page)
})

Then('the sidebar remains expanded after the unmatched chord', async ({ page }: { page: Page }) => {
  await recordExpandedSidebar(page, 'shortcuts-extra-shift-does-not-toggle-sidebar')
  await finishJourneyAssertions(page)
})

const RUNS_ATTRIBUTE = 'data-shortcuts-journey-runs'

const runsOf = async (page: Page): Promise<string | null> => page.locator('body').getAttribute(RUNS_ATTRIBUTE)

When('a plugin contributes the editable command {string} on {string}', async ({ page }: { page: Page }, title: string, chord: string) => {
  await page.waitForFunction(() => globalThis.__dshxBrokerV1?.registries.get('dshx.command') !== undefined)
  await page.evaluate(
    ({ title, chord, attribute }) => {
      const broker = globalThis.__dshxBrokerV1
      const registry = broker?.registries.get('dshx.command')
      if (broker === undefined || registry === undefined) throw new Error('No dshx command registry on the page')
      document.body.setAttribute(attribute, '0')
      // The journey stands in for a third plugin's `api.add(Command, …)`: same broker entry, then the registry's notification.
      const run = (): void => document.body.setAttribute(attribute, String(Number(document.body.getAttribute(attribute)) + 1))
      registry.entries.set(broker.nextEntryId, { owner: '@journey/probe', item: { id: '@journey/probe.hello', title, keys: [chord], editable: true, run } })
      broker.nextEntryId += 1
      registry.snapshot = Object.freeze([...registry.entries.values()].map(entry => entry.item))
      for (const listener of [...registry.listeners]) listener()
    },
    { title, chord, attribute: RUNS_ATTRIBUTE },
  )
})

When('{string} is rebound to primary+Shift+U in Keyboard shortcuts', async ({ page }: { page: Page }, title: string) => {
  const primary = await primaryModifierFor(page)
  await page.keyboard.press(`${primary}+Slash`)
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await recordAssertion(page, 'editable-command-is-listed-unbound', () =>
    expect(dialog.getByRole('button', { name: `Edit shortcut for ${title}` })).toBeVisible(),
  )
  await dialog.getByRole('button', { name: `Edit shortcut for ${title}` }).click()
  await expect(dialog.getByText('Press a shortcut')).toBeVisible()
  await page.keyboard.press(`${primary}+Shift+KeyU`)
  await expect(dialog.getByText('1 customized')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

Then('primary+Shift+U runs {string} and primary+Shift+Y no longer does', async ({ page }: { page: Page }, _title: string) => {
  const primary = await primaryModifierFor(page)
  await page.keyboard.press(`${primary}+Shift+KeyY`)
  await recordAssertion(page, 'editable-command-drops-its-default-keys', async () => expect(await runsOf(page)).toBe('0'))
  await page.keyboard.press(`${primary}+Shift+KeyU`)
  await recordAssertion(page, 'editable-command-runs-on-the-user-binding', () => expect(page.locator('body')).toHaveAttribute(RUNS_ATTRIBUTE, '1'))
  await finishJourneyAssertions(page)
})
