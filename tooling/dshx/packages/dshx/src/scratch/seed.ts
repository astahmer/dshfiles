import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { z } from 'zod'
import type { ReachSeed } from '../project/features.js'
import { DSHFILES_ROOT } from '../project/local-bundles.js'
import { FAKE_COMMAND_CODE_MODEL } from './fake-command-code.js'
import { ScratchError, spawnDetached, type ScratchState } from './state.js'

const NEW_THREAD_COMPOSER = 'Describe what you want to build, / commands, @ files or sessions'
export const NEW_THREAD_START_BUTTON_NAME = /^(?:New thread|New session)$/i
const fakeProviderScript = fileURLToPath(new URL('./fake-provider-main.js', import.meta.url))
const FAKE_PROVIDER_ACCOUNT = 'Command Code 1'
/** A call that runs long enough to watch a live tool-call counter, then settles. */
const TOOL_CALL_DIRECTIVE = `[[call bash ${JSON.stringify({ command: 'sleep 3 && echo tool-call-thread', description: 'Wait three seconds' })}]]`
const REBASE_READY_THREAD_MESSAGE = 'Seeded thread to rebase'
const PENDING_RESTART_MARKER = '\n// dshx dev seed: pending restart\n'
/** thread-sidebar reports pending Host updates, so its own Host entry is the one a seeded rebuild changes. */
const PENDING_RESTART_PLUGIN = '@dshfiles/thread-sidebar'

const runJj = (input: { readonly cwd: string; readonly home: string; readonly args: readonly string[]; readonly purpose: string }): void => {
  const result = spawnSync('jj', ['--color=never', '--no-pager', ...input.args], {
    cwd: input.cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: input.home,
      XDG_CONFIG_HOME: join(input.home, 'config'),
      JJ_USER: 'Scratch DSH',
      JJ_EMAIL: 'scratch-dsh@example.invalid',
    },
    encoding: 'utf8',
    timeout: 20_000,
  })
  if (result.error !== undefined || result.status !== 0) {
    throw new ScratchError(
      'project-seed-failed',
      `jj ${input.args[0] ?? ''} failed while ${input.purpose}: ${result.stderr ?? result.error?.message ?? ''}`,
      'Install jj, or pass --project <dir> to register an existing folder.',
    )
  }
}

/** A jj repository with a `main` bookmark, so jj-integration's destination bar has a bookmark and isolation to show. */
const seedSampleProject = async (home: string): Promise<string> => {
  const project = join(home, 'projects', 'sample')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'README.md'), '# Sample\n\nScratch project created by dshx dev up.\n')
  const skillDirectory = join(home, 'skills', 'e2e-skill-mentions')
  await mkdir(skillDirectory, { recursive: true })
  await writeFile(
    join(skillDirectory, 'SKILL.md'),
    `---\nname: e2e-skill-mentions\ndescription: Deterministic fixture for @ skill autocomplete.\nuser-invocable: true\ndisable-model-invocation: true\n---\nUsed only by the autocomplete scratch journey.\n`,
  )
  for (const args of [
    ['git', 'init', '--no-colocate'],
    ['describe', '--message', 'Sample project'],
    ['bookmark', 'create', 'main', '--revision', '@'],
    ['new'],
  ]) {
    runJj({ cwd: project, home, args, purpose: 'seeding the sample project' })
  }
  return project
}

/**
 * Start a thread in its own jj workspace through the New thread screen, then stand in for the agent's edit with a
 * described revision in that workspace, so the Rebase action is available.
 */
