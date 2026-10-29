import { expect, type Page } from '@playwright/test'
import { openGlobalPanel } from '../plugin-view-names.js'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion } from '../steps.js'
import { selectModelForNewThread } from '../threads.js'
import { z } from 'zod'

interface ThreadRepository {
  readonly temporaryRoot: string
  readonly repositoryPath: string
  readonly threadsPath: string
  readonly baseCommitId: string
  readonly releaseCommitId: string
}

interface HeldDestinationLookup {
  readonly wasRequested: () => boolean
  readonly release: () => void
}

const repositories = new WeakMap<Page, ThreadRepository>()
const divergentCheckouts = new WeakMap<Page, { readonly checkoutCommitId: string; readonly featureCommitId: string }>()
const existingSharedThreads = new WeakMap<Page, string>()
const configuredBaseThreads = new WeakMap<Page, { readonly name: string; readonly commitId: string }>()
/** The thread workspace the New thread screen last provisioned; a started thread's header no longer names it. */
const provisionedThreads = new WeakMap<Page, string>()
/** A blank thread whose next visit must find a draft persisted by a previous one. */
const rememberedBlankThreads = new WeakMap<Page, string>()
/** The thread workspaces that existed just before the draft was sent; its send must add none. */
const beforeSendNames = new WeakMap<Page, string>()
const heldDestinationLookups = new WeakMap<Page, HeldDestinationLookup>()
const firstSendMainTabTransitions = new WeakMap<Page, { readonly sourceSessionId: string; readonly destinationSessionId: string }>()
const heldDestinationLookupFor = (page: Page): HeldDestinationLookup => {
  const lookup = heldDestinationLookups.get(page)
  if (lookup === undefined) throw new Error('No held New thread destination lookup exists for this page.')
  return lookup
}
const newThreadComposerName = 'Describe what you want to build, / commands, @ files or sessions'
const threadComposerName = 'Message or run a task, / commands, @ files or sessions'
const threadComposer = (page: Page) => page.getByRole('textbox', { name: threadComposerName, exact: true })
const attachmentFixtures = fileURLToPath(new URL('../../fixtures/attachments/', import.meta.url))
const newThreadComposer = (page: Page) => page.getByRole('textbox', { name: newThreadComposerName, exact: true })
const destinationRequestSchema = z
  .object({
    method: z.string().regex(/\/destination$/u),
    payload: z.object({ input: z.object({ workspaceId: z.string() }).passthrough() }).passthrough(),
    rpcId: z.string(),
  })
  .passthrough()
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

const spareRecords = z.record(z.string(), z.string())

/** Workspaces the Host keeps checked out ahead of the next New thread; they are not a thread the journey asked for. */
const prewarmedSpareNames = (repository: ThreadRepository): readonly string[] => {
  const file = join(repository.threadsPath, '.dshfiles-spare-workspaces.json')
  if (!existsSync(file)) return []
  try {
    // The Host records a spare when it is ready; a half-written record must not fail a workspace assertion.
    const parsed = spareRecords.safeParse(JSON.parse(readFileSync(file, 'utf8')))
    return parsed.success ? Object.values(parsed.data) : []
  } catch {
    return []
  }
}

/** A provisioned thread can itself be recorded as this project's spare, so a journey names what it still expects. */
const workspaceNames = (repository: ThreadRepository, keep: readonly string[] = []): readonly string[] => {
  const spares = new Set(prewarmedSpareNames(repository).filter(name => !keep.includes(name)))
  return jjAt(repository.repositoryPath, repository.temporaryRoot, ['--ignore-working-copy', 'workspace', 'list'])
    .split('\n')
    .filter(line => line.includes(':'))
    .map(line => line.slice(0, line.indexOf(':')))
    .filter(name => !spares.has(name))
    .sort()
}

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

/**
 * The checkout the journey's thread actually runs in, ready for another journey to seed working-copy changes there.
 * An isolated thread workspace wins; a thread that stayed in the project checkout returns that checkout instead.
 */
export const threadWorkspacePathFor = (page: Page): string => {
  const repository = repositoryFor(page)
  const threadName = workspaceNames(repository).find(name => name !== 'default')
  return threadName === undefined ? repository.repositoryPath : join(repository.threadsPath, threadName)
}

const projectButton = (page: Page) => page.getByRole('button', { name: 'Choose workspace', exact: true })
const dismissGetStartedDialog = async (page: Page): Promise<void> => {
  const dialog = page.getByRole('dialog', { name: 'Get started', exact: true })
  if (!(await dialog.isVisible())) return
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
}
const workspaceToggle = (page: Page) => page.getByRole('checkbox', { name: 'workspace', exact: true })
const rebaseButton = (page: Page) => page.getByRole('button', { name: 'Integrate this thread into main', exact: true })
/** The same land action, one click from the answer: the row the newest completed turn renders. */
const turnEndIntegrateOffer = (page: Page) => page.getByTestId('jj-inline-integrate-offer')
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

/** A started thread names its workspace in the conversation header, once the New thread composer is gone. */
const currentHeaderThreadName = async (page: Page): Promise<string> => {
  const header = page.getByRole('button', { name: /^Current thread workspace: thread-/ })
  await expect(header).toBeVisible({ timeout: 30_000 })
  const label = await header.getAttribute('aria-label')
  const threadName = /^Current thread workspace: (thread-[\w-]+)$/.exec(label ?? '')?.[1]
  if (threadName === undefined) throw new Error(`The thread header does not name a thread workspace: ${label ?? ''}`)
  return threadName
}

