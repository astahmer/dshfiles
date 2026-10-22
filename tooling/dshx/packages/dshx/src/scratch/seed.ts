import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { z } from 'zod'
import type { ReachSeed } from '../project/features.js'
import { DSHFILES_ROOT } from '../project/local-bundles.js'
import { FAKE_COMMAND_CODE_MODEL, FAKE_COMMAND_CODE_MODEL_ID } from './fake-command-code.js'
import { ScratchError, ScratchStateRuntime, type ScratchState } from './state.js'

const NEW_THREAD_COMPOSER = 'Describe what you want to build, / commands, @ files or sessions'
const AI_ACCOUNTS_BUTTON_NAME = 'AI Accounts'
const FAKE_PROVIDER_ROUTE_SLUG = 'dshx_fake_commandcode'
const FAKE_PROVIDER_KEY_REF = 'DSHX_FAKE_COMMANDCODE_API_KEY'
export const NEW_THREAD_START_BUTTON_NAME = /^(?:New thread|New session)$/i
const fakeProviderScript = fileURLToPath(new URL('./fake-provider-main.js', import.meta.url))

const openSettingsDialog = async (page: Page, timeoutMs: number): Promise<void> => {
  const launcher = page.locator('[data-slot="settings.launcher"] button').first()
  if (await launcher.isVisible()) await launcher.click({ timeout: timeoutMs })
  else await page.getByRole('button', { name: 'Account menu', exact: true }).click({ timeout: timeoutMs })
  await page.getByRole('menuitem', { name: /^Settings/ }).click({ timeout: timeoutMs })
}

const seedBacklogJevEnabled = async (page: Page, timeoutMs: number): Promise<void> => {
  await openSettingsDialog(page, timeoutMs)
  await page.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('Jev enabled', { timeout: timeoutMs })
  const jevEnabled = page.getByRole('switch', { name: 'Jev enabled', exact: true })
  await jevEnabled.waitFor({ state: 'visible', timeout: timeoutMs })
  if ((await jevEnabled.getAttribute('aria-checked')) === 'true') {
    await page.keyboard.press('Escape')
    return
  }
  await jevEnabled.click({ timeout: timeoutMs })
  if ((await jevEnabled.getAttribute('aria-checked')) !== 'true') throw new Error('Backlog Jev did not enable in Settings.')
  await page.keyboard.press('Escape')
}

const openAIAccountsPanel = async (page: Page, timeoutMs: number): Promise<void> => {
  const accounts = page.getByRole('complementary', { name: 'Provider accounts' })
  if (await accounts.isVisible()) return

  const globalPanel = page.getByRole('button', { name: AI_ACCOUNTS_BUTTON_NAME, exact: true })
  if (await globalPanel.isVisible()) await globalPanel.click({ timeout: timeoutMs })
  else {
    await openSettingsDialog(page, timeoutMs)
    await page.getByRole('dialog').getByRole('button', { name: AI_ACCOUNTS_BUTTON_NAME, exact: true }).click({ timeout: timeoutMs })
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click({ timeout: timeoutMs })
  }
  await accounts.waitFor({ state: 'visible', timeout: timeoutMs })
}

const openSeedThreadComposer = async (page: Page, timeoutMs: number) => {
  const composer = page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true })
  if (await composer.isVisible()) return composer
  await page.getByRole('button', { name: NEW_THREAD_START_BUTTON_NAME }).first().click({ timeout: timeoutMs })
  const composerAppeared = await composer.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 1_000) }).then(
    () => true,
    error => {
      if (error instanceof Error && error.name === 'TimeoutError') return false
      throw error
    },
  )
  if (!composerAppeared) await page.getByRole('treeitem').filter({ hasText: 'New Session' }).last().click({ timeout: timeoutMs })
  await composer.waitFor({ state: 'visible', timeout: timeoutMs })
  return composer
}

