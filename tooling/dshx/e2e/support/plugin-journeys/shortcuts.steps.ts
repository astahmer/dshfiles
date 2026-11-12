import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { alternateModifierFor, primaryModifierFor } from './platform-modifier.js'

const collapsedSidebar = (page: Page) => page.locator('[data-sidebar-collapsed]')
const composerInput = (page: Page) => page.getByRole('textbox').first()
const cheatSheet = (page: Page) => page.locator('[data-shortcut-cheat-sheet]')

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
  // ⌘/ opens the shortcut sheet; its Customize keys button opens the Host's rebinding editor.
  await page.keyboard.press(`${primary}+Slash`)
  await expect(cheatSheet(page)).toBeVisible()
  await cheatSheet(page).getByRole('button', { name: 'Customize keys' }).click()
  await expect(cheatSheet(page)).toHaveCount(0)
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

When(
  '{string}, {string}, {string} and Option-J are typed into the composer',
  async ({ page }: { page: Page }, first: string, second: string, third: string) => {
    await page.keyboard.type(`${first}${second}`)
    await page.keyboard.press('Shift+Slash')
    await page.keyboard.press('Alt+KeyJ')
    expect(third).toBe('?')
  },
)

Then('the composer holds {string} and no shortcut ran', async ({ page }: { page: Page }, typed: string) => {
  await recordAssertion(page, 'shortcuts-single-keys-type-in-the-composer', async () => {
    await expect
      .poll(async () =>
        (
          await composerInput(page).evaluate(element =>
            element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement ? element.value : (element.textContent ?? ''),
          )
        ).includes(typed),
      )
      .toBe(true)
    await expect(cheatSheet(page)).toHaveCount(0)
  })
})

When('{string} is pressed outside any text field', async ({ page }: { page: Page }, key: string) => {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.keyboard.press(key === '?' ? 'Shift+Slash' : key)
})

Then('the keyboard shortcut sheet opens with its sections', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'shortcuts-question-mark-opens-the-sheet', async () => {
    await expect(cheatSheet(page)).toBeVisible()
    await expect(cheatSheet(page).getByRole('heading', { name: 'Global' })).toBeVisible()
    await expect(cheatSheet(page).getByText('Keyboard shortcuts', { exact: true }).first()).toBeVisible()
  })
  await page.keyboard.press('Escape')
  await expect(cheatSheet(page)).toHaveCount(0)
  await finishJourneyAssertions(page)
})

When('the shortcut sheet is opened with primary+Slash', async ({ page }: { page: Page }) => {
  await page.keyboard.press(`${await primaryModifierFor(page)}+Slash`)
  await expect(cheatSheet(page)).toBeVisible()
})

const setSingleKeys = async (page: Page, on: boolean): Promise<void> => {
  const toggle = cheatSheet(page).getByRole('switch', { name: 'Single-key shortcuts' })
  await expect(toggle).toBeEnabled({ timeout: 20_000 })
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(on))
  await page.keyboard.press('Escape')
  await expect(cheatSheet(page)).toHaveCount(0)
}

When('single-key shortcuts are switched off in the sheet', async ({ page }: { page: Page }) => {
  await setSingleKeys(page, false)
})

When('single-key shortcuts are switched on in the sheet', async ({ page }: { page: Page }) => {
  await setSingleKeys(page, true)
})

Then('{string} no longer opens the shortcut sheet', async ({ page }: { page: Page }, _key: string) => {
  await recordAssertion(page, 'shortcuts-single-keys-off-leaves-question-mark-alone', async () => {
    await page.keyboard.press('Shift+Slash')
    await expect(cheatSheet(page)).toHaveCount(0)
  })
})

Then('{string} opens the shortcut sheet again', async ({ page }: { page: Page }, _key: string) => {
  await recordAssertion(page, 'shortcuts-single-keys-on-restores-question-mark', async () => {
    await expect(async () => {
      await page.keyboard.press('Shift+Slash')
      await expect(cheatSheet(page)).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
  })
  await page.keyboard.press('Escape')
  await finishJourneyAssertions(page)
})
