import { expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

interface ThreadRepository {
  readonly temporaryRoot: string
  readonly repositoryPath: string
  readonly threadsPath: string
  readonly baseCommitId: string
  readonly releaseCommitId: string
}

const repositories = new WeakMap<Page, ThreadRepository>()
/** The thread workspace the New thread screen last provisioned; a started thread's header no longer names it. */
const provisionedThreads = new WeakMap<Page, string>()
const newThreadComposerName = 'Describe what you want to build, / commands, @ files or sessions'
const threadComposerName = 'Message or run a task, / commands, @ files or sessions'
const threadComposer = (page: Page) => page.getByRole('textbox', { name: threadComposerName, exact: true })
const attachmentFixtures = fileURLToPath(new URL('../../fixtures/attachments/', import.meta.url))
const newThreadComposer = (page: Page) => page.getByRole('textbox', { name: newThreadComposerName, exact: true })
const removeComposerAttachment = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const expectDraftAndAttachments = async (page: Page, text: string): Promise<void> => {
  await expect(newThreadComposer(page)).toHaveText(text)
  await expect(removeComposerAttachment(page, 'Remove image red.png')).toBeVisible()
  await expect(removeComposerAttachment(page, 'Remove file note.txt')).toBeVisible()
}

const jjAt = (cwd: string, home: string, args: readonly string[]): string => {
  const result = spawnSync(process.env.JJ_TEST_EXECUTABLE ?? 'jj', ['--color=never', '--no-pager', ...args], {
    cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      JJ_USER: 'JJ Integration E2E',
      JJ_EMAIL: 'jj-integration-e2e@example.invalid',
    },
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    timeout: 20_000,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`Disposable JJ fixture command failed (${String(result.status)}): ${result.stderr}`)
  return result.stdout
}

const commitIdAt = (repositoryPath: string, home: string, revset: string): string =>
  jjAt(repositoryPath, home, ['--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'commit_id']).trim()

const commitIdOf = (repository: ThreadRepository, revset: string): string => commitIdAt(repository.repositoryPath, repository.temporaryRoot, revset)

const changeIdOf = (repository: ThreadRepository, revset: string): string =>
  jjAt(repository.repositoryPath, repository.temporaryRoot, ['--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'change_id.short(12)']).trim()

const descriptionOf = (repository: ThreadRepository, revset: string): string =>
  jjAt(repository.repositoryPath, repository.temporaryRoot, [
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '-r',
    revset,
    '-T',
    'description.first_line()',
  ]).trim()

const workspaceNames = (repository: ThreadRepository): readonly string[] =>
  jjAt(repository.repositoryPath, repository.temporaryRoot, ['--ignore-working-copy', 'workspace', 'list'])
    .split('\n')
    .filter(line => line.includes(':'))
    .map(line => line.slice(0, line.indexOf(':')))
    .sort()

const provisionedThreadName = (page: Page): string => {
  const threadName = provisionedThreads.get(page)
  if (threadName === undefined) throw new Error('No thread workspace was provisioned from the New thread screen.')
  return threadName
}

const threadRow = (page: Page) =>
  page.getByRole('listitem').filter({ has: page.getByRole('button', { name: `More actions for ${provisionedThreadName(page)}`, exact: true }) })

const createRepository = async (page: Page, temporaryParent = tmpdir()): Promise<ThreadRepository> => {
  const temporaryRoot = await realpath(await mkdtemp(join(temporaryParent, 'dshx-jj-integration-e2e-')))
  const repositoryPath = join(temporaryRoot, 'repo')
  await mkdir(repositoryPath)
  try {
    jjAt(repositoryPath, temporaryRoot, ['git', 'init', '--no-colocate'])
    await writeFile(join(repositoryPath, 'README.md'), 'base\n')
    jjAt(repositoryPath, temporaryRoot, ['describe', '--message', 'Base fixture'])
    jjAt(repositoryPath, temporaryRoot, ['bookmark', 'create', 'main', '--revision', '@'])
    jjAt(repositoryPath, temporaryRoot, ['new'])
    await writeFile(join(repositoryPath, 'release.txt'), 'release\n')
    jjAt(repositoryPath, temporaryRoot, ['describe', '--message', 'Release fixture'])
    jjAt(repositoryPath, temporaryRoot, ['bookmark', 'create', 'release', '--revision', '@'])
    jjAt(repositoryPath, temporaryRoot, ['new', 'main'])
    const repository: ThreadRepository = {
      temporaryRoot,
      repositoryPath,
      threadsPath: join(temporaryRoot, 'repo-threads'),
      baseCommitId: commitIdAt(repositoryPath, temporaryRoot, 'main'),
      releaseCommitId: commitIdAt(repositoryPath, temporaryRoot, 'release'),
    }
    repositories.set(page, repository)
    return repository
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

const repositoryFor = (page: Page): ThreadRepository => {
  const repository = repositories.get(page)
  if (repository === undefined) throw new Error('The disposable jj repository was not created for this scenario.')
  return repository
}

const projectButton = (page: Page) => page.getByRole('button', { name: 'Choose workspace', exact: true })
const workspaceToggle = (page: Page) => page.getByRole('checkbox', { name: 'workspace', exact: true })
const rebaseButton = (page: Page) => page.getByRole('button', { name: 'Rebase this thread onto main', exact: true })
/** The one header control: it names a thread workspace, or the shared checkout the thread runs in. */
const workspaceControl = (page: Page) => page.getByRole('button', { name: /^(?:Current thread workspace: |Workspace actions for )/ })
const workspaceMenu = (page: Page) => page.locator('[data-slot="popover-content"]')

/** The menu closes on every action, so a step that asserts inside it opens it first. */
const openWorkspaceMenu = async (page: Page): Promise<void> => {
  if (await page.getByRole('button', { name: 'Open thread workspaces in side panel', exact: true }).isVisible()) return
  await workspaceControl(page).click()
  await expect(page.getByRole('button', { name: 'Open thread workspaces in side panel', exact: true })).toBeVisible()
}

/**
 * The Host names a thread workspace `<repository> · <thread>`; the thread name is its directory under `repo-threads`.
 * Under load the picker re-renders through its empty "Choose workspace" label while the provisioned workspace
 * registers, so the label is read once it settles on a thread workspace.
 */
const currentThreadName = async (page: Page): Promise<string> => {
  let threadName: string | undefined
  await expect(async () => {
    const label = ((await projectButton(page).textContent()) ?? '').trim()
    threadName = /^repo · (thread-[\w-]+)$/.exec(label)?.[1]
    expect(threadName, `The New thread project is not a thread workspace: ${label}`).toBeDefined()
  }).toPass({ timeout: 15_000 })
  if (threadName === undefined) throw new Error('The New thread project never settled on a thread workspace.')
  return threadName
}

const chooseProjectPath = async (page: Page, path: string): Promise<void> => {
  await projectButton(page).click()
  const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
  const search = picker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true })
  await search.fill(path)
  await search.press('Enter')
  await expect(picker.locator('p').filter({ hasText: path }).first()).toBeVisible()
  await picker.getByRole('button', { name: 'Select this folder', exact: true }).click()
  await expect(picker).toBeHidden()
}

When('a disposable jj repository is chosen as the New thread project', async ({ page }: { page: Page }) => {
  const repository = await createRepository(page)
  await chooseProjectPath(page, repository.repositoryPath)
  await expect(projectButton(page)).toHaveText('repo')
})

When('a disposable jj repository is chosen by its home-relative path', async ({ page }: { page: Page }) => {
  await projectButton(page).click()
  const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
  const search = picker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true })
  await search.fill('~')
  const homePathLabel = picker.locator('p').filter({ hasText: /^\// }).first()
  await expect(homePathLabel).toBeVisible()
  const homePath = (await homePathLabel.textContent())?.trim()
  if (!homePath) throw new Error('The project picker did not expose its Host home path.')
  const repository = await createRepository(page, homePath)
  const homeRelativeRepositoryPath = join(homePath, basename(repository.temporaryRoot), 'repo')
  await search.fill(`~/${basename(repository.temporaryRoot)}/repo`)
  await search.press('Enter')
  await expect(picker.locator('p').filter({ hasText: homeRelativeRepositoryPath }).first()).toBeVisible()
  await picker.getByRole('button', { name: 'Select this folder', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(projectButton(page)).toHaveText('repo')
})

When('the New thread composer has a draft {string} with an image and a file attached', async ({ page }: { page: Page }, text: string) => {
  await newThreadComposer(page).fill(text)
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles([join(attachmentFixtures, 'red.png'), join(attachmentFixtures, 'note.txt')])
  await expect(removeComposerAttachment(page, 'Remove image red.png')).toBeVisible()
  await expect(removeComposerAttachment(page, 'Remove file note.txt')).toBeVisible()
})

Then('the composer keeps draft {string} with its image and file in the isolated workspace', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'jj-integration-isolated-draft-keeps-attachments', () => expectDraftAndAttachments(page, text))
})

Then('the composer keeps draft {string} with its image and file in the shared checkout', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'jj-integration-shared-draft-keeps-attachments', () => expectDraftAndAttachments(page, text))
})

When('the New thread composer draft is cleared', async ({ page }: { page: Page }) => {
  await newThreadComposer(page).fill('')
  await removeComposerAttachment(page, 'Remove image red.png').click()
  await removeComposerAttachment(page, 'Remove file note.txt').click()
  await expect(removeComposerAttachment(page, 'Remove image red.png')).toHaveCount(0)
  await expect(removeComposerAttachment(page, 'Remove file note.txt')).toHaveCount(0)
})

When('the New thread workspace toggle is turned on', async ({ page }: { page: Page }) => {
  await workspaceToggle(page).click()
  await expect(projectButton(page)).toHaveText(/^repo · thread-/)
  provisionedThreads.set(page, await currentThreadName(page))
})

When('the New thread workspace toggle is turned off', async ({ page }: { page: Page }) => {
  await workspaceToggle(page).click()
  await expect(projectButton(page)).toHaveText('repo')
})

When('the New thread workspace is kept in the shared checkout', async ({ page }: { page: Page }) => {
  const toggle = workspaceToggle(page)
  if (await toggle.isChecked()) await toggle.click()
  await expect(toggle).not.toBeChecked()
})

When('the {string} bookmark is picked in the destination bar', async ({ page }: { page: Page }, bookmark: string) => {
  await page.getByRole('button', { name: 'main', exact: true }).click()
  await page.getByPlaceholder('Search bookmarks…').fill(bookmark)
  await page.getByRole('option', { name: bookmark, exact: true }).click()
  await expect(page.getByRole('button', { name: bookmark, exact: true })).toBeVisible()
  await expect(projectButton(page)).toHaveText(/^repo · thread-/)
})

When('No folder is chosen as the New thread project', async ({ page }: { page: Page }) => {
  await projectButton(page).click()
  const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
  await picker.getByRole('option', { name: /^No folder/ }).click()
  await expect(picker).toBeHidden()
})

When('a message is sent in the thread workspace', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: newThreadComposerName, exact: true })
  await composer.fill('jj integration rebase e2e thread')
  await composer.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('jj integration rebase e2e thread')
})