const chooseProjectPath = async (page: Page, path: string): Promise<void> => {
  await dismissGetStartedDialog(page)
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

When('a disposable jj checkout based on {string} is chosen as the New thread project', async ({ page }: { page: Page }, bookmark: string) => {
  const repository = await createRepository(page)
  // Keep main behind a distinct, nonempty feature revision, and leave the project checkout on its child.
  jjAt(repository.repositoryPath, repository.temporaryRoot, ['bookmark', 'rename', 'release', bookmark])
  jjAt(repository.repositoryPath, repository.temporaryRoot, ['new', bookmark])
  const featureCommitId = commitIdOf(repository, bookmark)
  expect(featureCommitId).not.toBe(repository.baseCommitId)
  divergentCheckouts.set(page, { checkoutCommitId: commitIdOf(repository, '@'), featureCommitId })
  await chooseProjectPath(page, repository.repositoryPath)
  await expect(projectButton(page)).toHaveText('repo')
})

When('the existing shared-checkout thread is remembered', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('button', { name: /^Workspace actions for / })).toBeVisible()
  const sessionId = new URL(page.url()).searchParams.get('thread')
  if (sessionId === null) throw new Error('The shared-checkout thread has no Session ID.')
  existingSharedThreads.set(page, sessionId)
})

Then('the untouched New chat offers configured main with workspace checked', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-configured-main-default-destination', async () => {
    await expect(newThreadComposer(page)).toBeEditable()
    await expect(newThreadComposer(page)).toHaveText('')
    await expect(projectButton(page)).toHaveText('repo')
    await expect(page.getByLabel('New thread destination', { exact: true }).getByRole('button', { name: 'main', exact: true })).toBeVisible()
    await expect(workspaceToggle(page)).toBeChecked()
    await expect(workspaceToggle(page)).toBeEnabled()
    expect(workspaceNames(repositoryFor(page))).toEqual(['default'])
  })
})

Then('the submitted workspace starts from configured main instead of the checkout feature', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-first-send-parent-is-configured-main', async () => {
    await expect(newThreadComposer(page)).toHaveCount(0, { timeout: 45_000 })
    await expect(page.getByText('message sent during workspace preparation', { exact: true })).toBeVisible()
    const name = await currentHeaderThreadName(page)
    const parent = commitIdOf(repository, `${name}@-`)
    expect(parent).toBe(repository.baseCommitId)
    expect(parent).not.toBe(divergentCheckouts.get(page)?.featureCommitId)
    configuredBaseThreads.set(page, { name, commitId: commitIdOf(repository, `${name}@`) })
  })
})

Then('the submitted workspace starts from the explicitly picked feature bookmark', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-explicit-feature-first-send-parent', async () => {
    await expect(newThreadComposer(page)).toHaveCount(0, { timeout: 45_000 })
    await expect(page.getByText('message sent during workspace preparation', { exact: true })).toBeVisible()
    const name = await currentHeaderThreadName(page)
    expect(name).not.toBe(configuredBaseThreads.get(page)?.name)
    expect(commitIdOf(repository, `${name}@-`)).toBe(divergentCheckouts.get(page)?.featureCommitId)
  })
})

Then('existing threads and the feature checkout are unchanged', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  const checkout = divergentCheckouts.get(page)
  const configured = configuredBaseThreads.get(page)
  const sessionId = existingSharedThreads.get(page)
  if (checkout === undefined || configured === undefined || sessionId === undefined) throw new Error('The configured-base regression snapshots are missing.')
  await recordAssertion(page, 'jj-new-chat-preserves-existing-destinations', async () => {
    expect(commitIdOf(repository, 'default@')).toBe(checkout.checkoutCommitId)
    expect(commitIdOf(repository, 'default@-')).toBe(checkout.featureCommitId)
    expect(commitIdOf(repository, 'feature/fix')).toBe(checkout.featureCommitId)
    expect(commitIdOf(repository, 'main')).toBe(repository.baseCommitId)
    expect(commitIdOf(repository, `${configured.name}@`)).toBe(configured.commitId)
    // The row's hover actions cover its centre; activate the title at the unobstructed left edge.
    await page
      .getByRole('region', { name: 'Threads' })
      .getByRole('button', { name: /background new thread e2e/u })
      .click({ position: { x: 24, y: 16 } })
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(sessionId)
    const header = page.getByRole('button', { name: /^Workspace actions for / })
    await expect(header).toBeVisible()
    await expect(header).toHaveAttribute('title', repository.repositoryPath)
  })
  await finishJourneyAssertions(page)
})

When('a disposable jj repository is chosen by its home-relative path', async ({ page }: { page: Page }) => {
  await dismissGetStartedDialog(page)
  await projectButton(page).click()
  const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
  const search = picker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true })
  await search.fill('~')
  const homePathLabel = picker.locator('p').filter({ hasText: /^\// }).first()
  await expect(homePathLabel).toBeVisible()
  await expect(picker.getByRole('alert')).toHaveCount(0)
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
  // The switch makes DSH open a fresh blank Session in the new workspace; the thread must keep it instead of moving
  // back to the project checkout, so hold the state for a moment before trusting it.
  await expect(async () => {
    await page.waitForTimeout(2_000)
    await expect(projectButton(page)).toHaveText(new RegExp(`^repo · ${provisionedThreadName(page)}$`))
    await expect(workspaceToggle(page)).toBeChecked()
  }).toPass({ timeout: 10_000 })
})

