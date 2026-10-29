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

Then('the turn wrote {string} in the project', async ({ page }: { page: Page }, file: string) => {
  await recordAssertion(page, 'session-undo-turn-wrote-file', () => expect.poll(() => exists(join(projectFor(page), file))).toBe(true))
})

Then('redo restored {string} in the project', async ({ page }: { page: Page }, file: string) => {
  await recordAssertion(page, 'session-undo-redo-restored-file', () => expect.poll(() => exists(join(projectFor(page), file)), { timeout: 30_000 }).toBe(true))
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

Then('the original thread shows its turn again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-undo-redo-returns-to-thread', async () => {
    await expect(page.getByRole('status').filter({ hasText: /^Completed$/ })).toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Undo last turn', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
