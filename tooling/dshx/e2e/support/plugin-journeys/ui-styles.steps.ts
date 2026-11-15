import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { selectModelForNewThread, sendMessage } from '../threads.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion, reloadPastProviderSetup, settingsNavEntry, settingsPage } from '../steps.js'

/** The runtime theme element `@dshfiles/ui-styles` adds for a non-default Appearance (src/runtime-theme.ts). */
const RUNTIME_STYLE = '#dshfiles-ui-styles-theme'

/** One generated palette token and one Host `--dsw-*` alias a native core surface reads, as the browser resolves them. */
const themeProbe = (page: Page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.body)
    return {
      tone: style.getPropertyValue('--dshx-tone-0').trim(),
      hostBase: style.getPropertyValue('--dsw-alias-bg-base').trim(),
      hostLabel: style.getPropertyValue('--dsw-alias-label-primary').trim(),
      runtime: document.getElementById('dshfiles-ui-styles-theme') !== null,
    }
  })

const choosePreset = async (page: Page, label: RegExp): Promise<void> => {
  await openSettingsDialog(page)
  await settingsNavEntry(page, 'Appearance').click()
  const row = settingsPage(page).locator('[data-settings-namespace="dshfiles-ui-styles"] [data-setting-path="preset"]')
  await row.getByRole('combobox').click()
  await page.getByRole('option', { name: label }).click()
  await page.keyboard.press('Escape')
}

When('the Appearance preset {string} is chosen in Settings', async ({ page }: { page: Page }, preset: string) => {
  await choosePreset(page, new RegExp(`^${preset}`, 'u'))
})

const expectHue = async (page: Page, hue: number): Promise<void> => {
  await expect(page.locator(RUNTIME_STYLE)).toHaveCount(1)
  await expect.poll(async () => (await themeProbe(page)).tone).toContain(` ${hue})`)
  const probe = await themeProbe(page)
  // The Host alias resolves through the generated tone, so native surfaces repaint with the theme.
  expect(probe.hostBase).toBe(probe.tone)
  expect(probe.hostLabel).toContain(` ${hue})`)
}

Then('the page and a native Host surface follow the hue {int}', async ({ page }: { page: Page }, hue: number) => {
  await recordAssertion(page, 'ui-styles-runtime-theme-applied', () => expectHue(page, hue))
})

Then('the theme with the hue {int} is still applied', async ({ page }: { page: Page }, hue: number) => {
  await recordAssertion(page, 'ui-styles-runtime-theme-persisted', () => expectHue(page, hue))
})

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'
const lastToolResult = (page: Page): string =>
  fakeCommandCodeFor(page)
    .requests.flatMap(request => request.messages.filter(message => message.role === 'tool').map(message => message.text))
    .at(-1) ?? ''
const toolCall = (name: string, input: object): string => `[[call ${name} ${JSON.stringify(input)}]]`

When('a new thread on the fake model calls theme_set with the preset {string}', async ({ page }: { page: Page }, preset: string) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await selectModelForNewThread(page, FAKE_MODEL)
  await sendMessage(page, toolCall('theme_set', { preset }))
})

Then('theme_set answered with the preset {string} and the hue {int}', async ({ page }: { page: Page }, preset: string, hue: number) => {
  await recordAssertion(page, 'ui-styles-theme-set-result', async () => {
    await expect.poll(() => lastToolResult(page)).toContain(`"preset":"${preset}"`)
    expect(lastToolResult(page)).toContain(`"greyHue":${hue}`)
    expect(lastToolResult(page)).toContain('"isDefault":false')
  })
})

When('the thread calls theme_get', async ({ page }: { page: Page }) => {
  await sendMessage(page, toolCall('theme_get', {}))
})

Then('theme_get reports the preset {string}', async ({ page }: { page: Page }, preset: string) => {
  await recordAssertion(page, 'ui-styles-theme-get-result', () => expect.poll(() => lastToolResult(page)).toContain(`"preset":"${preset}"`))
})

When('the thread calls theme_set with reset', async ({ page }: { page: Page }) => {
  await sendMessage(page, toolCall('theme_set', { reset: true }))
})

Then('theme_set answered with the default theme', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ui-styles-theme-reset-result', async () => {
    await expect.poll(() => lastToolResult(page)).toContain('"isDefault":true')
    expect(lastToolResult(page)).toContain('"preset":"warm-stone"')
  })
})

/** A complete light scheme: every role set, so the definition passes validation as an agent's would. */
const lightScheme = (bg: string) => ({
  colours: {
    bg,
    panel: '#e5e9f0',
    raised: '#d8dee9',
    selected: '#d0d6e2',
    line: '#d8dee9',
    border: '#c5ccd8',
    borderStrong: '#aab3c3',
    strong: '#7b88a1',
    faint: '#5c677c',
    muted: '#434c5e',
    text: '#2e3440',
    accent: '#3f5f8a',
    onAccent: bg,
    success: '#3d6b2a',
    warning: '#8a5a12',
    danger: '#a3333d',
    info: '#2f6680',
  },
})