When('the New thread workspace toggle is turned off', async ({ page }: { page: Page }) => {
  await workspaceToggle(page).click()
  await expect(projectButton(page)).toHaveText('repo')
})

When('the local Command Code model is selected for the New thread', async ({ page }: { page: Page }) => {
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
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
  await expect(picker).toBeVisible()
  await picker.getByRole('option', { name: /^No folder/ }).click()
  await expect(picker).toBeHidden()
  await expect(projectButton(page)).toHaveText('No folder')
})

When('a message is sent in the thread workspace', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: newThreadComposerName, exact: true })
  await composer.fill('jj integration rebase e2e thread\n\n[[title jj integration rebase e2e thread]]')
  await composer.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('jj integration rebase e2e thread')
})

Then('the current thread header identifies its jj workspace', async ({ page }: { page: Page }) => {
  const threadName = provisionedThreadName(page)
  const indicator = page.getByRole('button', { name: `Current thread workspace: ${threadName}`, exact: true })
  await expect(indicator).toBeVisible()
  await indicator.click()
  await expect(rebaseButton(page)).toBeVisible()
  await page.getByRole('button', { name: 'Open thread workspaces in side panel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Thread integration', exact: true }).last()).toBeVisible()
  await expect(indicator).toBeVisible()
})

Then('the thread header names the shared project checkout', async ({ page }: { page: Page }) => {
  const indicator = page.getByRole('button', { name: /^Workspace actions for / })
  await expect(indicator).toBeVisible()
  await openWorkspaceMenu(page)
  await expect(workspaceMenu(page)).toContainText('This thread works in the project checkout')
})

When('the current thread workspace chip is hovered', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
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

When('the blank thread is remembered for a saved draft', async ({ page }: { page: Page }) => {
  await expect(workspaceToggle(page)).toBeEnabled()
  const sessionId = new URL(page.url()).searchParams.get('thread')
  if (sessionId === null) throw new Error('The New thread session is not in the URL yet.')
  rememberedBlankThreads.set(page, sessionId)
})

Then('the remembered blank thread is no longer current', async ({ page }: { page: Page }) => {
  const remembered = rememberedBlankThreads.get(page)
  if (remembered === undefined) throw new Error('No blank thread was remembered.')
  await expect.poll(() => new URL(page.url()).searchParams.get('thread')).not.toBe(remembered)
})

When('the saved draft {string} is restored to the remembered thread', async ({ page }: { page: Page }, text: string) => {
  const sessionId = rememberedBlankThreads.get(page)
  if (sessionId === undefined) throw new Error('No blank thread was remembered for the saved draft.')
  await page.evaluate(
    ({ sessionId, text }) => {
      localStorage.setItem(`dsh.conversation.${sessionId}`, JSON.stringify({ draft: text }))
    },
    { sessionId, text },
  )
})

When('the disposable jj repository is chosen again as the New thread project', async ({ page }: { page: Page }) => {
  await chooseProjectPath(page, repositoryFor(page).repositoryPath)
})

Then('the project opens with its saved draft {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'jj-integration-project-switch-keeps-saved-draft', async () => {
    await expect(projectButton(page)).toHaveText('repo')
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(rememberedBlankThreads.get(page))
    await expect(newThreadComposer(page)).toHaveText(text)
    await expect(page.getByText(/your draft stays in the previous thread/u)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('new threads start in the shared checkout by default', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByText('New thread', { exact: true }).click()
  const isolateByDefault = page.getByRole('switch', { name: 'Own jj workspace by default', exact: true })
  if (await isolateByDefault.isChecked()) await isolateByDefault.click()
  await expect(isolateByDefault).not.toBeChecked()
  await page.keyboard.press('Escape')
})

When('new threads start in their own jj workspace by default', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByText('New thread', { exact: true }).click()
  const isolateByDefault = page.getByRole('switch', { name: 'Own jj workspace by default', exact: true })
  await isolateByDefault.click()
  await expect(isolateByDefault).toBeChecked()
  await page.keyboard.press('Escape')
})

When('a first message is sent from the shared checkout', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: newThreadComposerName, exact: true })
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  // The local fake provider uses this directive to make the generated thread name deterministic.
  await composer.fill('background new thread e2e\n\n[[title background new thread e2e]]')
  await composer.press('Enter')
  // The first send also creates the session and its workspace; on a loaded machine that outlasts the 15s default.
  await expect(page.getByRole('region', { name: 'Threads' }).getByRole('button', { name: /background new thread e2e/u })).toBeVisible({ timeout: 45_000 })
})

When('New thread is clicked in the sidebar', async ({ page }: { page: Page }) => {
  await page.getByRole('region', { name: 'Threads' }).waitFor()
  await page.getByRole('button', { name: 'New thread', exact: true }).first().click()
})

When('New thread is opened from the main-tabs plus page', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  const startPage = page.getByRole('listbox', { name: 'Open in this tab', exact: true })
  await expect(startPage).toBeVisible()
  await startPage.getByRole('option', { name: 'New thread', exact: true }).click()
  await expect(newThreadComposer(page)).toBeVisible()
})

Then('the New thread composer opens before its workspace exists', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-new-thread-composer-opens-at-once', async () => {
    await expect(page.getByRole('textbox', { name: newThreadComposerName, exact: true })).toBeVisible({ timeout: 1_000 })
  })
})

