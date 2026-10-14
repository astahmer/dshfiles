import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { sendMessage } from '../threads.js'

const STORAGE_KEY = 'dshfiles.main-tabs.v1'

const strip = (page: Page) => page.getByRole('tablist', { name: 'Open views', exact: true })
const tab = (page: Page, name: string) => strip(page).getByRole('tab', { name, exact: true })
const globalPanel = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name, exact: true })

/** Each tab as "<name>" plus "*" when active, "(preview)" and "(pinned)" markers, in strip order. */
const tabSummary = (page: Page): Promise<readonly string[]> =>
  strip(page)
    .getByRole('tab')
    .evaluateAll(nodes =>
      nodes.map(node => {
        const element = node instanceof HTMLElement ? node : null
        const name = node.getAttribute('aria-label') ?? ''
        const active = node.getAttribute('aria-selected') === 'true' ? '*' : ''
        const preview = element?.dataset.preview === undefined ? '' : ' (preview)'
        const pinned = element?.dataset.pinned === undefined ? '' : ' (pinned)'
        return `${name}${active}${preview}${pinned}`
      }),
    )

const openKept = async (page: Page, name: string): Promise<void> => {
  await globalPanel(page, name).click()
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true')
  await tab(page, name).dblclick()
  await expect(tab(page, name)).not.toHaveAttribute('data-preview')
}

/**
 * Where the strip landed, read from the DOM: a DSH upgrade that drops the `main` slot outlet or reshapes the main
 * column fails here instead of hiding the strip silently.
 */
const stripPlacement = (page: Page) =>
  page.evaluate(() => {
    const hosts = document.querySelectorAll('[data-dshfiles-main-tabs]')
    const host = hosts[0]
    const outlet = host?.nextElementSibling
    const strip = host?.querySelector('[role="tablist"]')?.closest('[data-dshfiles-main-tabs] > *')
    let panel = outlet?.matches('[data-slot="main"]') === true ? outlet.firstElementChild : null
    while (panel !== null && panel !== undefined && getComputedStyle(panel).display === 'contents') panel = panel.firstElementChild
    const stripBox = strip?.getBoundingClientRect()
    const panelBox = panel?.getBoundingClientRect()
    return {
      hosts: hosts.length,
      anchoredBeforeMainOutlet: outlet?.matches('[data-slot="main"]') === true,
      aboveMainPanel: stripBox !== undefined && panelBox !== undefined && stripBox.height > 0 && stripBox.bottom <= panelBox.top + 1,
      sameColumn:
        stripBox !== undefined && panelBox !== undefined && Math.abs(stripBox.left - panelBox.left) <= 1 && Math.abs(stripBox.right - panelBox.right) <= 1,
    }
  })

const expectedPlacement = { hosts: 1, anchoredBeforeMainOutlet: true, aboveMainPanel: true, sameColumn: true }

const primary = (): string => (process.platform === 'darwin' ? 'Meta' : 'Control')

When('the Workbench and then Jujutsu are opened from the sidebar', async ({ page }: { page: Page }) => {
  await globalPanel(page, 'Workbench').click()
  await expect(tab(page, 'Workbench')).toBeVisible()
  await globalPanel(page, 'Jujutsu').click()
})

Then('Jujutsu replaced the Workbench preview tab', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-preview-tab-is-replaced', () => expect.poll(() => tabSummary(page)).toEqual(['Jujutsu* (preview)']))
})

When('the Jujutsu tab is kept, the Workbench is opened again and a thread is started', async ({ page }: { page: Page }) => {
  await tab(page, 'Jujutsu').dblclick()
  await openKept(page, 'Workbench')
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await sendMessage(page, 'tabs thread')
})

Then('each of them has its own tab and the thread tab is active', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-panels-and-threads-get-tabs', () =>
    expect.poll(() => tabSummary(page)).toEqual(['Jujutsu', 'Workbench', 'tabs thread* (preview)']),
  )
  await tab(page, 'tabs thread').dblclick()
})

