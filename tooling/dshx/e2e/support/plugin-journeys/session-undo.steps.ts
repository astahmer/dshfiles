import { expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { chooseComposerMore, expectComposerMoreEnabled } from '../composer-more.js'
import { createScratchDirectory, registerWorkspaceFolder, sendMessage, startThreadWithModel } from '../threads.js'

const projects = new WeakMap<Page, string>()

const threadComposer = (page: Page) => page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })

/** The New thread view can stay on screen after a thread starts, so open the started thread before sending into it. */
const openStartedThread = async (page: Page): Promise<void> => {
  if (await threadComposer(page).isVisible().catch(() => false)) return
  const thread = page.getByRole('treeitem', { name: /^Fake thread title/u }).first()
  // Before the first turn the thread does not exist yet: its message is sent from the New thread composer.
  if (!(await thread.isVisible().catch(() => false))) return
  await thread.click()
  await expect(threadComposer(page)).toBeVisible({ timeout: 30_000 })
}

const projectFor = (page: Page): string => {
  const project = projects.get(page)
  if (project === undefined) throw new Error('No scratch project was created in this scenario.')
  return project
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

const run = (cwd: string, home: string, command: string, args: readonly string[]): void => {
  const result = spawnSync(command, args, { cwd, env: { PATH: process.env.PATH ?? '', HOME: home }, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`)
}

const startInScratchProject = async (page: Page, init: (project: string, home: string) => void): Promise<void> => {
  const root = await createScratchDirectory('dshx-session-undo-e2e-')
  const project = join(root, 'undo-project')
  await mkdir(project)
  await writeFile(join(project, 'README.md'), 'undo journey\n')
  init(project, root)
  projects.set(page, project)
  await registerWorkspaceFolder(page, project)
  await startThreadWithModel(page, { project: 'undo-project', model: 'commandcode_work/gpt-6-luna' })
}

When('a thread on the fake model is started in a scratch jj project', async ({ page }: { page: Page }) => {
  await startInScratchProject(page, (project, home) => run(project, home, 'jj', ['git', 'init']))
})

/** A plain git repository with no `.jj`: jj-integration's git backend takes and restores the turn snapshots. */
When('a thread on the fake model is started in a scratch git-only project', async ({ page }: { page: Page }) => {
  await startInScratchProject(page, (project, home) => {
    run(project, home, 'git', ['init', '-q', '-b', 'main'])
    run(project, home, 'git', ['config', 'user.name', 'Session Undo E2E'])
    run(project, home, 'git', ['config', 'user.email', 'session-undo-e2e@example.invalid'])
    run(project, home, 'git', ['add', '--all'])
    run(project, home, 'git', ['commit', '-q', '-m', 'Base fixture'])
  })
})

Then('the project is still a git-only repository', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-undo-git-project-stays-git-only', async () => {
    expect(await exists(join(projectFor(page), '.git'))).toBe(true)
    expect(await exists(join(projectFor(page), '.jj'))).toBe(false)
  })
})

When('the thread asks bash to write {string}', async ({ page }: { page: Page }, file: string) => {
  await openStartedThread(page)
  await sendMessage(page, `[[call bash ${JSON.stringify({ command: `echo written > ${file}`, description: 'Undo journey write' })}]]`)
})

/**
 * A turn's checkpoint is taken when the turn starts, so a file written into the project after a turn settles is in
 * every later turn's checkpoint, the same as a file the turn's own tool call wrote. The journey writes it from the test:
 * a scratch DSH from this checkout can fail every tool call ("reading 'prepare'", the agent loop's tool scheduler).
 */
When('the thread runs a turn that leaves {string} in the project', async ({ page }: { page: Page }, file: string) => {
  await openStartedThread(page)
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
  await chooseComposerMore(page, 'Undo last turn')
})

Then('{string} is gone and the undone prompt waits in the queue', async ({ page }: { page: Page }, file: string) => {
  await recordAssertion(page, 'session-undo-files-and-conversation', async () => {
    await expect.poll(() => exists(join(projectFor(page), file)), { timeout: 30_000 }).toBe(false)
    await expect(page.getByText(/Undo journey write/).first()).toBeVisible({ timeout: 30_000 })
    await expectComposerMoreEnabled(page, 'Redo the undone turn', 'Redo the undone turn and its files', { timeout: 30_000 })
  })
})

When('the undone turn is redone from the composer', async ({ page }: { page: Page }) => {
  await chooseComposerMore(page, 'Redo the undone turn', 'Redo the undone turn and its files')
})

When('the thread is rewound to before the turn that left {string}', async ({ page }: { page: Page }, file: string) => {
  // Wait until the third turn's checkpoint is listed, so the menu holds every turn.
  await expectComposerMoreEnabled(page, 'Rewind to an earlier turn', 'Rewind to an earlier turn', { timeout: 30_000 })
  await chooseComposerMore(page, 'Rewind to an earlier turn')
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
    await expectComposerMoreEnabled(page, 'Redo the undone turn', 'Redo the undone turn and its files', { timeout: 30_000 })
  })
})

Then('the original thread shows its turns again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-undo-redo-returns-to-rewound-thread', async () => {
    await expect(page.getByText('Rewind journey turn for rewind-3.txt').first()).toBeVisible({ timeout: 30_000 })
    await expectComposerMoreEnabled(page, 'Rewind to an earlier turn', 'Rewind to an earlier turn', { timeout: 30_000 })
    await chooseComposerMore(page, 'Rewind to an earlier turn')
    await expect(page.getByRole('menuitem')).toHaveCount(3)
    await page.keyboard.press('Escape')
  })
  await finishJourneyAssertions(page)
})

Then('the original thread shows its turn again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-undo-redo-returns-to-thread', async () => {
    await expect(page.getByRole('status').filter({ hasText: /^(Worked|Completed)$/ })).toHaveCount(1, { timeout: 30_000 })
    await expectComposerMoreEnabled(page, 'Undo last turn')
  })
  await finishJourneyAssertions(page)
})

/** b:ysaj: a turn's checkpoint is a row of its reply's More actions menu; open that menu and return the row. */
const openCheckpoint = async (page: Page, turn: 'first' | 'last') => {
  const tails = page.locator('[data-turn-tail]').filter({ has: page.getByRole('button', { name: 'More actions', exact: true }) })
  const tail = turn === 'first' ? tails.first() : tails.last()
  await page.keyboard.press('Escape')
  await tail.hover()
  await tail.getByRole('button', { name: 'More actions', exact: true }).click()
  return page.locator('[data-message-actions-menu] [data-session-undo-checkpoint]')
}

Then('each turn names the jj revision its edits left', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-undo-turn-checkpoint-revisions', async () => {
    await expect.poll(() => exists(join(projectFor(page), 'checkpoint-2.txt')), { timeout: 30_000 }).toBe(true)
    await expect(page.locator('[data-turn-tail]').filter({ has: page.getByRole('button', { name: 'More actions', exact: true }) })).toHaveCount(2, { timeout: 30_000 })
    // No raw commit id under the replies: the checkpoint lives only inside the menu.
    await expect(page.locator('[data-session-undo-checkpoint]')).toHaveCount(0)
    const first = await openCheckpoint(page, 'first')
    await expect(first).toHaveCount(1, { timeout: 30_000 })
    await expect(first.locator('[data-session-undo-revision]').getByRole('link', { name: /^Jujutsu revision:/ })).toBeVisible()
    await expect(first.getByRole('button', { name: 'Restore to after this turn', exact: true })).toHaveCount(1)
    const shots = process.env.DSHX_E2E_SHOT_DIR
    if (shots !== undefined) await page.screenshot({ path: `${shots}/turn-checkpoint.png` })
    const last = await openCheckpoint(page, 'last')
    await expect(last).toHaveCount(1, { timeout: 30_000 })
    await expect(last.locator('[data-session-undo-revision]').getByRole('link', { name: /^Jujutsu revision:/ })).toBeVisible()
    await expect(last.getByRole('button', { name: 'Restore to after this turn', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})

When('the first turn is restored from its checkpoint', async ({ page }: { page: Page }) => {
  const checkpoint = await openCheckpoint(page, 'first')
  await checkpoint.getByRole('button', { name: 'Restore to after this turn', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await recordAssertion(page, 'session-undo-turn-checkpoint-confirms', () => expect(dialog.locator('[data-session-undo="lost-turns"] li')).toHaveCount(1))
  await dialog.getByRole('button', { name: 'Rewind', exact: true }).click()
})

Then('only {string} of the two files remains', async ({ page }: { page: Page }, kept: string) => {
  await recordAssertion(page, 'session-undo-turn-checkpoint-restored', async () => {
    await expect.poll(() => exists(join(projectFor(page), 'checkpoint-2.txt')), { timeout: 30_000 }).toBe(false)
    await expect.poll(() => exists(join(projectFor(page), kept))).toBe(true)
  })
  await finishJourneyAssertions(page)
})
