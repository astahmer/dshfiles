import { expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, sendMessage, startThreadWithModel } from '../threads.js'

const projects = new WeakMap<Page, string>()

const projectFor = (page: Page): string => {
  const project = projects.get(page)
  if (project === undefined) throw new Error('No scratch jj project was created in this scenario.')
  return project
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

When('a thread on the fake model is started in a scratch jj project', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-session-undo-e2e-')
  const project = join(root, 'undo-project')
  await mkdir(project)
  await writeFile(join(project, 'README.md'), 'undo journey\n')
  const init = spawnSync('jj', ['git', 'init'], { cwd: project, env: { PATH: process.env.PATH ?? '', HOME: root }, encoding: 'utf8' })
  if (init.status !== 0) throw new Error(`jj git init failed: ${init.stderr}`)
  projects.set(page, project)
  await registerWorkspaceFolder(page, project)
  await startThreadWithModel(page, { project: 'undo-project', model: 'commandcode_work/gpt-6-luna' })
})

When('the thread asks bash to write {string}', async ({ page }: { page: Page }, file: string) => {
  await sendMessage(page, `[[call bash ${JSON.stringify({ command: `echo written > ${file}`, description: 'Undo journey write' })}]]`)
})

/**
 * A turn's checkpoint is taken when the turn starts, so a file written into the project after a turn settles is in
 * every later turn's checkpoint, the same as a file the turn's own tool call wrote. The journey writes it from the test:
 * a scratch DSH from this checkout can fail every tool call ("reading 'prepare'", the agent loop's tool scheduler).
 */
When('the thread runs a turn that leaves {string} in the project', async ({ page }: { page: Page }, file: string) => {
  await sendMessage(page, `Rewind journey turn for ${file}`)
  await writeFile(join(projectFor(page), file), `left by the turn for ${file}\n`)
})

Then('the turn wrote {string} in the project', async ({ page }: { page: Page }, file: string) => {
  await recordAssertion(page, 'session-undo-turn-wrote-file', () => expect.poll(() => exists(join(projectFor(page), file))).toBe(true))
})

Then('redo restored {string} in the project', async ({ page }: { page: Page }, file: string) => {
  await recordAssertion(page, 'session-undo-redo-restored-file', () => expect.poll(() => exists(join(projectFor(page), file)), { timeout: 30_000 }).toBe(true))
})

Then('redo restored {string} and {string} in the project', async ({ page }: { page: Page }, first: string, second: string) => {
  await recordAssertion(page, 'session-undo-redo-restored-rewound-files', async () => {
    await expect.poll(() => exists(join(projectFor(page), first)), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => exists(join(projectFor(page), second))).toBe(true)
  })
})

When('the last turn is undone from the composer', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Undo last turn', exact: true }).click()
})

Then('{string} is gone and the undone prompt waits in the queue', async ({ page }: { page: Page }, file: string) => {
  await recordAssertion(page, 'session-undo-files-and-conversation', async () => {
    await expect.poll(() => exists(join(projectFor(page), file)), { timeout: 30_000 }).toBe(false)
    await expect(page.getByText(/Undo journey write/).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Redo the undone turn and its files', exact: true })).toBeVisible()
  })
})

When('the undone turn is redone from the composer', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Redo the undone turn and its files', exact: true }).click()
})

When('the thread is rewound to before the turn that left {string}', async ({ page }: { page: Page }, file: string) => {
  // Wait until the third turn's checkpoint is listed, so the menu holds every turn.
  await expect(page.getByRole('button', { name: 'Rewind to an earlier turn', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Rewind to an earlier turn', exact: true }).click()
  await expect(page.getByRole('menuitem')).toHaveCount(3, { timeout: 30_000 })
  await page.getByRole('menuitem').filter({ hasText: file }).click()
  const dialog = page.getByRole('alertdialog')
  await recordAssertion(page, 'session-undo-rewind-lists-lost-turns', async () => {
    await expect(dialog.locator('[data-session-undo="lost-turns"] li')).toHaveCount(2)
    await expect(dialog.locator('[data-session-undo="lost-turns"]')).not.toContainText('rewind-1.txt')
  })
  await dialog.getByRole('button', { name: 'Rewind', exact: true }).click()
})

Then('only {string} of the three files remains', async ({ page }: { page: Page }, kept: string) => {
  await recordAssertion(page, 'session-undo-rewind-restored-files', async () => {
    await expect.poll(() => exists(join(projectFor(page), 'rewind-3.txt')), { timeout: 30_000 }).toBe(false)
    await expect.poll(() => exists(join(projectFor(page), 'rewind-2.txt'))).toBe(false)
    await expect.poll(() => exists(join(projectFor(page), kept))).toBe(true)
    await expect(page.getByRole('button', { name: 'Redo the undone turn and its files', exact: true })).toBeVisible()
  })
})

Then('the original thread shows its turns again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-undo-redo-returns-to-rewound-thread', async () => {
    await expect(page.getByText('Rewind journey turn for rewind-3.txt').first()).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Rewind to an earlier turn', exact: true }).click()
    await expect(page.getByRole('menuitem')).toHaveCount(3)
    await page.keyboard.press('Escape')
  })
  await finishJourneyAssertions(page)
})

Then('the original thread shows its turn again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-undo-redo-returns-to-thread', async () => {
    await expect(page.getByRole('status').filter({ hasText: /^Completed$/ })).toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Undo last turn', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