When('the Workbench tab is pinned and the thread tab is dragged before Jujutsu', async ({ page }: { page: Page }) => {
  await tab(page, 'Workbench').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
  await tab(page, 'tabs thread').dragTo(tab(page, 'Jujutsu'), { targetPosition: { x: 4, y: 10 } })
})

Then('the pinned tab leads and the thread tab moved', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-pin-and-reorder', () => expect.poll(() => tabSummary(page)).toEqual(['Workbench (pinned)', 'tabs thread*', 'Jujutsu']))
})

When('the Jujutsu tab is closed with a middle click and other tabs are closed from the thread tab', async ({ page }: { page: Page }) => {
  await tab(page, 'Jujutsu').click({ button: 'middle' })
  await expect(tab(page, 'Jujutsu')).toHaveCount(0)
  await openKept(page, 'Jujutsu')
  await tab(page, 'tabs thread').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close other tabs', exact: true }).click()
})

Then('only the pinned Workbench and the thread remain', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-close-others-keeps-pinned', async () => {
    await expect.poll(() => tabSummary(page)).toEqual(['Workbench (pinned)', 'tabs thread*'])
    await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the Workbench is opened as a tab', async ({ page }: { page: Page }) => {
  await globalPanel(page, 'Workbench').click()
  await expect(tab(page, 'Workbench')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible()
})

Then('the tab strip sits directly above the main panel, anchored before the main slot outlet', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-strip-mounts-above-main-panel', () => expect.poll(() => stripPlacement(page)).toEqual(expectedPlacement))
})

When('a thread is started beside the Workbench tab', async ({ page }: { page: Page }) => {
  await tab(page, 'Workbench').dblclick()
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await sendMessage(page, 'mount thread')
  await expect(tab(page, 'mount thread')).toHaveAttribute('aria-selected', 'true')
})

Then('the tab strip still sits directly above the main panel', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-strip-follows-panel-changes', async () => {
    await expect.poll(() => stripPlacement(page)).toEqual(expectedPlacement)
    await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the Workbench and Jujutsu are opened and kept as tabs', async ({ page }: { page: Page }) => {
  await openKept(page, 'Workbench')
  await openKept(page, 'Jujutsu')
})

Then('the tab shortcuts jump to the first and last tab and cycle between them', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-keyboard-jump-and-cycle', async () => {
    await page.keyboard.press(`${primary()}+Alt+Digit1`)
    await expect(tab(page, 'Workbench')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible()
    await page.keyboard.press(`${primary()}+Alt+Digit9`)
    await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press(`${primary()}+Alt+BracketRight`)
    await expect(tab(page, 'Workbench')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press(`${primary()}+Alt+BracketLeft`)
    await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
  })
  await finishJourneyAssertions(page)
})

When('the Workbench tab is pinned and the page is reloaded', async ({ page }: { page: Page }) => {
  await tab(page, 'Workbench').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
  await expect(tab(page, 'Workbench')).toHaveAttribute('data-pinned', 'true')
  await page.reload()
})

Then('the tabs come back with the pin and the Jujutsu tab is active again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-restore-after-reload', async () => {
    await expect.poll(() => tabSummary(page)).toEqual(['Workbench (pinned)', 'Jujutsu*'])
    await expect(page.getByRole('heading', { name: 'Jujutsu', exact: true })).toBeVisible()
  })
})

When('the saved tabs are corrupted and the page is reloaded', async ({ page }: { page: Page }) => {
  await page.evaluate(key => localStorage.setItem(key, '{"sets":"truncated'), STORAGE_KEY)
  await page.reload()
  await globalPanel(page, 'Workbench').click()
})

Then('the strip starts over from what the main view shows', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-malformed-storage-starts-over', () => expect.poll(() => tabSummary(page)).toEqual(['Workbench* (preview)']))
  await finishJourneyAssertions(page)
})