const seedRebaseReadyThread = async (state: ScratchState, page: Page, timeoutMs: number): Promise<void> => {
  if (!state.bundles.includes('@dshfiles/jj-integration')) {
    throw new ScratchError(
      'seed-needs-plugin',
      'Seed rebase-ready-thread needs @dshfiles/jj-integration.',
      'Run "dshx dev down" then "dshx dev up --plugin @dshfiles/jj-integration ...".',
    )
  }
  const composer = page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true })
  if (!(await composer.isVisible())) await page.getByRole('button', { name: 'New thread', exact: true }).first().click({ timeout: timeoutMs })
  await composer.waitFor({ state: 'visible', timeout: timeoutMs })
  const projectName = basename(state.project.path)
  const projectButton = page.getByRole('button', { name: 'Choose workspace', exact: true })
  if ((await projectButton.textContent())?.trim() !== projectName) {
    await projectButton.click({ timeout: timeoutMs })
    await page.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true }).fill(projectName, { timeout: timeoutMs })
    await page.getByRole('option', { name: projectName }).first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page.keyboard.press('Enter')
  }
  const workspaceToggle = page.getByRole('checkbox', { name: 'workspace', exact: true })
  if ((await workspaceToggle.getAttribute('aria-checked', { timeout: timeoutMs })) !== 'true') await workspaceToggle.click({ timeout: timeoutMs })
  const threadLabel = new RegExp(`^${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · (thread-[\\w-]+)$`)
  const deadline = Date.now() + timeoutMs
  let threadName: string | undefined
  while (threadName === undefined && Date.now() < deadline) {
    threadName = threadLabel.exec((await projectButton.textContent())?.trim() ?? '')?.[1]
    if (threadName === undefined) await page.waitForTimeout(250)
  }
  if (threadName === undefined) {
    throw new ScratchError(
      'seed-failed',
      'The workspace toggle did not provision a thread workspace.',
      'Run "dshx dev open jj-integration/thread-destination".',
    )
  }
  await composer.fill(REBASE_READY_THREAD_MESSAGE)
  await composer.press('Enter')
  await page
    .getByRole('navigation', { name: 'Session hierarchy', exact: true })
    .filter({ hasText: REBASE_READY_THREAD_MESSAGE })
    .waitFor({ state: 'visible', timeout: timeoutMs })
  const threadPath = join(dirname(state.project.path), `${projectName}-threads`, threadName)
  if (
    !(await stat(threadPath).then(
      info => info.isDirectory(),
      () => false,
    ))
  ) {
    throw new ScratchError('seed-failed', `The thread workspace ${threadPath} does not exist.`, 'Check jj-integration threadsDirectory in the scratch profile.')
  }
  await writeFile(join(threadPath, 'seeded-work.md'), 'Work a scratch thread is ready to rebase.\n')
  runJj({ cwd: threadPath, home: state.home, args: ['describe', '--message', 'Seeded work to rebase'], purpose: 'describing the seeded thread work' })
}

/** The scratch profile links owned bundles, so this changes the checkout's build output until `down` restores it. */
const seedPendingRestart = async (state: ScratchState): Promise<string> => {
  if (!state.bundles.includes(PENDING_RESTART_PLUGIN)) {
    throw new ScratchError(
      'seed-needs-plugin',
      `Seed pending-restart needs ${PENDING_RESTART_PLUGIN}.`,
      `Run "dshx dev down" then "dshx dev up --plugin ${PENDING_RESTART_PLUGIN} ...".`,
    )
  }
  const hostEntry = join(DSHFILES_ROOT, 'plugins', PENDING_RESTART_PLUGIN, 'dist', 'index.js')
  const source = await readFile(hostEntry, 'utf8')
  if (!source.endsWith(PENDING_RESTART_MARKER)) await writeFile(hostEntry, `${source}${PENDING_RESTART_MARKER}`)
  return hostEntry
}

/** Undo `seed pending-restart`: the restored file, or undefined when it no longer carries the seed. */
const restorePendingRestart = async (state: ScratchState, dryRun: boolean): Promise<string | undefined> => {
  const hostEntry = state.seeds?.find(applied => applied.seed === 'pending-restart')?.changedFile
  if (hostEntry === undefined) return undefined
  const source = await readFile(hostEntry, 'utf8').catch(() => '')
  if (!source.endsWith(PENDING_RESTART_MARKER)) return undefined
  if (!dryRun) await writeFile(hostEntry, source.slice(0, -PENDING_RESTART_MARKER.length))
  return hostEntry
}

const startFakeProvider = async (
  state: ScratchState,
  timeoutMs: number,
): Promise<{ readonly baseUrl: string; readonly process: NonNullable<ScratchState['fakeProvider']> }> => {
  const readyFile = join(state.stateDir, 'fake-provider.ready')
  await rm(readyFile, { force: true })
  const pid = spawnDetached(process.execPath, [fakeProviderScript, readyFile], {
    cwd: state.stateDir,
    env: process.env,
    log: join(state.stateDir, 'fake-provider.log'),
  })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // The file holds one line once the server listens; a partial write fails the URL check and is read again.
    const ready = z.url().safeParse((await readFile(readyFile, 'utf8').catch(() => '')).trim())
    if (ready.success) return { baseUrl: ready.data, process: { pid, signature: [fakeProviderScript, readyFile] } }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new ScratchError('seed-failed', 'The fake model provider did not start.', `Read ${join(state.stateDir, 'fake-provider.log')}.`)
}

/**
 * Point a Command Code account at a loopback fake provider (ai-accounts) and start a New thread whose model is that
 * account's, so a seed can drive one deterministic turn through the real provider path.
 */