/** The thread workspaces this disposable repository holds right now, working copies the Host adds ahead included. */
const rawWorkspaceNames = (repository: ThreadRepository): readonly string[] =>
  jjAt(repository.repositoryPath, repository.temporaryRoot, ['--ignore-working-copy', 'workspace', 'list'])
    .split('\n')
    .filter(line => line.includes(':'))
    .map(line => line.slice(0, line.indexOf(':')))
    .filter(name => name !== 'default')
    .sort()

/** The thread workspaces the draft has claimed, once the Host has one checked out for it. */
const waitForPreparedWorkspace = async (page: Page): Promise<void> => {
  await expect.poll(() => rawWorkspaceNames(repositoryFor(page)), { timeout: 45_000 }).not.toEqual([])
}

Then('the untouched New thread claims no jj workspace', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-integration-untouched-new-thread-claims-nothing', async () => {
    await expect(newThreadComposer(page)).toBeEditable()
    await expect(projectButton(page)).toHaveText('repo')
    await expect(page.getByRole('button', { name: 'main', exact: true })).toBeVisible()
    // The toggle shows the destination the thread will take, not a workspace that exists yet.
    await expect(workspaceToggle(page)).toBeChecked()
    await expect(workspaceToggle(page)).toBeEnabled()
    // Give a claim that must not happen time to show up before trusting the jj workspace list.
    await page.waitForTimeout(2_000)
    expect(workspaceNames(repository)).toEqual(['default'])
  })
  await finishJourneyAssertions(page)
})

When('the New thread composer takes a draft {string}', async ({ page }: { page: Page }, text: string) => {
  const composer = newThreadComposer(page)
  await expect(composer).toBeEditable()
  await composer.click()
  await page.keyboard.type(text)
  await expect(composer).toHaveText(text)
})

Then('the prepared destination is a checked-out thread workspace', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-draft-prepares-the-thread-workspace', async () => {
    await waitForPreparedWorkspace(page)
    // Preparing a destination moves nothing: the New thread screen keeps the draft and no thread started.
    await expect(newThreadComposer(page)).toHaveText('typed before the thread has a workspace')
    await expect(page.getByRole('status', { name: /^thread-/ })).toHaveCount(0)
    expect(workspaceNames(repositoryFor(page))).toContain('default')
  })
  await finishJourneyAssertions(page)
})

Then('the New thread screen still shows that draft', async ({ page }: { page: Page }) => {
  await expect(newThreadComposer(page)).toHaveText('typed before the thread has a workspace')
  await expect(page.getByRole('button', { name: 'main', exact: true })).toBeVisible()
})

When('the prepared draft is sent', async ({ page }: { page: Page }) => {
  const composer = newThreadComposer(page)
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  beforeSendNames.set(page, rawWorkspaceNames(repositoryFor(page)).join(','))
  await composer.press('Enter')
})

Then('the thread runs in its prepared workspace', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-send-lands-in-the-prepared-workspace', async () => {
    await expect(newThreadComposer(page)).toHaveCount(0, { timeout: 45_000 })
    await expect(page.getByText('typed before the thread has a workspace', { exact: true })).toBeVisible()
    // The send moved into a workspace the draft had already claimed: it provisioned none of its own. (Another
    // workspace may still appear as the Host's spare for the next thread, which is not this send's destination.)
    expect((beforeSendNames.get(page) ?? '').split(',')).toContain(await currentHeaderThreadName(page))
  })
  await finishJourneyAssertions(page)
})

When('a message is submitted before the new thread workspace is ready', async ({ page }: { page: Page }) => {
  const composer = newThreadComposer(page)
  await expect(composer).toBeEditable()
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  await composer.fill('message sent during workspace preparation')
  await expect(composer).toHaveText('message sent during workspace preparation')
  await composer.press('Enter')
})

Then('the message is delivered from its new thread workspace', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-submit-provisions-the-thread-workspace', async () => {
    await expect(newThreadComposer(page)).toHaveCount(0, { timeout: 45_000 })
    await expect(page.getByText('message sent during workspace preparation', { exact: true })).toBeVisible()
    await expect(page.getByRole('status', { name: /^thread-/ })).toHaveCount(0)
    const threadName = await currentHeaderThreadName(page)
    expect(threadName).toMatch(/^thread-/)
    await expect.poll(() => workspaceNames(repository, [threadName])).toEqual(['default', threadName].sort())
  })
  await finishJourneyAssertions(page)
})

When('the New thread destination lookup is held', async ({ page }: { page: Page }) => {
  let requestSeen = false
  let releaseLookup: (() => void) | undefined
  const lookupGate = new Promise<void>(resolve => {
    releaseLookup = resolve
  })
  heldDestinationLookups.set(page, {
    wasRequested: () => requestSeen,
    release: () => releaseLookup?.(),
  })
  await page.context().route('**/api/**', async route => {
    const parsedRequest = destinationRequestSchema.safeParse(route.request().postDataJSON())
    if (!parsedRequest.success || requestSeen) return route.continue()
    requestSeen = true
    await lookupGate
    return route.continue()
  })
})

When('Backlog is selected while the destination lookup is held', async ({ page }: { page: Page }) => {
  await expect.poll(heldDestinationLookupFor(page).wasRequested).toBe(true)
  await page.getByRole('navigation', { name: 'Sidebar navigation', exact: true }).getByRole('button', { name: 'Backlog: Items', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Backlog: Items', exact: true })).toHaveAttribute('aria-selected', 'true')
})

When('the held New thread destination lookup is released', async ({ page }: { page: Page }) => {
  heldDestinationLookupFor(page).release()
})

Then('the completed first send leaves Backlog selected', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-new-thread-first-send-keeps-backlog-selected', async () => {
    await expect(page.getByText(/^Thread started in /u)).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Backlog: Items', exact: true })).toHaveAttribute('aria-selected', 'true')
  })
  await finishJourneyAssertions(page)
})