Then('the current thread header identifies its jj workspace', async ({ page }: { page: Page }) => {
  const threadName = provisionedThreadName(page)
  const repository = repositoryFor(page)
  const indicator = page.getByRole('button', { name: `Current thread workspace: ${threadName}`, exact: true })
  await expect(indicator).toBeVisible()
  await expect(indicator).toHaveAttribute('title', join(repository.threadsPath, threadName))
  await indicator.click()
  await expect(rebaseButton(page)).toBeVisible()
  await page.getByRole('button', { name: 'Open thread workspaces in side panel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Thread workspaces', exact: true }).last()).toBeVisible()
  await expect(indicator).toBeVisible()
})

Then('the thread header names the shared project checkout', async ({ page }: { page: Page }) => {
  const indicator = page.getByRole('button', { name: /^Workspace actions for / })
  await expect(indicator).toBeVisible()
  await openWorkspaceMenu(page)
  await expect(workspaceMenu(page)).toContainText('This thread works in the project checkout')
})

When('the current thread workspace chip is hovered', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: `Current thread workspace: ${provisionedThreadName(page)}`, exact: true }).hover()
})

Then('the revision graph preview shows the thread and configured landmarks', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-revision-graph-hover-preview', async () => {
    await expect(page.getByRole('heading', { name: 'Revision graph', exact: true })).toBeVisible()
    const graph = page.locator('pre[aria-label="Revision graph"]')
    await expect(graph).toBeVisible()
    await expect(graph).toContainText('@')
    await expect(graph).toContainText('main')
    await expect(graph).toContainText('default@')
  })
  await finishJourneyAssertions(page)
})
When('a message is sent in the shared checkout', async ({ page }: { page: Page }) => {
  const composer = newThreadComposer(page)
  await composer.fill('jj integration shared checkout rebase e2e')
  await composer.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('jj integration shared checkout rebase')
})