const configureFakeProviderThread = async (input: {
  readonly state: ScratchState
  readonly page: Page
  readonly seed: string
  readonly timeoutMs: number
}): Promise<NonNullable<ScratchState['fakeProvider']>> => {
  const { state, page, timeoutMs } = input
  if (!state.bundles.includes('@dshfiles/ai-accounts')) {
    throw new ScratchError(
      'seed-needs-plugin',
      `Seed ${input.seed} needs @dshfiles/ai-accounts.`,
      'Run "dshx dev down" then "dshx dev up --plugin @dshfiles/ai-accounts ...".',
    )
  }
  const fake = await startFakeProvider(state, timeoutMs)
  await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: timeoutMs })
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click({ timeout: timeoutMs })
  await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click({ timeout: timeoutMs })
  const accounts = page.getByRole('complementary', { name: 'Provider accounts' })
  await accounts.getByRole('button', { name: 'Add account', exact: true }).click({ timeout: timeoutMs })
  await page.getByRole('menuitem', { name: 'Command Code account', exact: true }).click({ timeout: timeoutMs })
  await page.getByRole('heading', { name: FAKE_PROVIDER_ACCOUNT, exact: true }).waitFor({ state: 'visible', timeout: timeoutMs })
  const baseUrl = page.getByRole('textbox', { name: 'API base URL', exact: true })
  await baseUrl.fill(fake.baseUrl, { timeout: timeoutMs })
  await baseUrl.blur()
  await page
    .getByRole('status')
    .filter({ hasText: /^Saved/ })
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
  await page.getByRole('button', { name: 'Set up key…', exact: true }).click({ timeout: timeoutMs })
  const keyDialog = page.getByRole('dialog', { name: `Configure ${FAKE_PROVIDER_ACCOUNT} key`, exact: true })
  await keyDialog.getByRole('textbox', { name: 'API key value', exact: true }).fill('dshx-dev-fake-key', { timeout: timeoutMs })
  await keyDialog.getByRole('button', { name: 'Store key', exact: true }).click({ timeout: timeoutMs })
  await keyDialog.waitFor({ state: 'hidden', timeout: timeoutMs })

  await page.getByRole('button', { name: NEW_THREAD_START_BUTTON_NAME }).first().click({ timeout: timeoutMs })
  const composer = page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true })
  await composer.waitFor({ state: 'visible', timeout: timeoutMs })
  const projectName = basename(state.project.path)
  const projectButton = page.getByRole('button', { name: 'Choose workspace', exact: true })
  if ((await projectButton.textContent())?.trim() !== projectName) {
    await projectButton.click({ timeout: timeoutMs })
    // The native picker is a menu; @dshfiles/jj-integration replaces it with a searchable list.
    const search = page.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true })
    await page.getByRole('menuitem', { name: projectName, exact: true }).or(search).first().waitFor({ state: 'visible', timeout: timeoutMs })
    if (await search.isVisible()) {
      await search.fill(projectName, { timeout: timeoutMs })
      await page.getByRole('option', { name: projectName }).first().waitFor({ state: 'visible', timeout: timeoutMs })
      await page.keyboard.press('Enter')
    } else await page.getByRole('menuitem', { name: projectName, exact: true }).click({ timeout: timeoutMs })
  }
  // A just-added account publishes its models a moment later, so the picker is reopened until the model is listed.
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Select model/ }).click({ timeout: timeoutMs })
    await page.getByRole('menuitem', { name: /^Model / }).click({ timeout: timeoutMs })
    const picked = await page
      .getByRole('menuitemradio', { name: FAKE_COMMAND_CODE_MODEL, exact: true })
      .click({ timeout: 2_000 })
      .then(
        () => true,
        () => false,
      )
    if (picked) break
    if (Date.now() > deadline)
      throw new ScratchError('seed-failed', `The model picker never listed ${FAKE_COMMAND_CODE_MODEL}.`, 'Check the AI Accounts panel.')
  }
  return fake.process
}

const fakeProviderComposer = (page: Page) => page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true })

const sendFakeProviderTurn = async (page: Page, prompt: string, timeoutMs: number): Promise<void> => {
  const composer = fakeProviderComposer(page)
  await composer.fill(prompt, { timeout: timeoutMs })
  await composer.press('Enter')
}

/** A thread whose model calls `bash` for a few seconds, so tool-call cards with real call and result times exist. */
const seedToolCallThread = async (state: ScratchState, page: Page, timeoutMs: number): Promise<NonNullable<ScratchState['fakeProvider']>> => {
  const process = await configureFakeProviderThread({ state, page, seed: 'tool-call-thread', timeoutMs })
  await sendFakeProviderTurn(page, TOOL_CALL_DIRECTIVE, timeoutMs)
  await page
    .getByText('Tool finished.', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs + 10_000 })
  return process
}

const FAKE_SECRET_CLI = join(DSHFILES_ROOT, 'tooling', 'dshx', 'e2e', 'support', 'fake-secret-cli.mjs')

