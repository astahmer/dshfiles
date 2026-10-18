import { expect, type Page } from '@playwright/test'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NEW_THREAD_COMPOSER = 'Describe what you want to build, / commands, @ files or sessions'
const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'

/** A fresh directory under the system temporary root, resolved so it matches the path the Host canonicalizes. */
export const createScratchDirectory = async (prefix: string): Promise<string> => realpath(await mkdtemp(join(tmpdir(), prefix)))

/** Register a folder through the sidebar Add workspace flow of @dshfiles/workspace-folder-picker; it becomes the New thread project. */
export const registerWorkspaceFolder = async (page: Page, path: string): Promise<void> => {
  const picker = page.getByRole('dialog', { name: 'Add workspace' })
  await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
  await expect(picker).toBeVisible()
  // The picker opens on the Host home and rewrites the path field when that first listing lands.
  await expect(picker.locator('p').filter({ hasText: /^\// }).first()).toBeVisible()
  const pathInput = picker.getByRole('textbox', { name: 'Enter a folder path', exact: true })
  await expect(async () => {
    await pathInput.fill(path)
    await pathInput.press('Enter')
    await expect(picker.locator('p').filter({ hasText: path }).first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await picker.getByRole('button', { name: 'Select this folder', exact: true }).click()
  await expect(picker).toBeHidden()
}

/** Send a message from whichever composer is on screen and wait until that turn settles. */
export const sendMessage = async (page: Page, text: string): Promise<void> => {
  const settled = page.getByRole('status').filter({ hasText: /^(Completed|Failed|Stopped|Cancelled)$/ })
  const before = await settled.count()
  const composer = page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true }).or(page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true }))
  await composer.fill(text)
  await composer.press('Enter')
  await expect(settled).toHaveCount(before + 1, { timeout: 60_000 })
}

export const selectModelForNewThread = async (page: Page, model: string): Promise<void> => {
  // A just-added account publishes its route a moment later, so the picker is reopened until the model is listed.
  await expect(async () => {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Select model/ }).click()
    const option = page.getByRole('menuitemradio', { name: model, exact: true })
    if ((await option.count()) === 0) await page.getByRole('menuitem', { name: /^Model / }).click({ timeout: 2_000 })
    await option.click({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: new RegExp(`^Select model, current ${model.replaceAll('/', '\\/')}`) })).toBeVisible()
}

/** Start a New thread in a registered project with a model from the picker, before its first message. */
export const startThreadWithModel = async (page: Page, input: { readonly project: string; readonly model: string }): Promise<void> => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true })).toBeVisible()
  const projectButton = page.getByRole('button', { name: 'Choose workspace', exact: true })
  if ((await projectButton.textContent())?.trim() !== input.project) {
    await projectButton.click()
    await page.getByRole('menuitem', { name: input.project, exact: true }).click()
  }
  await expect(projectButton).toHaveText(input.project)
  await selectModelForNewThread(page, input.model)
}