When('{string} is typed in the New thread composer', async ({ page }: { page: Page }, text: string) => {
  await page.getByRole('textbox', { name: newThreadComposerName, exact: true }).fill(text)
})

Then('the New thread composer contains {string}', async ({ page }: { page: Page }, text: string) => {
  await expect(workspaceToggle(page)).toBeEnabled()
  await expect(page.getByRole('textbox', { name: newThreadComposerName, exact: true })).toHaveText(text)
})

When('the carried draft is sent', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('Draft handoff regression')
})

Then('the New thread composer is empty and no consumed draft remains stored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-consumed-draft-does-not-return', async () => {
    await expect(workspaceToggle(page)).toBeEnabled()
    await expect(page.getByRole('textbox', { name: newThreadComposerName, exact: true })).toHaveText('')
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage)
          .filter(key => key.startsWith('dsh.conversation.'))
          .some(key => localStorage.getItem(key)?.includes('Draft handoff regression')),
      ),
    ).toBe(false)
  })
  await finishJourneyAssertions(page)
})

When('new threads start in the shared checkout by default', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).last().click()
  await page.getByRole('dialog').getByText('New thread', { exact: true }).click()
  const isolateByDefault = page.getByRole('switch', { name: 'Own jj workspace by default', exact: true })
  if (await isolateByDefault.isChecked()) await isolateByDefault.click()
  await expect(isolateByDefault).not.toBeChecked()
  await page.keyboard.press('Escape')
})

