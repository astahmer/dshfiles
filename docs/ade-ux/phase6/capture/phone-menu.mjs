import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const { chromium, expect } = await import(join(root, 'tooling/dshx/packages/dshx/node_modules/playwright/test.mjs'))
const [stateFile, outputDirectory] = process.argv.slice(2)
assert(stateFile && outputDirectory, 'Usage: nub --node phone-menu.mjs <scratch-state.json> <output-directory>')
const state = JSON.parse(readFileSync(stateFile, 'utf8'))
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.browser.cdpPort}`)
const checks = []
let failure = null
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find(candidate => candidate.url().startsWith(state.origin))
  assert(page, 'Seed a thread first: dshx dev open workbench/conversation-header --name <scratch-name>')
  await page.setViewportSize({ width: 390, height: 844 })
  const toggle = page.getByRole('button', { name: 'Thread menu', exact: true })
  const menu = page.getByRole('dialog', { name: 'Thread menu', exact: true })
  await expect(toggle).toBeVisible()
  if (await menu.isVisible()) await page.keyboard.press('Escape')
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeFocused()
  await page.keyboard.press('Tab')
  await expect.poll(() => menu.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(toggle).toBeFocused()
  checks.push('keyboard open, contained Tab, Escape and opener focus return')

  await toggle.click()
  await menu.getByRole('button', { name: 'Saved prompts', exact: true }).click()
  await expect(menu).toHaveCount(0)
  const prompts = page.locator('[data-slot="popover-content"]').filter({ has: page.getByRole('heading', { name: 'Saved prompts', exact: true }) })
  await expect(prompts).toBeVisible()
  await expect.poll(() => prompts.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(prompts).toHaveCount(0)
  await expect(toggle).toBeFocused()
  checks.push('typed pick focuses real Saved prompts; dismissal returns to visible menu opener')

  await toggle.click()
  await page.getByRole('button', { name: 'Close the thread menu', exact: true }).click({ position: { x: 5, y: 700 } })
  await expect(menu).toHaveCount(0)
  await expect(toggle).toBeFocused()
  checks.push('scrim dismissal')

  await toggle.click()
  await menu.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await expect(page.locator('[data-phone-sheet]')).toBeVisible()
  await expect(menu).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-phone-sheet]')).not.toBeVisible()
  checks.push('menu thread-panel opener opens and closes the real Workbench sheet')

  mkdirSync(outputDirectory, { recursive: true })
  await page.screenshot({ path: join(outputDirectory, 'phone-stack-navigation.png') })
  await toggle.click()
  await expect(menu).toBeVisible()
  await page.screenshot({ path: join(outputDirectory, 'phone-thread-menu.png') })
  await page.keyboard.press('Escape')

  for (const width of [360, 480]) {
    await page.setViewportSize({ width, height: 844 })
    await toggle.click()
    await expect(menu).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.keyboard.press('Escape')
  }
  checks.push('360px and 480px menus remain usable without document overflow')
  await page.setViewportSize({ width: 1024, height: 844 })
  await expect(page.getByRole('button', { name: 'Prompts', exact: true })).toBeVisible()
  await expect(toggle).toHaveCount(0)
  checks.push('desktop keeps the in-place composer control and no phone toggle')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-phone-tab="new"]').click()
  await expect(toggle).toHaveCount(0)
  checks.push('sessionless native bar has no dead menu toggle before its first edit')
  const draft = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await draft.fill('Blank phone review draft')
  const fallback = page.getByRole('button', { name: 'Prompts', exact: true })
  await expect(toggle.or(fallback).first()).toBeVisible()
  const draftUsesMenu = await toggle.isVisible()
  if (draftUsesMenu) {
    await toggle.click()
    await menu.getByRole('button', { name: 'Saved prompts', exact: true }).click()
  } else {
    await fallback.click()
  }
  await expect(prompts).toBeVisible()
  await expect.poll(() => prompts.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(draftUsesMenu ? toggle : fallback).toBeFocused()
  await expect(draft).toHaveText('Blank phone review draft')
  checks.push(`first-edit unsent draft opens real Saved prompts through ${draftUsesMenu ? 'its menu' : 'its visible in-place fallback'} and retains the draft`)
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  mkdirSync(outputDirectory, { recursive: true })
  const evidence = { ok: failure === null, viewport: '390x844 Chromium', checks, failure }
  writeFileSync(join(outputDirectory, 'phone-menu-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
  await browser.close()
}