const chooseFakeProviderModel = async (input: { readonly page: Page; readonly timeoutMs: number; readonly modelId?: string }): Promise<void> => {
  const modelId = input.modelId ?? FAKE_COMMAND_CODE_MODEL
  const modelPicker = input.page.getByRole('button', { name: /^(?:Select model|.+,\s*reasoning)/u }).first()
  const currentModelLabel = (await modelPicker.getAttribute('aria-label')) ?? ''
  if (currentModelLabel.includes(modelId)) return

  await modelPicker.click({ timeout: Math.min(input.timeoutMs, 5_000) })
  const modelList = input.page.getByRole('list', { name: 'Models grouped by provider', exact: true })
  const hasModelEffortPicker = (await modelList.count()) > 0
  const routeOption = input.page.getByRole('menuitemradio', { name: modelId, exact: true }).or(modelList.getByRole('button').filter({ hasText: modelId }))
  await routeOption.first().waitFor({ state: 'visible', timeout: input.timeoutMs })
  await routeOption.first().click({ timeout: input.timeoutMs })

  if (hasModelEffortPicker) {
    await input.page.keyboard.press('Escape')
    await modelPicker.waitFor({ state: 'visible', timeout: input.timeoutMs })
    const selectedModelLabel = (await modelPicker.getAttribute('aria-label')) ?? ''
    if (!selectedModelLabel.includes(modelId)) {
      throw new ScratchError('seed-failed', `The model picker kept ${selectedModelLabel || 'no model'} selected.`, 'Check the AI Accounts panel.')
    }
  }
}

/** A call that runs long enough to watch a live tool-call counter, then settles. */
const TOOL_CALL_DIRECTIVE = `[[call bash ${JSON.stringify({ command: 'sleep 3 && echo tool-call-thread', description: 'Wait three seconds' })}]]`
const JEV_SETUP_CHAT_PROMPT = 'Can you help me set up Jev?'
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
  const composer = await openSeedThreadComposer(page, timeoutMs)
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

const FAKE_PROVIDER_ACCOUNTS_FILE = z.object({
  accounts: z.array(z.object({ instanceId: z.string(), displayName: z.string(), apiKeyEnv: z.string(), apiBaseUrl: z.string() })),
})

type FakeProviderAccount = z.infer<typeof FAKE_PROVIDER_ACCOUNTS_FILE>['accounts'][number]

/** What ai-accounts persisted for the fake route, read from its store in the scratch home: the panel's draft can differ. */
const readFakeProviderAccount = async (home: string): Promise<FakeProviderAccount | undefined> => {
  const source = await readFile(join(home, 'plugins', 'ai-accounts', 'accounts.json'), 'utf8').catch(() => '')
  let json: unknown
  // The store is rewritten in place; a read mid-write is not JSON yet and counts as no account.
  try {
    json = JSON.parse(source)
  } catch {
    return undefined
  }
  const parsed = FAKE_PROVIDER_ACCOUNTS_FILE.safeParse(json)
  return parsed.success ? parsed.data.accounts.find(account => account.instanceId === FAKE_PROVIDER_ROUTE_SLUG) : undefined
}