When('the next five New thread destination lookups fail', async ({ page }: { page: Page }) => {
  let remainingFailures = 5
  await page.context().route('**/api/**', async route => {
    const parsedRequest = destinationRequestSchema.safeParse(route.request().postDataJSON())
    if (!parsedRequest.success || remainingFailures === 0) return route.continue()
    remainingFailures -= 1
    const request = parsedRequest.data
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'server-response',
        rpcId: request.rpcId,
        result: { ok: false, error: { code: 'e2e.destination-failed', message: 'Injected destination failure', details: {} } },
      }),
    })
  })
})

Then('a failed destination lookup leaves the first send retryable', async ({ page }: { page: Page }) => {
  const destination = page.getByLabel('New thread destination', { exact: true })
  const composer = newThreadComposer(page)
  await expect(destination.getByRole('alert')).toContainText('Could not determine the workspace destination.')
  await composer.fill('first message from the inherited workspace')
  await composer.press('Enter')
  await expect(composer).toHaveText('first message from the inherited workspace')
  await expect(page.getByText('The workspace could not be prepared; the message was not sent. Send again to retry.', { exact: true })).toBeVisible()
  const previousThread = provisionedThreadName(page)
  await expect(projectButton(page)).toHaveText(`repo · ${previousThread}`)
  expect(workspaceNames(repositoryFor(page), [previousThread])).toEqual(['default', previousThread].sort())
  await destination.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(destination.getByRole('alert')).toHaveCount(0)
  await expect(composer).toHaveText('first message from the inherited workspace')
  await expect.poll(() => workspaceNames(repositoryFor(page), [previousThread])).toHaveLength(3)
  await finishJourneyAssertions(page)
})

Then('the blank new thread keeps the previous workspace until it sends', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  const previousThread = provisionedThreadName(page)
  await recordAssertion(page, 'jj-integration-empty-new-thread-defers-its-workspace', async () => {
    await expect(newThreadComposer(page)).toBeVisible()
    await expect(newThreadComposer(page)).toHaveText('')
    await expect(projectButton(page)).toHaveText(`repo · ${previousThread}`)
    await expect(workspaceToggle(page)).toBeChecked()
    await expect(page.getByRole('status', { name: /^thread-/ })).toHaveCount(0)
    expect(workspaceNames(repository, [previousThread])).toEqual(['default', previousThread])
  })
  await finishJourneyAssertions(page)
})

When('the blank new thread sends its first message', async ({ page }: { page: Page }) => {
  const sourceSessionId = new URL(page.url()).searchParams.get('thread')
  if (sourceSessionId === null) throw new Error('The blank New thread has no Session ID in the URL.')
  const composer = newThreadComposer(page)
  await composer.fill('first message from the inherited workspace')
  await composer.press('Enter')
  await expect(newThreadComposer(page)).toHaveCount(0, { timeout: 45_000 })
  const destinationSessionId = (): string | null => new URL(page.url()).searchParams.get('thread')
  await expect.poll(destinationSessionId, { timeout: 15_000 }).not.toBe(sourceSessionId)
  const destination = destinationSessionId()
  if (destination === null) throw new Error('The submitted thread has no Session ID in the URL.')
  firstSendMainTabTransitions.set(page, { sourceSessionId, destinationSessionId: destination })
})

Then('the submitted thread replaces the blank main tab', async ({ page }: { page: Page }) => {
  const transition = firstSendMainTabTransitions.get(page)
  if (transition === undefined) throw new Error('No first-send main-tab transition was recorded.')
  const tabs = page.getByRole('tablist', { name: 'Open views', exact: true })
  await recordAssertion(page, 'jj-integration-first-send-replaces-blank-main-tab', async () => {
    expect(transition.destinationSessionId).not.toBe(transition.sourceSessionId)
    await expect(tabs.locator(`[data-tab-id="thread:${transition.sourceSessionId}"]`)).toHaveCount(0)
    await expect(tabs.locator(`[data-tab-id="thread:${transition.destinationSessionId}"]`)).toHaveAttribute('aria-selected', 'true')
  })
})

Then('the new thread provisioned its own jj workspace instead of the previous one', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  const previousThread = provisionedThreadName(page)
  await expect(page.getByText('first message from the inherited workspace', { exact: true })).toBeVisible({ timeout: 45_000 })
  const threadName = await currentHeaderThreadName(page)
  await recordAssertion(page, 'jj-integration-new-thread-provisions-its-own-workspace', async () => {
    expect(threadName).not.toBe(previousThread)
    await expect.poll(() => workspaceNames(repository, [previousThread, threadName])).toEqual(['default', previousThread, threadName].sort())
    expect(commitIdOf(repository, `${threadName}@-`)).toBe(repository.baseCommitId)
  })
  provisionedThreads.set(page, threadName)
  await finishJourneyAssertions(page)
})