When(
  'a new thread on the fake model calls theme_define with a light theme {string} on the background {string}',
  async ({ page }: { page: Page }, id: string, bg: string) => {
    await page.getByRole('button', { name: 'New session', exact: true }).first().click()
    await selectModelForNewThread(page, FAKE_MODEL)
    await sendMessage(page, toolCall('theme_define', { theme: { id, label: 'Nord', light: lightScheme(bg) } }))
  },
)

Then('theme_define answered with the saved theme {string}', async ({ page }: { page: Page }, id: string) => {
  await recordAssertion(page, 'ui-styles-theme-define-result', async () => {
    await expect.poll(() => lastToolResult(page)).toContain(`"customTheme":"${id}"`)
    expect(lastToolResult(page)).toContain(`"savedThemes":["${id}"]`)
  })
})

Then('the page background token is {string}', async ({ page }: { page: Page }, bg: string) => {
  await recordAssertion(page, 'ui-styles-saved-theme-applied', async () => {
    await expect(page.locator(RUNTIME_STYLE)).toHaveCount(1)
    await expect.poll(async () => (await themeProbe(page)).tone).toBe(bg)
  })
})

When('a new thread on the fake model calls theme_set with the gallery theme {string}', async ({ page }: { page: Page }, id: string) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await selectModelForNewThread(page, FAKE_MODEL)
  await sendMessage(page, toolCall('theme_set', { customTheme: id }))
})

Then('theme_set answered with the saved theme {string}', async ({ page }: { page: Page }, id: string) => {
  await recordAssertion(page, 'ui-styles-gallery-theme-result', () => expect.poll(() => lastToolResult(page)).toContain(`"customTheme":"${id}"`))
})

Then('the runtime theme draws its scene on a canvas, moving only in the focused tab', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ui-styles-gallery-scene-canvas', async () => {
    // The scene's SVG comes from the Host's scene method into a stage under the backdrop host; the page's scheme shows
    // one of the theme's two scenes.
    const shown = page.locator('[data-workbench-region="main"] .dshfiles-workbench-theme > [data-dshx-scene]').filter({ visible: true })
    await expect(shown).toHaveCount(1)
    // Only resting pictures are images (under the composer seat): an animated SVG image re-rasters whole every display
    // frame. And nothing filters the scene per frame.
    const sheet = await page.evaluate(() => document.getElementById('dshfiles-ui-styles-theme')?.textContent ?? '')
    expect(sheet).toContain('data:image/svg+xml')
    expect(sheet).not.toContain(encodeURIComponent('@media (prefers-reduced-motion'))
    expect(sheet).not.toContain('backdrop-filter')
    // The scene is compiled once, then a worker draws it on a canvas that fills the stage; the resting image under it
    // goes away.
    const canvas = shown.locator('canvas')
    await expect(canvas).toHaveCount(1, { timeout: 20_000 })
    await expect.poll(() => shown.evaluate(stage => (stage as HTMLElement).style.backgroundImage), { timeout: 20_000 }).toBe('none')
    const [stageBox, canvasBox] = await Promise.all([shown.boundingBox(), canvas.boundingBox()])
    expect(canvasBox).toEqual(stageBox)
    // Only the scene is compared: the UI over it (a blinking caret) is hidden, its layout untouched.
    const hide = await page.addStyleTag({
      content: '[data-workbench-region="main"] .dshfiles-workbench-theme > :not([data-dshx-scene]) { visibility: hidden !important; }',
    })
    const frame = () => shown.screenshot({ animations: 'allow' })
    const changes = async (from: Buffer) => !(await frame()).equals(from)
    // In the focused tab the scene moves.
    const first = await frame()
    await expect.poll(() => changes(first), { timeout: 10_000 }).toBe(true)
    // Another window takes focus: this tab holds its frame and pauses the theme's layers.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
      window.dispatchEvent(new Event('blur'))
    })
    await expect(page.locator('body[data-dshx-backdrop-paused]')).toHaveCount(1)
    await page.waitForTimeout(300)
    const held = await frame()
    // Halftone's dots change several times a second while it moves: held, none does.
    await page.waitForTimeout(1_500)
    expect(await changes(held)).toBe(false)
    // Focus is back: the scene moves on.
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hasFocus')
      window.dispatchEvent(new Event('focus'))
    })
    await expect(page.locator('body[data-dshx-backdrop-paused]')).toHaveCount(0)
    await expect.poll(() => changes(held), { timeout: 10_000 }).toBe(true)
    await hide.evaluate(style => style.remove())
  })
})

When('the thread calls theme_remove for {string}', async ({ page }: { page: Page }, id: string) => {
  await sendMessage(page, toolCall('theme_remove', { id, confirm: true }))
})

When('the Web UI is reloaded with the theme saved', async ({ page }: { page: Page }) => {
  await reloadPastProviderSetup(page)
})

Then('the static default theme is the whole theme', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ui-styles-default-theme-static', async () => {
    await expect(page.locator(RUNTIME_STYLE)).toHaveCount(0)
    await expect.poll(async () => (await themeProbe(page)).tone).toContain(' 65)')
    expect(await page.evaluate(() => localStorage.getItem('dshfiles-ui-styles:theme-css:v1'))).toBeNull()
  })
  await finishJourneyAssertions(page)
})