/** Synthetic aliases for the scratch project: one global, a project alias in two environments, one machine-local. */
const fakeSecretStore = (project: string): string => {
  const row = (fields: {
    readonly alias: string
    readonly scope: string
    readonly root: string | null
    readonly environment: string
    readonly item: string
    readonly source: string
  }) => ({
    ...fields,
    field: 'password',
  })
  return `${JSON.stringify(
    {
      rows: [
        row({ alias: 'GITHUB_TOKEN', scope: 'global', root: null, environment: 'prod', item: 'item-github', source: 'github' }),
        row({ alias: 'DB_PASSWORD', scope: 'project', root: project, environment: 'prod', item: 'item-db-prod', source: 'postgres' }),
        row({ alias: 'DB_PASSWORD', scope: 'project', root: project, environment: 'dev', item: 'item-db-dev', source: 'postgres' }),
        row({ alias: 'LOCAL_TOKEN', scope: 'local', root: project, environment: 'prod', item: 'item-local', source: 'laptop' }),
      ],
      vault: {
        'item-github': 'scratch-fake-github-value',
        'item-db-prod': 'scratch-fake-db-prod-value',
        'item-db-dev': 'scratch-fake-db-dev-value',
        'item-local': 'scratch-fake-local-value',
      },
    },
    null,
    2,
  )}\n`
}

/**
 * Install the e2e fake `secret` CLI in the scratch home with a synthetic store for `project`, so a Host started with
 * the returned directory first on PATH never reaches a real vault. Returns that directory.
 */
const installFakeSecretCli = async (input: { readonly home: string; readonly project: string }): Promise<string> => {
  const bin = join(input.home, 'fake-secret-cli')
  await mkdir(bin, { recursive: true })
  await copyFile(FAKE_SECRET_CLI, join(bin, 'secret'))
  await chmod(join(bin, 'secret'), 0o755)
  await writeFile(join(bin, 'store.json'), fakeSecretStore(input.project), { mode: 0o600 })
  return bin
}

const CHAT_REFERENCE_PROMPT = '[[answer Trunk is `jj:main` here]]'
const CHAT_REFERENCE_LINK = 'main'

/**
 * A thread whose assistant answer holds an explicit `` `jj:main` `` code span, so the chat link exists in a real
 * rendered transcript before the walk clicks it. Waits for the link itself: marking it is what the walk proves.
 */
const seedChatReferenceThread = async (state: ScratchState, page: Page, timeoutMs: number): Promise<NonNullable<ScratchState['fakeProvider']>> => {
  if (!state.bundles.includes('@dshfiles/jujutsu')) {
    throw new ScratchError(
      'seed-needs-plugin',
      'Seed chat-reference-thread needs @dshfiles/jujutsu.',
      'Run "dshx dev down" then "dshx dev up --plugin @dshfiles/jujutsu ...".',
    )
  }
  const process = await configureFakeProviderThread({ state, page, seed: 'chat-reference-thread', timeoutMs })
  await sendFakeProviderTurn(page, CHAT_REFERENCE_PROMPT, timeoutMs)
  await page.getByRole('link', { name: CHAT_REFERENCE_LINK, exact: true }).first().waitFor({ state: 'visible', timeout: timeoutMs })
  return process
}

const seedFakeSecretCli = async (state: ScratchState): Promise<void> => {
  if (state.fakeSecretCli === undefined) {
    throw new ScratchError(
      'seed-needs-fake-secret-cli',
      'Seed fake-secret-cli needs a Host started with the fake secret CLI on its PATH.',
      'Run "dshx dev down" then "dshx dev up --fake-secret-cli --plugin @dshfiles/secret-catalog ...".',
    )
  }
  await writeFile(join(state.fakeSecretCli, 'store.json'), fakeSecretStore(state.project.path), { mode: 0o600 })
}

/** Apply one seed: the checkout file it changed and the process it started, if any. */
const applySeed = async (input: {
  readonly state: ScratchState
  readonly seed: ReachSeed
  readonly page: Page
  readonly timeoutMs: number
}): Promise<{ readonly changedFile?: string; readonly fakeProvider?: NonNullable<ScratchState['fakeProvider']> }> => {
  if (input.seed === 'pending-restart') return { changedFile: await seedPendingRestart(input.state) }
  if (input.seed === 'fake-secret-cli') {
    await seedFakeSecretCli(input.state)
    return {}
  }
  if (input.seed === 'tool-call-thread') return { fakeProvider: await seedToolCallThread(input.state, input.page, input.timeoutMs) }
  if (input.seed === 'chat-reference-thread') return { fakeProvider: await seedChatReferenceThread(input.state, input.page, input.timeoutMs) }
  await seedRebaseReadyThread(input.state, input.page, input.timeoutMs)
  return {}
}

export class ScratchSeedRuntime {
  static readonly sampleProject = seedSampleProject
  static readonly restorePendingRestart = restorePendingRestart
  static readonly installFakeSecretCli = installFakeSecretCli
  static readonly applySeed = applySeed
}