When('the thread workspace gains a revision described {string}', async ({ page }: { page: Page }, description: string) => {
  const repository = repositoryFor(page)
  const threadPath = join(repository.threadsPath, provisionedThreadName(page))
  await writeFile(join(threadPath, 'feature.txt'), `${description}\n`)
  jjAt(threadPath, repository.temporaryRoot, ['describe', '--message', description])
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
    expect(workspaceNames(repository, [provisionedThreadName(page)])).toEqual(['default', provisionedThreadName(page)])
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
    await expect.poll(() => workspaceNames(repository, expectedWorkspaceNames)).toEqual(expectedWorkspaceNames)
    expect(commitIdOf(repository, `${threadName}@-`)).toBe(expectedParent)
  })
})

Then('the blank thread returns to the shared checkout and its workspace is kept as a spare', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  const threadName = provisionedThreadName(page)
  await recordAssertion(page, 'jj-integration-spare-kept-on-toggle', async () => {
    await expect(workspaceToggle(page)).not.toBeChecked()
    await expect.poll(() => workspaceNames(repository, [threadName])).toEqual(['default', threadName])
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
    await expect(page.getByText(/Integrated 1 revision\(s\) into main/)).toBeVisible()
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
    await expect(workspaceMenu(page)).toContainText('Nothing to integrate')
    await expect(rebaseButton(page)).toBeDisabled()
  })
})

Then('Rebase refuses the placeholder description and leaves main in place', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await openWorkspaceMenu(page)
  await expect(workspaceMenu(page)).toContainText('1 pending integration', { timeout: 10_000 })
  await expect(rebaseButton(page)).toBeEnabled()
  await rebaseButton(page).click()
  await recordAssertion(page, 'jj-integration-rebase-asks-for-a-description', async () => {
    await expect(page.getByRole('alert').filter({ hasText: /^Describe these revisions before integrating: \w+\./ })).toBeVisible()
    expect(commitIdOf(repository, 'main')).toBe(repository.baseCommitId)
  })
})

Then('Rebase moves main onto the work described {string}', async ({ page }: { page: Page }, description: string) => {
  const repository = repositoryFor(page)
  await openWorkspaceMenu(page)
  await expect(workspaceMenu(page)).toContainText('1 pending integration')
  await rebaseButton(page).click()
  await recordAssertion(page, 'jj-integration-rebase-moves-the-bookmark', async () => {
    const rebasedToast = page.getByRole('alert').filter({ hasText: 'Integrated 1 revision(s) into main:' })
    await expect(rebasedToast).toContainText(description)
    await expect(rebaseButton(page)).toBeDisabled()
    const notice = page.getByTestId('jj-thread-rebased-notice')
    await expect(notice).toHaveCount(1)
    expect(descriptionOf(repository, 'main')).toBe(description)

    await expect(notice).toBeVisible()
    await expect(notice).toContainText(`Integrated into main (${changeIdOf(repository, 'main')})`)
    await expect(notice.getByRole('button', { name: 'Settle this integrated thread', exact: true })).toBeEnabled()
    await expect(notice.getByRole('button', { name: 'Archive this integrated thread', exact: true })).toHaveCount(0)
    // A thread lands more than once, so each land is a row in the transcript rather than a banner in the composer dock.
    const noticeBounds = await notice.boundingBox()
    const composerBounds = await threadComposer(page).boundingBox()
    if (noticeBounds === null || composerBounds === null) throw new Error('The rebased notice or the composer has no layout box.')
    expect(noticeBounds.y + noticeBounds.height).toBeLessThan(composerBounds.y)
    await expect(rebasedToast).toContainText('main is now at')
    await expect(rebasedToast).toContainText(`(${commitIdOf(repository, 'main').slice(0, 8)})`)
    expect(commitIdOf(repository, 'main-')).toBe(repository.baseCommitId)
  })
  await finishJourneyAssertions(page)
})

Then('Rebase detects the follow-up revision without reloading', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-rebase-refreshes-new-work-without-reload', async () => {
    await expect(workspaceMenu(page)).toContainText('1 pending integration', { timeout: 10_000 })
    await expect(rebaseButton(page)).toBeEnabled()
  })
})

When('the end of the turn offers no integration before there is work', async ({ page }: { page: Page }) => {
  await expect(turnEndIntegrateOffer(page)).toHaveCount(0)
})

Then('the end of the turn offers one revision to integrate into main', async ({ page }: { page: Page }) => {
  const offer = turnEndIntegrateOffer(page)
  await recordAssertion(page, 'jj-integration-turn-end-integrates-in-one-click', async () => {
    await expect(offer).toBeVisible({ timeout: 20_000 })
    await expect(offer).toContainText('1 revision(s) ready to integrate into main.')
    await expect(offer.getByRole('button', { name: 'Integrate into main', exact: true })).toBeEnabled()
  })
  // One click away means inside the reading flow: above the composer, not hidden in the header.
  const offerBounds = await offer.boundingBox()
  const composerBounds = await threadComposer(page).boundingBox()
  if (offerBounds === null || composerBounds === null) throw new Error('The turn-end offer or the thread composer has no layout box.')
  expect(offerBounds.y + offerBounds.height).toBeLessThanOrEqual(composerBounds.y)
  await finishJourneyAssertions(page)
})

When('the integration is clicked at the end of the turn', async ({ page }: { page: Page }) => {
  await turnEndIntegrateOffer(page).getByRole('button', { name: 'Integrate into main', exact: true }).click()
})