When('new threads start in their own jj workspace by default', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).last().click()
  await page.getByRole('dialog').getByText('New thread', { exact: true }).click()
  const isolateByDefault = page.getByRole('switch', { name: 'Own jj workspace by default', exact: true })
  await isolateByDefault.click()
  await expect(isolateByDefault).toBeChecked()
  await page.keyboard.press('Escape')
})

When('a first message is sent from the shared checkout', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: newThreadComposerName, exact: true })
  await composer.fill('background new thread e2e')
  await composer.press('Enter')
  // The first send also creates the session and its workspace; on a loaded machine that outlasts the 15s default.
  await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('background new thread e2e', { timeout: 45_000 })
})

When('New thread is clicked in the sidebar', async ({ page }: { page: Page }) => {
  await page.getByRole('region', { name: 'Threads' }).waitFor()
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click()
})

Then('the New thread composer opens before its workspace exists', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-new-thread-composer-opens-at-once', async () => {
    await expect(page.getByRole('textbox', { name: newThreadComposerName, exact: true })).toBeVisible({ timeout: 1_000 })
  })
})

Then('the New thread composer remains editable while its workspace is prepared', async ({ page }: { page: Page }) => {
  const composer = newThreadComposer(page)
  await recordAssertion(page, 'jj-composer-editable-while-preparing', async () => {
    await expect(page.getByRole('status', { name: /^thread-/ })).toBeVisible({ timeout: 5_000 })
    await expect(composer).toBeEditable()
    await composer.fill('typed during workspace preparation')
    await expect(composer).toHaveText('typed during workspace preparation')
  })
})

