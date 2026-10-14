import { expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const threadRow = (page: Page) => page.getByRole('listitem').filter({ has: page.getByText(provisionedThreadName(page), { exact: true }) })

const createRepository = async (page: Page): Promise<ThreadRepository> => {
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'dshx-jj-integration-e2e-')))
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
const landButton = (page: Page) => page.getByRole('button', { name: 'Land this thread onto main', exact: true })

/** The Host names a thread workspace `<repository> · <thread>`; the thread name is its directory under `repo-threads`. */
const currentThreadName = async (page: Page): Promise<string> => {
  const label = (await projectButton(page).textContent()) ?? ''
  const match = /^repo · (thread-[\w-]+)$/.exec(label.trim())
  if (match?.[1] === undefined) throw new Error(`The New thread project is not a thread workspace: ${label}`)
  return match[1]
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
  await composer.fill('jj integration land e2e thread')
  await composer.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('jj integration land e2e thread')
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
  await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('background new thread e2e')
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

Then('the New thread moves to its own jj workspace on {string} in the background', async ({ page }: { page: Page }, bookmark: string) => {
  const repository = repositoryFor(page)
  await expect(projectButton(page)).toHaveText(/^repo · thread-/)
  const threadName = await currentThreadName(page)
  await recordAssertion(page, 'jj-integration-new-thread-moves-to-its-own-workspace', async () => {
    await expect(workspaceToggle(page)).toBeChecked()
    await expect(workspaceToggle(page)).toBeEnabled()
    await expect(page.getByRole('button', { name: bookmark, exact: true })).toBeVisible()
    await expect.poll(() => workspaceNames(repository)).toEqual(['default', threadName])
    expect(commitIdOf(repository, `${threadName}@-`)).toBe(repository.baseCommitId)
  })
  await finishJourneyAssertions(page)
})

When('the thread workspace gains a revision described {string}', async ({ page }: { page: Page }, description: string) => {
  const repository = repositoryFor(page)
  const threadPath = join(repository.threadsPath, provisionedThreadName(page))
  await writeFile(join(threadPath, 'feature.txt'), `${description}\n`)
  jjAt(threadPath, repository.temporaryRoot, ['describe', '--message', description])
  // The Land button reads the thread status once per mount; a reload stands in for the agent's next turn.
  await page.reload()
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

Then('Land waits for work in the thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-land-is-disabled-without-unlanded-work', async () => {
    await expect(landButton(page)).toBeDisabled()
    await expect(landButton(page)).toHaveAttribute('title', 'Land this thread onto main (0 unlanded)')
  })
})

Then('Land refuses the placeholder description and leaves main in place', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await expect(landButton(page)).toHaveText('Land · 1')
  await landButton(page).click()
  await recordAssertion(page, 'jj-integration-land-asks-for-a-description', async () => {
    await expect(page.getByRole('alert').filter({ hasText: /^Describe these revisions before landing: \w+\./ })).toBeVisible()
    expect(commitIdOf(repository, 'main')).toBe(repository.baseCommitId)
  })
})

Then('Land moves main onto the work described {string}', async ({ page }: { page: Page }, description: string) => {
  const repository = repositoryFor(page)
  await expect(landButton(page)).toHaveText('Land · 1')
  await landButton(page).click()
  await recordAssertion(page, 'jj-integration-land-moves-the-bookmark', async () => {
    const landedToast = page.getByRole('alert').filter({ hasText: 'Landed 1 revision(s) onto main:' })
    await expect(landedToast).toContainText(description)
    await expect(landButton(page)).toBeDisabled()
    expect(descriptionOf(repository, 'main')).toBe(description)
    await expect(landedToast).toContainText('main is now at')
    await expect(landedToast).toContainText(`(${commitIdOf(repository, 'main').slice(0, 8)})`)
    expect(commitIdOf(repository, 'main-')).toBe(repository.baseCommitId)
  })
  await finishJourneyAssertions(page)
})

When('the Thread workspaces panel is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Thread workspaces', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Thread workspaces', exact: true })).toBeVisible()
})

Then('the thread row offers Land for its 1 unlanded revision', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-panel-offers-land-only-with-work', async () => {
    await expect(threadRow(page).getByText('1 unlanded', { exact: true })).toBeVisible()
    await expect(threadRow(page).getByRole('button', { name: 'Land', exact: true })).toBeVisible()
    await expect(threadRow(page).getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0)
  })
})

When("{string} is chosen from the thread row's More menu", async ({ page }: { page: Page }, item: string) => {
  await threadRow(page)
    .getByRole('button', { name: `More actions for ${provisionedThreadName(page)}`, exact: true })
    .click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
})

Then('the confirmation names the thread and its 1 unlanded revision', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-discard-confirmation-names-the-revision-count', () =>
    expect(page.getByRole('alertdialog').getByRole('heading')).toHaveText(`Discard ${provisionedThreadName(page)} and its 1 unlanded revision(s)?`),
  )
})

When('the discard is confirmed', async ({ page }: { page: Page }) => {
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard with work', exact: true }).click()
})

Then('the thread workspace is gone from jj and from the panel', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-integration-discard-removes-the-thread-and-its-empty-card', async () => {
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect.poll(() => workspaceNames(repository)).toEqual(['default'])
    await expect(page.getByText(provisionedThreadName(page), { exact: true })).toHaveCount(0)
    await expect(page.getByText(repository.repositoryPath, { exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const repository = repositories.get(page)
  if (repository === undefined) return
  repositories.delete(page)
  await rm(repository.temporaryRoot, { recursive: true, force: true })
})