Then('the inline integration advances main and confirms it in the chat', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-integration-turn-end-land-confirms-in-chat', async () => {
    const notice = page.getByTestId('jj-thread-rebased-notice')
    await expect(notice).toHaveCount(1)
    await expect(notice).toContainText('Integrated into main')
    await expect(turnEndIntegrateOffer(page)).toHaveCount(0)
    expect(descriptionOf(repository, 'main')).toBe('One click work')
    expect(commitIdOf(repository, 'main-')).toBe(repository.baseCommitId)
  })
  await finishJourneyAssertions(page)
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
    await expect(workspaceMenu(page)).toContainText('Nothing to integrate', { timeout: 10_000 })
    await expect(rebaseButton(page)).toBeDisabled()
    expect(descriptionOf(repository, 'main')).toBe('Follow-up after a steer')
  })
})

When('the thread is settled from the rebase notice', async ({ page }: { page: Page }) => {
  const notice = page.getByTestId('jj-thread-rebased-notice').last()
  await notice.getByRole('button', { name: 'Settle this integrated thread', exact: true }).click()
  // The sidebar answered the request, so the notice stops offering an action that already happened.
  await expect(notice.getByRole('button', { name: 'Settle this integrated thread', exact: true })).toHaveCount(0)
})

Then('the thread appears in the Settled sidebar section', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'All threads', exact: true }).click()
  const settledSection = page.getByRole('region', { name: 'Threads', exact: true }).getByRole('button', { name: 'Settled (1)', exact: true })
  await recordAssertion(page, 'jj-integration-rebased-thread-can-be-settled-from-notice', () => expect(settledSection).toBeVisible())
  await finishJourneyAssertions(page)
})

When('the Thread workspaces panel is opened', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'JJ Integration: Thread integration')
  await expect(page.getByRole('heading', { name: 'Thread integration', exact: true })).toBeVisible()
})

Then('the Thread integration panel prioritises work needing attention', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('button', { name: /^Needs attention/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Ready/ })).toBeVisible()
  await expect(threadRow(page).getByRole('button', { name: 'Integrate', exact: true })).toBeVisible()
})

When('the All integration view is selected', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: /^All/ }).click()
})

Then('the Thread integration panel keeps its counts visible', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('button', { name: /^Needs attention/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Completed/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Conflicts/ })).toBeVisible()
})

Then('the thread row details show revisions, sessions, path and preview', async ({ page }: { page: Page }) => {
  const row = threadRow(page)
  await row.getByRole('button', { name: 'View details', exact: true }).click()
  await expect(row.getByText('Detailed work', { exact: false })).toBeVisible()
  await expect(row.getByText(threadWorkspacePathFor(page), { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: `Copy workspace ID ${provisionedThreadName(page)}`, exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Open thread: jj integration rebase e2e thread', exact: true }).first()).toBeVisible()
  await row.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(row).toContainText('jj integration rebase e2e thread')
})

Then('the New thread picker shows its Projects and JJ workspace listings for a disposable repository', async ({ page }: { page: Page }) => {
  await page
    .getByRole('button', { name: /^(?:New session|New thread)$/ })
    .first()
    .click()
  await expect(newThreadComposer(page)).toBeVisible()
  const repository = await createRepository(page)
  await chooseProjectPath(page, repository.repositoryPath)
  await workspaceToggle(page).check()
  await expect(projectButton(page)).toHaveText(/^repo · thread-/)
  provisionedThreads.set(page, await currentThreadName(page))
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  const settled = page.getByRole('status').filter({ hasText: /^(Completed|Failed|Stopped|Cancelled)$/ })
  const settledCount = await settled.count()
  await newThreadComposer(page).fill('jj picker workspace seed')
  await newThreadComposer(page).press('Enter')
  await expect(settled).toHaveCount(settledCount + 1, { timeout: 60_000 })
  await expect(page.getByRole('textbox', { name: threadComposerName, exact: true })).toBeVisible()
  await expect.poll(() => workspaceNames(repository)).toContain(provisionedThreadName(page))
  await page.reload()
  await expect(threadComposer(page)).toBeVisible()
  await page
    .getByRole('button', { name: /^(?:New session|New thread)$/ })
    .first()
    .click()
  await expect(newThreadComposer(page)).toBeVisible()
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  await projectButton(page).click()

  const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
  const projects = picker.getByRole('listbox', { name: 'Projects', exact: true })
  await expect(projects.getByRole('option', { name: /^No folder/ }).first()).toBeVisible()
  await picker.getByRole('button', { name: 'Filter by scope', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Everything', exact: true }).click()
  await expect(picker.getByRole('group', { name: 'JJ workspaces', exact: true })).toContainText(provisionedThreadName(page))
})

/** Long enough to queue, undo and queue again while the turn still runs, even on a loaded machine. */
const BUSY_BASH_DIRECTIVE = `[[once call bash ${JSON.stringify({ command: 'sleep 60 && echo queued-integration', description: 'Keep the thread busy' })}]]`
const queueIntegrationButton = (page: Page) => page.getByRole('button', { name: 'Queue integration into main', exact: true })
const undoQueuedIntegrationButton = (page: Page) => workspaceMenu(page).getByRole('button', { name: 'Cancel the queued integration into main', exact: true })

When('the New thread screen is reopened', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await page
    .getByRole('button', { name: /^(?:New session|New thread)$/ })
    .first()
    .click()
  await expect(newThreadComposer(page)).toBeVisible()
})

When('the fake model keeps the thread workspace busy with a long bash call', async ({ page }: { page: Page }) => {
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  await newThreadComposer(page).fill(BUSY_BASH_DIRECTIVE)
  await newThreadComposer(page).press('Enter')
  await expect(
    page
      .getByRole('timer', { name: /^Running for \d+ s/ })
      .or(page.getByText('Keep the thread busy'))
      .first(),
  ).toBeVisible({ timeout: 30_000 })
})

Then('the workspace menu offers to queue the integration while the thread works', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-queue-offered-while-busy', async () => {
    // The thread status reads jj while the turn's bash call also runs, so it answers slower than an idle thread's.
    await expect(workspaceMenu(page)).toContainText('1 pending integration', { timeout: 45_000 })
    await expect(queueIntegrationButton(page)).toBeEnabled()
    await expect(rebaseButton(page)).toHaveCount(0)
    expect(commitIdOf(repository, 'main')).toBe(repository.baseCommitId)
  })
})

When('the integration is queued from the workspace menu', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await queueIntegrationButton(page).click()
})