Then('the New thread moves to its own jj workspace on {string} in the background', async ({ page }: { page: Page }, bookmark: string) => {
  const repository = repositoryFor(page)
  await expect(projectButton(page)).toHaveText(/^repo · thread-/)
  const threadName = await currentThreadName(page)
  await recordAssertion(page, 'jj-integration-new-thread-moves-to-its-own-workspace', async () => {
    await expect(workspaceToggle(page)).toBeChecked()
    await expect(workspaceToggle(page)).toBeEnabled()
    await expect(page.getByRole('button', { name: bookmark, exact: true })).toBeVisible()
    await expect.poll(() => workspaceNames(repository)).toEqual(['default', threadName])
    await expect(newThreadComposer(page)).toHaveText('typed during workspace preparation')
    expect(commitIdOf(repository, `${threadName}@-`)).toBe(repository.baseCommitId)
  })
  provisionedThreads.set(page, threadName)
  await finishJourneyAssertions(page)
})

When('a message is submitted before the new thread workspace is ready', async ({ page }: { page: Page }) => {
  const pending = page.getByRole('status', { name: /^thread-/ })
  await expect(pending).toBeVisible({ timeout: 5_000 })
  const threadName = await pending.getAttribute('aria-label')
  if (threadName === null) throw new Error('The pending workspace has no thread name.')
  provisionedThreads.set(page, threadName)

  const composer = newThreadComposer(page)
  await expect(composer).toBeEditable()
  await composer.fill('message sent during workspace preparation')
  await expect(composer).toHaveText('message sent during workspace preparation')
  await composer.press('Enter')
})

Then('the message is delivered from its new thread workspace', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  const threadName = provisionedThreadName(page)
  await recordAssertion(page, 'jj-submit-waits-for-workspace-ready', async () => {
    await expect(newThreadComposer(page)).toHaveCount(0, { timeout: 45_000 })
    await expect(page.getByText('message sent during workspace preparation', { exact: true })).toBeVisible()
    await expect(page.getByRole('status', { name: /^thread-/ })).toHaveCount(0)
    await expect.poll(() => workspaceNames(repository)).toEqual(['default', threadName].sort())
  })
  await finishJourneyAssertions(page)
})

When('the thread workspace gains a revision described {string}', async ({ page }: { page: Page }, description: string) => {
  const repository = repositoryFor(page)
  const threadPath = join(repository.threadsPath, provisionedThreadName(page))
  await writeFile(join(threadPath, 'feature.txt'), `${description}\n`)
  jjAt(threadPath, repository.temporaryRoot, ['describe', '--message', description])
})

Then('the blank new thread uses a different jj workspace from the previous thread', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  const previousThread = provisionedThreadName(page)
  await recordAssertion(page, 'jj-integration-new-thread-does-not-reuse-previous-workspace', async () => {
    await expect(newThreadComposer(page)).toBeVisible()
    await expect(newThreadComposer(page)).toHaveText('')
    await expect(projectButton(page)).not.toHaveText(`repo · ${previousThread}`, { timeout: 30_000 })
    const nextThread = await currentThreadName(page)
    expect(nextThread).not.toBe(previousThread)
    await expect(workspaceToggle(page)).toBeChecked()
    await expect.poll(() => workspaceNames(repository)).toEqual(['default', previousThread, nextThread].sort())
  })
  await finishJourneyAssertions(page)
})

Then('the blank new thread returns to the owning project checkout', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-integration-new-thread-returns-to-project', async () => {
    await expect(newThreadComposer(page)).toBeVisible()
    await expect(newThreadComposer(page)).toHaveText('')
    await expect(projectButton(page)).toHaveText('repo', { timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'main', exact: true })).toBeVisible()
    await expect(workspaceToggle(page)).toBeVisible()
    await expect(workspaceToggle(page)).not.toBeChecked()
    expect(workspaceNames(repository)).toEqual(['default', provisionedThreadName(page)])
  })
  await finishJourneyAssertions(page)
})