const waitForFakeProviderAccount = async (input: {
  readonly home: string
  readonly timeoutMs: number
  readonly expected: string
  readonly matches: (account: FakeProviderAccount | undefined) => boolean
}): Promise<void> => {
  const deadline = Date.now() + input.timeoutMs
  for (;;) {
    const account = await readFakeProviderAccount(input.home)
    if (input.matches(account)) return
    if (Date.now() > deadline) {
      throw new ScratchError(
        'seed-failed',
        `AI Accounts never saved ${input.expected} for ${FAKE_PROVIDER_ROUTE_SLUG}.`,
        `Read ${join(input.home, 'plugins', 'ai-accounts', 'accounts.json')} and the AI Accounts panel.`,
      )
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** A second seed run reuses the provider the first one started: the account it configured points at that port. */
const startFakeProvider = async (
  state: ScratchState,
  timeoutMs: number,
): Promise<{ readonly baseUrl: string; readonly process: NonNullable<ScratchState['fakeProvider']> }> => {
  const readyFile = join(state.stateDir, 'fake-provider.ready')
  const readBaseUrl = async () => z.url().safeParse((await readFile(readyFile, 'utf8').catch(() => '')).trim())
  const current = (await ScratchStateRuntime.read(state.stateDir, state.name)).fakeProvider
  if (current !== undefined && ScratchStateRuntime.ownedProcessStatus(current) === 'running') {
    const ready = await readBaseUrl()
    if (ready.success) return { baseUrl: ready.data, process: current }
  }
  await rm(readyFile, { force: true })
  const pid = ScratchStateRuntime.spawnDetached(process.execPath, [fakeProviderScript, readyFile], {
    cwd: state.stateDir,
    env: process.env,
    log: join(state.stateDir, 'fake-provider.log'),
  })
  const providerProcess = { pid, signature: [fakeProviderScript, readyFile] }
  await ScratchStateRuntime.trackFakeProvider(state, providerProcess)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // The file holds one line once the server listens; a partial write fails the URL check and is read again.
    const ready = await readBaseUrl()
    if (ready.success) return { baseUrl: ready.data, process: providerProcess }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new ScratchError('seed-failed', 'The fake model provider did not start.', `Read ${join(state.stateDir, 'fake-provider.log')}.`)
}

/**
 * Open the fake route's account in the editor, adding it on the first run. A rename saves on blur and another field's
 * blur saves the whole draft at once, so the slug must land before any other field is touched: two overlapping saves
 * let the stale one win, leaving the account on the default key name and an empty base URL.
 */
const openFakeProviderAccount = async (input: { readonly state: ScratchState; readonly page: Page; readonly timeoutMs: number }): Promise<string> => {
  const { page, timeoutMs } = input
  const accounts = page.getByRole('complementary', { name: 'Provider accounts' })
  const existing = await readFakeProviderAccount(input.state.home)
  if (existing !== undefined) {
    await accounts
      .getByRole('listitem')
      .filter({ has: page.getByText(existing.displayName, { exact: true }) })
      .getByRole('button')
      .first()
      .click({ timeout: timeoutMs })
    await page.getByRole('heading', { name: existing.displayName, exact: true }).last().waitFor({ state: 'visible', timeout: timeoutMs })
    return existing.displayName
  }
  await accounts.getByRole('button', { name: 'Add account', exact: true }).click({ timeout: timeoutMs })
  await page.getByRole('menuitem', { name: 'Command Code account', exact: true }).click({ timeout: timeoutMs })
  const accountHeading = page.getByRole('heading', { name: /^Command Code \d+$/u }).last()
  await accountHeading.waitFor({ state: 'visible', timeout: timeoutMs })
  const accountName = (await accountHeading.innerText()).trim()
  const routeSlug = page.getByRole('textbox', { name: 'Route slug', exact: true }).last()
  await routeSlug.fill(FAKE_PROVIDER_ROUTE_SLUG, { timeout: timeoutMs })
  await routeSlug.blur()
  // The store holds the new slug before the panel applies the answer, and applying it rebuilds the draft from the store.
  await page
    .getByRole('status')
    .filter({ hasText: `Renamed to ${FAKE_PROVIDER_ROUTE_SLUG}.` })
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
  return accountName
}

/**
 * Point a Command Code account at a loopback fake provider (ai-accounts) and start a New thread whose model is that
 * account's, so a seed can drive one deterministic turn through the real provider path. Safe to rerun against the same
 * instance: it finds the account a failed run left behind and finishes its configuration.
 */
const configureFakeProviderThread = async (input: {
  readonly state: ScratchState
  readonly page: Page
  readonly seed: string
  readonly timeoutMs: number
  readonly apiKey?: string
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
  await openAIAccountsPanel(page, timeoutMs)
  const accountName = await openFakeProviderAccount({ state, page, timeoutMs })
  const keyVariable = page.getByRole('textbox', { name: 'API KEY reference name', exact: true }).last()
  const baseUrl = page.getByRole('textbox', { name: 'API base URL', exact: true }).last()
  const deadline = Date.now() + timeoutMs
  // A re-read of the store can still replace the draft under the fields; the edit is typed again until it is saved.
  for (;;) {
    await keyVariable.fill(FAKE_PROVIDER_KEY_REF, { timeout: timeoutMs })
    await baseUrl.fill(fake.baseUrl, { timeout: timeoutMs })
    await baseUrl.blur()
    const saved = await waitForFakeProviderAccount({
      home: state.home,
      timeoutMs: Math.min(5_000, Math.max(0, deadline - Date.now())),
      expected: `key name ${FAKE_PROVIDER_KEY_REF} and base URL ${fake.baseUrl}`,
      matches: account => account?.apiKeyEnv === FAKE_PROVIDER_KEY_REF && account.apiBaseUrl === fake.baseUrl,
    }).then(
      () => true,
      (error: unknown) => {
        if (Date.now() > deadline) throw error
        return false
      },
    )
    if (saved) break
  }
  await page
    .getByRole('button', { name: /^(?:Set up key…|Replace or import key…)$/u })
    .last()
    .click({ timeout: timeoutMs })
  const keyDialog = page.getByRole('dialog', { name: `Configure ${accountName} key`, exact: true })
  await keyDialog.getByRole('textbox', { name: 'API key value', exact: true }).fill(input.apiKey ?? 'dshx-dev-fake-key', { timeout: timeoutMs })
  await keyDialog.getByRole('button', { name: /^(?:Store key|Replace key)$/u }).click({ timeout: timeoutMs })
  await keyDialog.waitFor({ state: 'hidden', timeout: timeoutMs })
  await page.keyboard.press('Escape')

  await openSeedThreadComposer(page, timeoutMs)
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
  await chooseFakeProviderModel({ page, timeoutMs, modelId: `${FAKE_PROVIDER_ROUTE_SLUG}/${FAKE_COMMAND_CODE_MODEL_ID}` })
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

const seedQueuePreviewThread = async (state: ScratchState, page: Page, timeoutMs: number): Promise<NonNullable<ScratchState['fakeProvider']>> => {
  const process = await configureFakeProviderThread({ state, page, seed: 'queue-preview-thread', timeoutMs })
  await sendFakeProviderTurn(page, '[[title Queue source]] [[hold]]', timeoutMs)
  await page.getByText('Queue source', { exact: true }).first().waitFor({ state: 'visible', timeout: timeoutMs })
  const composer = page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
  await composer.fill('first queued, with an image and a file', { timeout: timeoutMs })
  await page
    .locator('[data-composer-card] input[type="file"]')
    .first()
    .setInputFiles([
      join(DSHFILES_ROOT, 'tooling/dshx/e2e/fixtures/attachments/red.png'),
      join(DSHFILES_ROOT, 'tooling/dshx/e2e/fixtures/attachments/note.txt'),
    ])
  await page.getByRole('button', { name: 'Remove image red.png', exact: true }).waitFor({ state: 'visible', timeout: timeoutMs })
  await page.getByRole('button', { name: 'Remove file note.txt', exact: true }).waitFor({ state: 'visible', timeout: timeoutMs })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await composer.press('Enter', { timeout: timeoutMs })
    if ((await composer.textContent())?.trim() === '') break
    if (Date.now() > deadline) throw new ScratchError('seed-failed', 'The queue preview message did not submit.', 'Check the scratch composer upload state.')
    await page.waitForTimeout(250)
  }
  await page.getByRole('group', { name: '2 attachments', exact: true }).waitFor({ state: 'visible', timeout: timeoutMs })
  return process
}

const seedJevSetupChatThread = async (state: ScratchState, page: Page, timeoutMs: number): Promise<NonNullable<ScratchState['fakeProvider']>> => {
  const process = await configureFakeProviderThread({ state, page, seed: 'jev-setup-chat-thread', timeoutMs })
  await sendFakeProviderTurn(page, JEV_SETUP_CHAT_PROMPT, timeoutMs)
  await page.getByText('Answered by', { exact: false }).last().waitFor({ state: 'visible', timeout: timeoutMs })
  return process
}

/** Seed a model-selected thread whose loopback provider rejects the key, so the next turn fails. */
const seedQuotaBlockedThread = async (state: ScratchState, page: Page, timeoutMs: number): Promise<NonNullable<ScratchState['fakeProvider']>> => {
  const process = await configureFakeProviderThread({
    state,
    page,
    seed: 'quota-blocked-thread',
    timeoutMs,
    apiKey: 'dshx-dev-fake-key-EXHAUSTED',
  })
  await sendFakeProviderTurn(page, 'Recover this turn on another available route.', timeoutMs)
  await page.getByText("Your current account's usage limit is exhausted", { exact: false }).waitFor({ state: 'visible', timeout: timeoutMs })
  return process
}

const seedCredentialRecovery = (state: ScratchState, page: Page, timeoutMs: number): Promise<NonNullable<ScratchState['fakeProvider']>> =>
  configureFakeProviderThread({ state, page, seed: 'credential-recovery', timeoutMs, apiKey: 'dshx-dev-fake-MISSING' })

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
export const installFakeSecretCli = async (input: { readonly home: string; readonly project: string }): Promise<string> => {
  const bin = join(input.home, 'fake-secret-cli')
  await mkdir(bin, { recursive: true })
  await copyFile(FAKE_SECRET_CLI, join(bin, 'secret'))
  await chmod(join(bin, 'secret'), 0o755)
  await writeFile(join(bin, 'store.json'), fakeSecretStore(input.project), { mode: 0o600 })
  return bin
}

const CHAT_REFERENCE_PROMPT = '[[answer Trunk is `jj:main` here]]'
const CHAT_REFERENCE_LINK = 'Jujutsu bookmark: Sample project (main)'

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

const seedBacklogJevReadyForSetup = async (state: ScratchState, page: Page, timeoutMs: number): Promise<void> => {
  if (!state.bundles.includes('@dshfiles/backlog')) {
    throw new ScratchError(
      'seed-needs-plugin',
      'Seed backlog-jev-enabled needs @dshfiles/backlog.',
      'Run "dshx dev down" then "dshx dev up --plugin @dshfiles/backlog ...".',
    )
  }
  const enabled = page.getByRole('switch', { name: 'Jev enabled', exact: true })
  if (!(await enabled.isVisible())) {
    await page
      .getByRole('navigation', { name: 'Global panels', exact: true })
      .getByRole('button', { name: 'Plugins', exact: true })
      .click({ timeout: timeoutMs })
    await page.getByRole('button', { name: 'View @dshfiles/backlog', exact: true }).click({ timeout: timeoutMs })
    await enabled.waitFor({ state: 'visible', timeout: timeoutMs })
  }
  if (!(await enabled.isChecked())) await enabled.click({ timeout: timeoutMs })
  const autoTriage = page.getByRole('switch', { name: 'Auto triage', exact: true })
  if (await autoTriage.isChecked()) await autoTriage.click({ timeout: timeoutMs })
  await page.waitForFunction(
    () =>
      document.querySelector('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="jevEnabled"] [role="switch"]')?.getAttribute('aria-checked') ===
        'true' &&
      document.querySelector('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="autoTriage"] [role="switch"]')?.getAttribute('aria-checked') ===
        'false',
    undefined,
    { timeout: timeoutMs },
  )
}

const seedMultiHostHosts = async (state: ScratchState): Promise<void> => {
  if (!state.bundles.includes('@dshfiles/multi-host')) {
    throw new ScratchError(
      'seed-needs-plugin',
      'Seed multi-host-hosts needs @dshfiles/multi-host.',
      'Run "dshx dev down" then "dshx dev up --plugin @dshfiles/multi-host ...".',
    )
  }
  const createdAt = '2026-10-05T00:00:00.000Z'
  const launchUrl = 'http://127.0.0.1:1/?token=dshx-seed-token'
  const directory = {
    schemaVersion: 2,
    hosts: [
      { schemaVersion: 2, id: 'studio', name: 'Studio', connector: { kind: 'local' }, hidden: false, position: 0, createdAt },
      { schemaVersion: 2, id: 'laptop', name: 'Laptop', connector: { kind: 'local' }, hidden: true, position: 1, createdAt },
      {
        schemaVersion: 2,
        id: 'build-box',
        name: 'Build box',
        connector: { kind: 'ssh', sshTarget: 'build@192.0.2.10' },
        hidden: false,
        position: 2,
        createdAt,
      },
    ],
    runtimes: [
      {
        schemaVersion: 2,
        id: '10000000-0000-4000-8000-000000000001',
        hostId: 'studio',
        name: 'Studio',
        locator: { kind: 'local', launchUrl },
        identity: null,
        originPort: 41_001,
        createdAt,
      },
      {
        schemaVersion: 2,
        id: '10000000-0000-4000-8000-000000000002',
        hostId: 'laptop',
        name: 'Laptop',
        locator: { kind: 'local', launchUrl },
        identity: null,
        originPort: 41_002,
        createdAt,
      },
      {
        schemaVersion: 2,
        id: '10000000-0000-4000-8000-000000000003',
        hostId: 'build-box',
        name: 'Build box',
        locator: { kind: 'ssh', remoteHome: '/home/build/.dsh' },
        identity: null,
        originPort: 41_003,
        createdAt,
      },
    ],
    retiredPorts: [],
  }
  const path = join(state.home, 'plugins', 'multi-host', 'directory.json')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(directory, null, 2)}\n`, { mode: 0o600 })
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
  if (input.seed === 'backlog-jev-enabled') {
    await seedBacklogJevReadyForSetup(input.state, input.page, input.timeoutMs)
    return {}
  }
  if (input.seed === 'multi-host-hosts') {
    await seedMultiHostHosts(input.state)
    return {}
  }
  if (input.seed === 'quota-blocked-thread') return { fakeProvider: await seedQuotaBlockedThread(input.state, input.page, input.timeoutMs) }
  if (input.seed === 'credential-recovery') return { fakeProvider: await seedCredentialRecovery(input.state, input.page, input.timeoutMs) }
  if (input.seed === 'tool-call-thread') return { fakeProvider: await seedToolCallThread(input.state, input.page, input.timeoutMs) }
  if (input.seed === 'queue-preview-thread') return { fakeProvider: await seedQueuePreviewThread(input.state, input.page, input.timeoutMs) }
  if (input.seed === 'jev-setup-chat-thread') return { fakeProvider: await seedJevSetupChatThread(input.state, input.page, input.timeoutMs) }
  if (input.seed === 'chat-reference-thread') return { fakeProvider: await seedChatReferenceThread(input.state, input.page, input.timeoutMs) }
  await seedRebaseReadyThread(input.state, input.page, input.timeoutMs)
  return {}
}

export class ScratchSeedRuntime {
  static readonly sampleProject = seedSampleProject
  static readonly restorePendingRestart = restorePendingRestart
  static readonly installFakeSecretCli = installFakeSecretCli
  static readonly openAIAccountsPanel = openAIAccountsPanel
  static readonly openSeedThreadComposer = openSeedThreadComposer
  static readonly chooseFakeProviderModel = chooseFakeProviderModel
  static readonly seedBacklogJevEnabled = seedBacklogJevEnabled
  static readonly applySeed = applySeed
  static readonly startFakeProvider = startFakeProvider
}
