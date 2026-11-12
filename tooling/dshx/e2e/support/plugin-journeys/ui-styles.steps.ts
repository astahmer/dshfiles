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