Then('the destination bar offers the main bookmark in the shared checkout', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-integration-destination-names-the-local-host', () =>
    expect(page.getByLabel('New thread destination', { exact: true }).getByText('Local', { exact: true })).toBeVisible(),
  )
  await recordAssertion(page, 'jj-integration-destination-starts-on-the-configured-bookmark', () =>
    expect(page.getByRole('button', { name: 'main', exact: true })).toBeVisible(),
  )
  await recordAssertion(page, 'jj-integration-destination-defaults-to-the-shared-checkout', async () => {
    await expect(workspaceToggle(page)).not.toBeChecked()
    expect(workspaceNames(repository)).toEqual(['default'])
  })
})

Then('the New thread runs in its own jj workspace on {string}', async ({ page }: { page: Page }, bookmark: string) => {
  const repository = repositoryFor(page)
  const threadName = await currentThreadName(page)
  const expectedWorkspaceNames = [...new Set(['default', provisionedThreadName(page), threadName])].sort()
  const expectedParent = bookmark === 'release' ? repository.releaseCommitId : repository.baseCommitId
  await recordAssertion(page, `jj-integration-isolated-thread-starts-on-${bookmark}`, async () => {
    await expect(workspaceToggle(page)).toBeChecked()
    await expect(page.getByRole('button', { name: bookmark, exact: true })).toBeVisible()
    await expect.poll(() => workspaceNames(repository)).toEqual(expectedWorkspaceNames)
    expect(commitIdOf(repository, `${threadName}@-`)).toBe(expectedParent)
  })
})

Then('the blank thread returns to the shared checkout and its workspace is kept as a spare', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  const threadName = provisionedThreadName(page)
  await recordAssertion(page, 'jj-integration-spare-kept-on-toggle', async () => {
    await expect(workspaceToggle(page)).not.toBeChecked()
    await expect.poll(() => workspaceNames(repository)).toEqual(['default', threadName])
  })
})

Then('the destination bar offers neither a bookmark nor a workspace toggle', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-no-folder-has-no-jj-destination', async () => {
    await expect(projectButton(page)).toHaveText(/no-folder|No folder/)
    await expect(page.getByLabel('New thread destination', { exact: true }).getByText('Local', { exact: true })).toBeVisible()
    await expect(workspaceToggle(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'main', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('the rebase command is submitted in the thread composer', async ({ page }: { page: Page }) => {
  const composer = threadComposer(page)
  await expect(composer).toBeVisible()
  await composer.fill('/rebase')
  await composer.press('Enter')
})

Then('the thread header has no Rebase button', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-shared-checkout-has-no-rebase-button', () => expect(rebaseButton(page)).toHaveCount(0))
})

Then('the rebase command advances main and reports success', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-integration-rebase-command-advances-main', async () => {
    await expect(page.getByText('Rebased 1 revision(s) onto main.', { exact: true })).toBeVisible()
    await expect.poll(() => descriptionOf(repository, 'main')).toBe('Rebase from command')
    expect(commitIdOf(repository, 'main-')).toBe(repository.baseCommitId)
  })
  await finishJourneyAssertions(page)
})

Then('the rebase command refuses the shared checkout without moving main', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-integration-rebase-command-refuses-shared-checkout', async () => {
    await expect(
      page.getByText('This Session is not in a managed thread workspace. Use an isolated thread workspace to run /rebase.', { exact: true }),
    ).toBeVisible()
    expect(commitIdOf(repository, 'main')).toBe(repository.baseCommitId)
  })
  await finishJourneyAssertions(page)
})

Then('Rebase is disabled before there are revisions to rebase', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-rebase-is-disabled-without-work', async () => {
    await expect(workspaceMenu(page)).toContainText('Nothing to rebase')
    await expect(rebaseButton(page)).toBeDisabled()
    await expect(rebaseButton(page)).toHaveAttribute('title', 'Rebase this thread onto main (0 to rebase)')
  })
})