Then('the thread shows the queued integration notice with Undo', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await page.getByRole('button', { name: 'All threads', exact: true }).click()
  await recordAssertion(page, 'jj-integration-queued-integration-shows-undo', async () => {
    const notice = page.getByTestId('jj-thread-integration-queued-notice')
    await expect(notice).toContainText('Integration into main queued')
    await expect(notice.getByRole('button', { name: 'Cancel the queued integration into main' })).toBeEnabled()
    await expect(page.getByTestId('thread-sidebar-integration-queued-tag')).toBeVisible()
    expect(commitIdOf(repository, 'main')).toBe(repository.baseCommitId)
  })
})

When('the queued integration is undone', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await page.getByTestId('jj-thread-integration-queued-notice').getByRole('button', { name: 'Cancel the queued integration into main' }).click()
  await expect(page.getByTestId('jj-thread-integration-unqueued-notice')).toContainText('Queued integration into main cancelled.')
  await expect(page.getByTestId('thread-sidebar-integration-queued-tag')).toHaveCount(0, { timeout: 15_000 })
})

Then('the undone integration leaves main in place and can be queued again', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-undone-integration-can-be-queued-again', async () => {
    await expect(queueIntegrationButton(page)).toBeEnabled({ timeout: 10_000 })
    await expect(workspaceMenu(page)).not.toContainText('Queued:')
    expect(commitIdOf(repository, 'main')).toBe(repository.baseCommitId)
  })
})

Then('main advances onto the work described {string} once the thread is idle', async ({ page }: { page: Page }, description: string) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jj-integration-queued-integration-lands-when-idle', async () => {
    await expect.poll(() => descriptionOf(repository, 'main'), { timeout: 150_000, intervals: [1_000] }).toBe(description)
    expect(commitIdOf(repository, 'main-')).toBe(repository.baseCommitId)
    await openWorkspaceMenu(page)
    await expect(workspaceMenu(page)).not.toContainText('Queued:', { timeout: 15_000 })
    await expect(page.getByTestId('thread-sidebar-integration-queued-tag')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('thread-sidebar-rebased-tag')).toBeVisible()
    await expect(page.getByTestId('jj-thread-rebased-notice')).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the thread row offers Integrate for its 1 revision', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'jj-integration-panel-offers-integrate-only-for-valid-work', async () => {
    await expect(threadRow(page).getByText('1 pending revision', { exact: true })).toBeVisible()
    await expect(threadRow(page).getByRole('button', { name: 'Integrate', exact: true })).toBeVisible()
    await expect(threadRow(page).getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0)
  })
})

When('a ready workspace is selected for batch integration', async ({ page }: { page: Page }) => {
  await threadRow(page)
    .getByRole('checkbox', { name: /^Select workspace /u })
    .check()
})

Then('Integrate selected is enabled', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('button', { name: 'Integrate selected (1)', exact: true })).toBeEnabled()
})

When('Integrate selected is clicked', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Integrate selected (1)', exact: true }).click()
})

Then('the thread workspace row immediately shows that it is integrated', async ({ page }: { page: Page }) => {
  const row = threadRow(page)
  await expect(row.getByText('Integrated', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Integrate', exact: true })).toHaveCount(0)
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
  await expect(page.getByRole('heading', { name: 'Thread integration', exact: true }).last()).toBeVisible()
})

Then('the thread header offers Rebase for its 1 revision', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-header-offers-rebase-with-work', async () => {
    await expect(workspaceMenu(page)).toContainText('1 pending integration', { timeout: 10_000 })
    await expect(rebaseButton(page)).toBeEnabled()
  })
})

Then('the thread header shows nothing to rebase without reloading', async ({ page }: { page: Page }) => {
  await openWorkspaceMenu(page)
  await recordAssertion(page, 'jj-integration-header-refreshes-external-rebase', async () => {
    await expect(workspaceMenu(page)).toContainText('Nothing to integrate', { timeout: 10_000 })
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
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session.export', { timeout: 15_000 })
    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
    await row.click()
    const [response, download] = await Promise.all([responsePromise, downloadPromise])
    expect(response.status()).toBe(200)
    expect(download.suggestedFilename()).toMatch(/\.zip$/u)
  })
})

Then('its Preview shows the latest message', async ({ page }: { page: Page }) => {
  const row = threadRow(page)
  await row.getByRole('button', { name: 'View details', exact: true }).click()
  await row.getByRole('button', { name: 'Preview', exact: true }).click()
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
  heldDestinationLookups.get(page)?.release()
  heldDestinationLookups.delete(page)
  const repository = repositories.get(page)
  if (repository === undefined) return
  repositories.delete(page)
  // The Host prewarms the next thread's spare workspace in the background, so the store can still be written while
  // the fixture is removed; retry instead of failing the journey on the teardown.
  await rm(repository.temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