Then('Rebase refuses the placeholder description and leaves main in place', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await openWorkspaceMenu(page)
  await expect(workspaceMenu(page)).toContainText('1 to rebase', { timeout: 10_000 })
  await expect(rebaseButton(page)).toBeEnabled()
  await rebaseButton(page).click()
  await recordAssertion(page, 'jj-integration-rebase-asks-for-a-description', async () => {
    await expect(page.getByRole('alert').filter({ hasText: /^Describe these revisions before rebasing: \w+\./ })).toBeVisible()
    expect(commitIdOf(repository, 'main')).toBe(repository.baseCommitId)
  })
})

Then('Rebase moves main onto the work described {string}', async ({ page }: { page: Page }, description: string) => {
  const repository = repositoryFor(page)
  await openWorkspaceMenu(page)
  await expect(workspaceMenu(page)).toContainText('1 to rebase')
  await rebaseButton(page).click()
  await recordAssertion(page, 'jj-integration-rebase-moves-the-bookmark', async () => {
    const rebasedToast = page.getByRole('alert').filter({ hasText: 'Rebased 1 revision(s) onto main:' })
    await expect(rebasedToast).toContainText(description)
    await expect(rebaseButton(page)).toBeDisabled()
    const notice = page.getByTestId('jj-thread-rebased-notice')
    await expect(notice).toHaveCount(1)
    expect(descriptionOf(repository, 'main')).toBe(description)

    await expect(notice).toBeVisible()
    await expect(notice).toContainText(`This thread was rebased onto main (${changeIdOf(repository, 'main')}).`)
    await expect(notice.getByRole('button', { name: 'Archive this rebased thread', exact: true })).toBeEnabled()
    await expect(rebasedToast).toContainText('main is now at')
    await expect(rebasedToast).toContainText(`(${commitIdOf(repository, 'main').slice(0, 8)})`)
    expect(commitIdOf(repository, 'main-')).toBe(repository.baseCommitId)
  })
  await finishJourneyAssertions(page)
})

Then('Rebase detects the follow-up revision without reloading', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-rebase-refreshes-new-work-without-reload', async () => {
    await expect(workspaceMenu(page)).toContainText('1 to rebase', { timeout: 10_000 })
    await expect(rebaseButton(page)).toBeEnabled()
  })
})

When("the thread's work is rebased outside the UI", async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  const threadPath = join(repository.threadsPath, provisionedThreadName(page))
  jjAt(threadPath, repository.temporaryRoot, ['rebase', '-b', '@', '-d', 'main'])
  jjAt(threadPath, repository.temporaryRoot, ['bookmark', 'set', 'main', '-r', '@'])
  jjAt(threadPath, repository.temporaryRoot, ['new', 'main'])
})

Then('Rebase reflects the external rebase without reloading', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-rebase-refreshes-external-rebase-without-reload', async () => {
    await expect(workspaceMenu(page)).toContainText('Nothing to rebase', { timeout: 10_000 })
    await expect(rebaseButton(page)).toBeDisabled()
    await expect(rebaseButton(page)).toHaveAttribute('title', 'Rebase this thread onto main (0 to rebase)')
    expect(descriptionOf(repository, 'main')).toBe('Follow-up after a steer')
  })
})

When('the thread is archived from the rebase notice', async ({ page }: { page: Page }) => {
  await page.getByTestId('jj-thread-rebased-notice').last().getByRole('button', { name: 'Archive this rebased thread', exact: true }).click()
})

Then('the thread appears in the Archived sidebar section', async ({ page }: { page: Page }) => {
  const archivedSection = page.getByRole('region', { name: 'Threads', exact: true }).getByRole('button', { name: 'Archived (1)', exact: true })
  await recordAssertion(page, 'jj-integration-rebased-thread-can-be-archived-from-notice', () => expect(archivedSection).toBeVisible())
  await finishJourneyAssertions(page)
})

When('the Thread workspaces panel is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Thread workspaces', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Thread workspaces', exact: true })).toBeVisible()
})

Then('the thread row offers Rebase for its 1 revision to rebase', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-panel-offers-rebase-only-with-work', async () => {
    await expect(threadRow(page).getByText('1 to rebase', { exact: true })).toBeVisible()
    await expect(threadRow(page).getByRole('button', { name: 'Rebase', exact: true })).toBeVisible()
    await expect(threadRow(page).getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0)
  })
})

When('Rebase is clicked in the thread workspace row', async ({ page }: { page: Page }) => {
  await threadRow(page).getByRole('button', { name: 'Rebase', exact: true }).click()
  await expect(threadRow(page).getByText('Rebasing…', { exact: true }).first()).toBeVisible({ timeout: 1_000 })
})

Then('the thread workspace row immediately shows that it is up to date', async ({ page }: { page: Page }) => {
  const row = threadRow(page)
  await expect(row.getByText('Nothing to rebase', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Rebase', exact: true })).toHaveCount(0)
})

When('the conversation is opened from its workspace row', async ({ page }: { page: Page }) => {
  await threadRow(page)
    .getByRole('button', { name: /^Open thread:/ })
    .first()
    .click()
  await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('jj integration rebase e2e thread')
})

When('the Thread workspaces side panel is opened', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await page.getByRole('button', { name: 'Open thread workspaces in side panel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Thread workspaces', exact: true }).last()).toBeVisible()
})

Then('the thread header offers Rebase for its 1 revision', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-header-offers-rebase-with-work', async () => {
    await expect(workspaceMenu(page)).toContainText('1 to rebase', { timeout: 10_000 })
    await expect(rebaseButton(page)).toBeEnabled()
  })
})

Then('the thread header shows nothing to rebase without reloading', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-header-refreshes-external-rebase', async () => {
    await expect(workspaceMenu(page)).toContainText('Nothing to rebase', { timeout: 10_000 })
    await expect(rebaseButton(page)).toBeDisabled()
  })
})

Then('the thread header has no native session-log menu', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-header-owns-the-session-log-menu', () =>
    expect(page.getByRole('button', { name: 'More actions', exact: true })).toHaveCount(0),
  )
})

Then('the session log downloads from the thread workspace menu', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-menu-downloads-the-session-log', async () => {
    const row = page.getByRole('button', { name: 'Download session log', exact: true })
    const [download] = await Promise.all([page.waitForEvent('download'), row.click()])
    expect(download.suggestedFilename()).toMatch(/\.zip$/u)
  })
})

Then('its Preview shows the latest message', async ({ page }: { page: Page }) => {
  const row = threadRow(page)
  await row.getByRole('button', { name: 'Preview', exact: true }).first().click()
  await expect(row).toContainText('jj integration rebase e2e thread')
})

When("{string} is chosen from the thread row's More menu", async ({ page }: { page: Page }, item: string) => {
  await threadRow(page)
    .getByRole('button', { name: `More actions for ${provisionedThreadName(page)}`, exact: true })
    .click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
})

Then('the confirmation names the thread and its 1 revision to rebase', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-removal-confirmation', async () => {
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading')).toHaveText(`Remove ${provisionedThreadName(page)} and abandon 1 revision(s) to rebase?`)
    await expect(dialog).toContainText('deletes its folder')
    await expect(dialog).toContainText('conversations remain in DSH and are not archived')
  })
})

When('the removal is confirmed', async ({ page }: { page: Page }) => {
  await page.getByRole('alertdialog').getByRole('button', { name: 'Abandon work and remove workspace', exact: true }).click()
})

Then('the thread workspace is gone from jj and from the panel', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-integration-remove-preserves-session', async () => {
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect.poll(() => workspaceNames(repository)).toEqual(['default'])
    await expect(threadRow(page)).toHaveCount(0)
    await expect(page.getByText(repository.repositoryPath, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('jj integration rebase e2e thread')
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const repository = repositories.get(page)
  if (repository === undefined) return
  repositories.delete(page)
  await rm(repository.temporaryRoot, { recursive: true, force: true })
})
