import { expect, type Page } from '@playwright/test'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:https'
import { chmod, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as Schema from 'effect/Schema'
import { After, Given, Then, When } from '../bdd.js'
import { bootComposedPluginProfile, type BootedProfile } from '../boot.js'
import { startMutationResponseProxy } from '../mutation-response-proxy.mjs'
import { reserveLoopbackPort, startLoopbackSshd } from '../loopback-sshd.mjs'
import { allowLoopbackBrowserOrigin, finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { DSHFILES_ROOT } from '../../../packages/dshx/src/project/local-bundles.js'
import { withUnknownProperties } from '../../../packages/dshx/src/schema.js'
import { RuntimeLaunchFile } from '../../../../../plugins/@dshfiles/multi-host/src/launch-file.js'

const { launchFilePaths, parseRuntimeLaunch } = RuntimeLaunchFile
import { mergeInventory } from '../../../../../plugins/@dshfiles/multi-host/src/inventory.js'
import { fakeCommandCodeFor, startFakeCommandCode } from '../fake-command-code.js'
import { seedPresetRow } from './agent-questions-timed.steps.js'
import { openGlobalPanel } from '../plugin-view-names.js'

const multiHostPackageId = '@dshfiles/multi-host'
const multiHostApiId = 'multi-host'
const scratchRemoteName = 'Scratch SSH runtime'

const positiveIntegerSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
const nonNegativeIntegerSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const nativeCreateSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: withUnknownProperties({ sessionId: Schema.String }) }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const threadCreateSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), sessionId: Schema.String }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String, sessionId: Schema.optional(Schema.String) }),
])

const nativeSessionListSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: withUnknownProperties({ items: Schema.Array(withUnknownProperties({ sessionId: Schema.String, blank: Schema.Boolean })) }),
  }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const runtimePingSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), ms: nonNegativeIntegerSchema }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const runtimeReconnectSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const connectionTestSchema = Schema.Union([
  withUnknownProperties({ ok: Schema.Literal(true) }),
  withUnknownProperties({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const transcriptSchema = Schema.Union([
  withUnknownProperties({
    ok: Schema.Literal(true),
    cwd: Schema.String,
    entries: Schema.Array(
      withUnknownProperties({
        seq: Schema.Number.check(Schema.isInt()),
        kind: Schema.Literals(['user', 'assistant', 'tool', 'status']),
        text: Schema.String,
      }),
    ),
  }),
  withUnknownProperties({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const sessionRuntimeSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), runtimeId: Schema.NullOr(Schema.String) }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const fileReferencesSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    candidates: Schema.Array(Schema.Struct({ path: Schema.String, kind: Schema.Literals(['file', 'directory']) })),
  }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const fileUploadSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({
      receiptId: Schema.String.check(Schema.isMinLength(1)),
      file: Schema.Struct({
        attachmentId: Schema.String.check(Schema.isMinLength(1)),
        name: Schema.String,
        bytes: nonNegativeIntegerSchema,
      }),
    }),
  }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const runtimeDirectorySchema = Schema.Struct({
  hosts: Schema.Array(withUnknownProperties({ id: Schema.String, name: Schema.String })),
  runtimes: Schema.Array(
    withUnknownProperties({ id: Schema.String, hostId: Schema.String, name: Schema.String, remoteHome: Schema.String, connected: Schema.Boolean }),
  ),
})

const runtimeOpenViewSchema = Schema.Struct({
  leaseId: Schema.String.check(Schema.isUUID()),
  launchUrl: Schema.String.check(Schema.makeFilter(value => URL.canParse(value))),
})

const promptAcceptedSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: withUnknownProperties({ accepted: Schema.Literal(true) }) }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const inventoryStatusSchema = Schema.Union([
  withUnknownProperties({
    ok: Schema.Literal(true),
    runtime: withUnknownProperties({ hostId: Schema.String, name: Schema.String }),
    sessions: Schema.Array(
      withUnknownProperties({
        sessionId: Schema.String,
        blank: Schema.Boolean,
        running: Schema.Boolean,
        cwd: Schema.optional(Schema.String),
      }),
    ),
  }),
  withUnknownProperties({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
])

const remoteThreadListSchema = Schema.Struct({
  threads: Schema.Array(withUnknownProperties({ runtimeId: Schema.String, sessionId: Schema.String, mention: Schema.optional(Schema.String) })),
})

type InventoryObservation = {
  readonly runtimeId: string
  readonly sessionId: string
  readonly startedHere: boolean
  readonly hostName: string
}

const inventoryObservations = new WeakMap<Page, InventoryObservation>()

type MultiHostScratchPair = {
  readonly sshd: Awaited<ReturnType<typeof startLoopbackSshd>>
  readonly remote: BootedProfile
  readonly manager: BootedProfile
  readonly wrapperInvocationLogPath: string
  readonly tunnelProcessLogPath: string
}

const pairs = new WeakMap<Page, MultiHostScratchPair>()

const pairFor = (page: Page): MultiHostScratchPair => {
  const pair = pairs.get(page)
  if (pair === undefined) throw new Error('The loopback second-DSH fixture was not initialized.')
  return pair
}
type JourneyObservation = {
  readonly runtimeId: string
  readonly remoteHome: string
  readonly sessionId: string
  readonly transcriptCwd: string
  readonly tunnelReconnected?: boolean
  readonly staleLaunchRejected?: boolean
  readonly profileSyncFailureCleaned?: boolean
  readonly mutationReconciled?: boolean
  readonly remoteReadyAfterMutation?: boolean
  readonly remoteCrashCleaned?: boolean
}

const observations = new WeakMap<Page, JourneyObservation>()

type AutoDestinationObservation = {
  readonly runtimeId: string
  readonly folderPath: string
  readonly previousSessionIds: readonly string[]
  readonly sessionId: string
  readonly prompt?: string
}

const autoDestinationObservations = new WeakMap<Page, AutoDestinationObservation>()

const updateObservation = (page: Page, update: Partial<JourneyObservation>): void => {
  const previous = observations.get(page)
  if (previous === undefined) throw new Error('The remote thread journey did not produce an observation.')
  observations.set(page, { ...previous, ...update })
}

const tunnelProcessRecordSchema = Schema.Struct({ marker: Schema.Literal('persistent-forward'), processId: positiveIntegerSchema })
const tunnelProcessRecordsSchema = Schema.Array(tunnelProcessRecordSchema)
const processDetailsSchema = Schema.Struct({
  parentProcessId: positiveIntegerSchema,
  processGroupId: positiveIntegerSchema,
  commandName: Schema.String.check(Schema.isMinLength(1)),
})

const readTunnelProcessRecords = async (path: string) => {
  const log = (await readFile(path, 'utf8')).trim()
  if (log === '') return []
  return Schema.decodeUnknownSync(tunnelProcessRecordsSchema)(
    log.split(/\r?\n/).map(line => {
      const [marker, processId] = line.split(' ')
      return { marker, processId: Number(processId) }
    }),
  )
}

/**
 * Effect's ChildProcessSpawner starts each child as its own process-group leader, so the SSH forward multi-host spawns
 * leads its own group; an older spawner left it in the manager's. Ownership is the parent pid either way.
 */
const ownsProcessGroup = (processGroupId: number, input: { readonly processId: number; readonly managerProcessId: number }): boolean =>
  processGroupId === input.managerProcessId || processGroupId === input.processId

const readProcessDetails = (processId: number) => {
  const result = spawnSync('ps', ['-o', 'ppid=', '-o', 'pgid=', '-o', 'comm=', '-p', String(processId)], { encoding: 'utf8', timeout: 5_000 })
  if (result.error !== undefined || result.status !== 0) throw new Error('Could not inspect the scratch tunnel process.')
  const [parentProcessId, processGroupId, ...commandName] = result.stdout.trim().split(/\s+/)
  if (parentProcessId === undefined || processGroupId === undefined || commandName.length === 0) {
    throw new Error('The scratch tunnel process is no longer listed.')
  }
  return Schema.decodeUnknownSync(processDetailsSchema)({
    parentProcessId: Number(parentProcessId),
    processGroupId: Number(processGroupId),
    commandName: basename(commandName.join(' ')),
  })
}

/** A scratch Host runs under its parent-death guard, and `host.pid` is the guard's, so its children sit one level below. */
const isChildOfGuardedHost = (parentProcessId: number, guardProcessId: number): boolean =>
  parentProcessId === guardProcessId || readProcessDetails(parentProcessId).parentProcessId === guardProcessId

const isProcessRunning = (processId: number): boolean => {
  try {
    process.kill(processId, 0)
    return true
  } catch {
    return false
  }
}

const hostApi = async (profile: BootedProfile) => connectDshxApi({ url: profile.url, packageId: multiHostPackageId, apiId: multiHostApiId, version: 1 })

const runScratchGit = (input: { readonly args: readonly string[]; readonly cwd: string }): void => {
  const result = spawnSync('git', [...input.args], {
    cwd: input.cwd,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`The scratch Git repository could not be prepared: ${result.error?.message ?? result.stderr.trim()}`)
  }
}

const startScratchGitServer = async (input: { readonly projectPath: string; readonly scratchRoot: string }) => {
  const repositoryPath = join(input.scratchRoot, 'source-project.git')
  runScratchGit({ args: ['clone', '--bare', input.projectPath, repositoryPath], cwd: input.scratchRoot })
  const keyPath = join(input.scratchRoot, 'git-server.key')
  const certificatePath = join(input.scratchRoot, 'git-server.crt')
  const certificateResult = spawnSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-days', '1', '-subj', '/CN=127.0.0.1'],
    { cwd: input.scratchRoot, encoding: 'utf8', timeout: 10_000 },
  )
  if (certificateResult.error !== undefined || certificateResult.status !== 0) {
    throw new Error(`The scratch Git HTTPS certificate could not be created: ${certificateResult.error?.message ?? certificateResult.stderr.trim()}`)
  }

  const [key, certificate] = await Promise.all([readFile(keyPath), readFile(certificatePath)])
  let serverPort = 0
  const server = createServer({ key, cert: certificate }, (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'https://127.0.0.1')
    if (!requestUrl.pathname.startsWith('/source-project.git/')) {
      response.writeHead(404).end()
      return
    }
    const requestChunks: Buffer[] = []
    request.on('data', chunk => requestChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on('end', () => {
      const requestBody = Buffer.concat(requestChunks)
      const result = spawnSync('git', ['http-backend'], {
        cwd: input.scratchRoot,
        input: requestBody,
        timeout: 15_000,
        maxBuffer: 8_000_000,
        env: {
          ...process.env,
          CONTENT_LENGTH: request.headers['content-length'] ?? String(requestBody.byteLength),
          CONTENT_TYPE: request.headers['content-type'] ?? '',
          GATEWAY_INTERFACE: 'CGI/1.1',
          GIT_HTTP_EXPORT_ALL: '1',
          GIT_PROJECT_ROOT: input.scratchRoot,
          HTTP_HOST: request.headers.host ?? '127.0.0.1',
          PATH_INFO: requestUrl.pathname,
          QUERY_STRING: requestUrl.search.slice(1),
          REMOTE_ADDR: '127.0.0.1',
          REQUEST_METHOD: request.method ?? 'GET',
          SERVER_NAME: '127.0.0.1',
          SERVER_PORT: String(serverPort),
          SERVER_PROTOCOL: 'HTTP/1.1',
        },
      })
      if (result.error !== undefined || result.status !== 0) {
        response.writeHead(502, { 'Content-Type': 'text/plain' })
        response.end(result.error?.message ?? (result.stderr.toString('utf8').trim() || 'Git HTTP backend failed.'))
        return
      }
      const crlfSeparator = Buffer.from('\r\n\r\n')
      const lfSeparator = Buffer.from('\n\n')
      const crlfOffset = result.stdout.indexOf(crlfSeparator)
      const separatorOffset = crlfOffset === -1 ? result.stdout.indexOf(lfSeparator) : crlfOffset
      const separatorLength = crlfOffset === -1 ? 2 : 4
      if (separatorOffset === -1) {
        response.writeHead(502, { 'Content-Type': 'text/plain' })
        response.end('Git HTTP backend returned an invalid response.')
        return
      }
      let statusCode = 200
      const responseHeaders: Record<string, string> = {}
      for (const line of result.stdout.subarray(0, separatorOffset).toString('utf8').split(/\r?\n/u)) {
        const colonOffset = line.indexOf(':')
        if (colonOffset === -1) continue
        const name = line.slice(0, colonOffset).trim()
        const value = line.slice(colonOffset + 1).trim()
        if (name.toLowerCase() === 'status') statusCode = Number.parseInt(value, 10)
        else responseHeaders[name] = value
      }
      response.writeHead(statusCode, responseHeaders)
      response.end(result.stdout.subarray(separatorOffset + separatorLength))
    })
  })
  await new Promise<void>((resolveServer, rejectServer) => {
    server.once('error', rejectServer)
    server.listen(0, '127.0.0.1', resolveServer)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolveServer, rejectServer) => server.close(error => (error === undefined ? resolveServer() : rejectServer(error))))
    throw new Error('The scratch Git HTTPS server did not bind to a TCP port.')
  }
  serverPort = address.port
  return {
    repositoryUrl: `https://127.0.0.1:${serverPort}/source-project.git`,
    close: async (): Promise<void> =>
      await new Promise<void>((resolveServer, rejectServer) => server.close(error => (error === undefined ? resolveServer() : rejectServer(error)))),
  }
}

const bootLoopbackPair = async (
  page: Page,
  remote_: { readonly cordisPatch?: string; readonly packageIds?: readonly string[]; readonly managerPackageIds?: readonly string[] } = {},
): Promise<void> => {
  const fakeCommandCode = await startFakeCommandCode(page)
  const sshd = await startLoopbackSshd({ gitSslNoVerify: true })
  let remote: BootedProfile | undefined
  let manager: BootedProfile | undefined
  try {
    remote = await bootComposedPluginProfile({
      packageIds: ['@dshfiles/multi-host', '@dshfiles/ai-accounts', ...(remote_.packageIds ?? [])],
      profileLabel: 'multi-host-remote',
      ...(remote_.cordisPatch !== undefined && { cordisPatch: remote_.cordisPatch }),
      hostEnv: { DSH_E2E_REMOTE_API_KEY: 'e2e-fake-key-ALPHA1' },
      seedHome: async homeRoot => {
        const accountsPath = join(homeRoot, 'plugins', 'ai-accounts', 'accounts.json')
        await mkdir(dirname(accountsPath), { recursive: true })
        await writeFile(
          accountsPath,
          `${JSON.stringify(
            {
              distribution: 'sticky',
              cooldownMs: 300_000,
              shadowRoot: '',
              accounts: [
                {
                  instanceId: 'commandcode_work',
                  kind: 'commandcode',
                  displayName: 'Command Code 1',
                  enabled: true,
                  homePath: '',
                  shadowHomePath: '',
                  apiKeyEnv: 'DSH_E2E_REMOTE_API_KEY',
                  apiBaseUrl: fakeCommandCode.baseUrl,
                  badge: '',
                  accentColor: '',
                  providerIcon: '',
                  additionalModelIds: [],
                },
              ],
            },
            null,
            2,
          )}\n`,
        )
      },
    })
    let wrapperInvocationLogPath: string | undefined
    let tunnelProcessLogPath: string | undefined
    manager = await bootComposedPluginProfile({
      packageIds: [
        '@dshfiles/multi-host',
        '@dshfiles/mentions',
        '@dshfiles/thread-sidebar',
        '@dshfiles/jj-integration',
        '@dshfiles/rich-composer',
        '@dshfiles/session-controller',
        '@dshfiles/model-effort-picker',
        '@dshfiles/user-questions',
        '@dshfiles/sidebar-right',
        ...(remote_.managerPackageIds ?? []),
      ],
      profileLabel: 'multi-host-manager',
      seedHome: async homeRoot => {
        const seeded = await sshd.seedClientHome(homeRoot)
        wrapperInvocationLogPath = seeded.wrapperInvocationLogPath
        tunnelProcessLogPath = seeded.tunnelProcessLogPath
        return { hostPathPrefix: seeded.hostPathPrefix }
      },
    })
    if (wrapperInvocationLogPath === undefined || tunnelProcessLogPath === undefined) {
      throw new Error('The scratch SSH wrapper was not seeded for the manager DSH.')
    }
    pairs.set(page, { sshd, remote, manager, wrapperInvocationLogPath, tunnelProcessLogPath })
    await visitIsolatedPluginProfile(page, manager)
  } catch (error) {
    try {
      await manager?.close()
    } finally {
      try {
        await remote?.close()
      } finally {
        await sshd.close()
      }
    }
    throw error
  }
}

Given('a loopback SSH DSH pair is booted', async ({ page }: { readonly page: Page }) => {
  await bootLoopbackPair(page)
})

Given('a loopback SSH DSH pair with timed questions is booted', async ({ page }: { readonly page: Page }) => {
  await bootLoopbackPair(page, { cordisPatch: await seedPresetRow(), packageIds: ['@dshfiles/tool-ask-user'] })
})

Given('a loopback SSH DSH pair with JJ on the remote is booted', async ({ page }: { readonly page: Page }) => {
  await bootLoopbackPair(page, { packageIds: ['@dshfiles/jj-integration', '@dshfiles/jujutsu'], managerPackageIds: ['@dshfiles/jujutsu'] })
})

When('the scratch remote is added from the host UI', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  // Hosts is a section of the Observe rail destination now, not a top-level sidebar button.
  await openGlobalPanel(page, 'Multi-host: Hosts')
  await expect(page.getByTestId('dshfiles-hosts-page')).toBeVisible()
  await page.getByRole('button', { name: 'Add host', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add host', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'SSH destination', exact: true }).click()
  await page.getByRole('option', { name: 'Enter a custom destination…', exact: true }).click()
  await dialog.getByLabel('Custom SSH destination').fill('scratch@custom.invalid')
  await dialog.getByRole('button', { name: 'SSH destination', exact: true }).click()
  await page.getByRole('option', { name: pair.sshd.targetAlias, exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'SSH destination', exact: true })).toContainText(pair.sshd.targetAlias)
  await dialog.getByLabel('Name').fill(scratchRemoteName)
  await dialog.getByLabel('Remote DSH home').fill(pair.remote.homeRoot)
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
  const connectionTest = dialog.getByRole('list', { name: 'Connection test' })
  await expect(connectionTest).toBeVisible({ timeout: 30_000 })
  await expect(connectionTest).toContainText('SSH login')
  await expect(connectionTest).toContainText('DSH runtime')
  await expect(connectionTest).toContainText('multi-host identity')
  await dialog.getByRole('button', { name: 'Add host', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText(scratchRemoteName, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  const wrapperCalls = (await readFile(pair.wrapperInvocationLogPath, 'utf8')).trim().split(/\r?\n/)
  expect(wrapperCalls).toContain('invoked')
})

When('Auto creates a thread through the remote folder picker', async ({ page }: { readonly page: Page }) => {
  let threadCreateRequests = 0
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/threadCreate')) threadCreateRequests += 1
  })
  const pair = pairFor(page)
  const call = await hostApi(pair.manager)
  const directory = Schema.decodeUnknownSync(runtimeDirectorySchema)(await call('list'))
  const host = directory.hosts.find(item => item.name === scratchRemoteName)
  if (host === undefined) throw new Error('The saved scratch SSH host was not listed by the manager DSH.')
  const runtime = directory.runtimes.find(item => item.hostId === host.id)
  if (runtime === undefined) throw new Error('The scratch SSH host did not register a remote DSH runtime.')
  const previousSessionIds = Schema.decodeUnknownSync(remoteThreadListSchema)(await call('threadList')).threads.map(thread => thread.sessionId)
  const folderPath = join(pair.remote.homeRoot, 'projects', `auto-${randomUUID()}`)
  await mkdir(folderPath, { recursive: true })
  const canonicalFolderPath = await realpath(folderPath)

  const initialFolderPicker = page.getByRole('dialog', { name: /^Choose a project/u })
  if ((await initialFolderPicker.count()) > 0) {
    await page.keyboard.press('Escape')
    await expect(initialFolderPicker).toBeHidden()
  }
  await page.getByRole('button', { name: /^Run on /u }).click()
  const autoOption = page.getByRole('option', { name: /^Auto/u })
  await expect(autoOption).toContainText(scratchRemoteName, { timeout: 30_000 })
  await expect(autoOption).toBeEnabled({ timeout: 30_000 })
  await autoOption.click()
  await page.locator('[data-remote-folder]').click()

  const folderPicker = page.getByRole('dialog', { name: /^Choose a project/u })
  const pathInput = folderPicker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true })
  await pathInput.fill(folderPath)
  await pathInput.press('Enter')
  await expect(folderPicker.locator('p').filter({ hasText: folderPath }).first()).toBeVisible({ timeout: 30_000 })
  await folderPicker.getByRole('button', { name: 'Select this folder', exact: true }).click()
  await expect(folderPicker).toBeHidden()
  expect(threadCreateRequests).toBe(1)
  let remoteSessionId: string | undefined
  await expect
    .poll(
      async () => {
        remoteSessionId = Schema.decodeUnknownSync(remoteThreadListSchema)(await call('threadList')).threads.find(
          thread => !previousSessionIds.includes(thread.sessionId),
        )?.sessionId
        return remoteSessionId
      },
      { timeout: 30_000 },
    )
    .toBeDefined()
  if (remoteSessionId === undefined) throw new Error('The manager did not list the new remote Session.')
  const conversation = page.locator('[data-conversation-content]')
  await expect.poll(() => conversation.getAttribute('data-conversation-session')).toBe(remoteSessionId)
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await expect(composer).toBeVisible({ timeout: 30_000 })
  await expect(composer).toBeEnabled()

  autoDestinationObservations.set(page, { runtimeId: runtime.id, folderPath: canonicalFolderPath, previousSessionIds, sessionId: remoteSessionId })
})

When('the remote model picker selects its model', async ({ page }: { readonly page: Page }) => {
  const observation = autoDestinationObservations.get(page)
  if (observation === undefined) throw new Error('The Auto destination journey did not create a remote thread.')
  const picker = page.getByRole('button', { name: /deepseek-flash, reasoning Default/u })
  await expect(picker).toBeVisible()
  await picker.click()
  // The picker lists one row per model and account; its Use button names both.
  const models = page.getByRole('list', { name: 'Models and accounts', exact: true })
  await expect(models).toBeVisible()
  const model = models.getByRole('button', { name: 'Use gpt-6-luna (Command Code 1)', exact: true })
  await expect(model).toBeVisible()
  await model.click()
  await expect(page.locator('[data-model-picker-text]')).toHaveText('gpt-6-luna')
})

const pickedAttachments = new WeakMap<Page, { readonly name: string; readonly content: string }>()

/** Paths under a scratch DSH home whose bytes equal `content`; installed packages are skipped. */
const filesWithContent = async (root: string, content: string): Promise<string[]> => {
  const matches: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && (await stat(path)).size === Buffer.byteLength(content) && (await readFile(path, 'utf8')) === content) matches.push(path)
    }
  }
  await walk(root)
  return matches
}

When('the native composer attaches a file through its picker', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const name = `remote-picker-${randomUUID()}.txt`
  const content = `Picked in the browser for the remote Session: ${randomUUID()}\n`
  const localPath = join(pair.sshd.scratchRoot, name)
  await writeFile(localPath, content)
  // The composer's own file input, as its attach button opens it; the upload must reach the runtime that owns the Session.
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles(localPath)
  await expect(page.locator('[data-composer-card]').getByText(name)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-composer-card]').getByText('Uploading…')).toHaveCount(0, { timeout: 30_000 })
  pickedAttachments.set(page, { name, content })
})

Then('the picked file is stored by the owning remote host only', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const picked = pickedAttachments.get(page)
  if (picked === undefined) throw new Error('No file was attached through the composer picker.')
  await recordAssertion(page, 'multi-host-picker-upload-stays-on-owning-host', async () => {
    await expect.poll(async () => (await filesWithContent(pair.remote.homeRoot, picked.content)).length, { timeout: 30_000 }).toBeGreaterThan(0)
    expect(await filesWithContent(pair.manager.homeRoot, picked.content)).toEqual([])
  })
})

When('the native composer sends a prompt to the remote Session', async ({ page }: { readonly page: Page }) => {
  const observation = autoDestinationObservations.get(page)
  if (observation === undefined) throw new Error('The Auto destination journey did not create a remote thread.')
  const prompt = `remote-composer-${randomUUID()}`
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: 'Send message', exact: true })
  await expect(send).toBeEnabled()
  await send.click()
  autoDestinationObservations.set(page, { ...observation, prompt })
})

const REMOTE_QUESTION = 'Which environment should the remote fixture deploy to?'
const remoteQuestionCard = (page: Page) => page.locator('[data-question-key]').filter({ hasText: REMOTE_QUESTION })
const remoteComposer = (page: Page) => page.getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/u })

const askOnRemote = async (page: Page, timeout?: number): Promise<void> => {
  const directive = `[[title Remote question fixture]] [[once call ask_user_question ${JSON.stringify({
    questions: [{ id: 'deploy-target', header: 'Deploy', question: REMOTE_QUESTION, options: [{ label: 'Staging' }, { label: 'Production' }] }],
    ...(timeout !== undefined && { timeout }),
  })}]]`
  await remoteComposer(page).fill(directive)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
}

When('the remote agent asks a question', async ({ page }: { readonly page: Page }) => {
  await askOnRemote(page)
})

When('the remote agent asks a timed question lasting {int} seconds', async ({ page }: { readonly page: Page }, seconds: number) => {
  await askOnRemote(page, seconds)
})

Then('the remote question opens in the controlling chat', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-question-card', async () => {
    await expect(remoteQuestionCard(page)).toBeVisible({ timeout: 45_000 })
    await expect(remoteQuestionCard(page).getByRole('radio', { name: 'Production', exact: true })).toBeVisible()
  })
})

Then('the remote question counts down with what its owner reports', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-question-countdown', async () => {
    await expect(remoteQuestionCard(page).locator('header span').filter({ hasText: /^Continuing in \d+s$/u })).toBeVisible({ timeout: 15_000 })
  })
})

Then('the remote question stays answerable after its wait ends', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-question-continued', async () => {
    await expect(remoteQuestionCard(page).getByText('Work continued — you can still answer', { exact: true })).toBeVisible({ timeout: 45_000 })
  })
})

When('the remote question is answered {string} here', async ({ page }: { readonly page: Page }, option: string) => {
  const card = remoteQuestionCard(page)
  await card.getByRole('radio', { name: option, exact: true }).click()
  await card.getByRole('button', { name: 'Submit', exact: true }).click()
})

Then('the remote agent receives the answer {string}', async ({ page }: { readonly page: Page }, option: string) => {
  await recordAssertion(page, 'multi-host-remote-question-answered', async () => {
    const fake = fakeCommandCodeFor(page)
    await expect
      .poll(() => fake.requests.flatMap(request => request.messages).some(message => message.text.includes(option) && message.text.includes('deploy-target')), {
        timeout: 30_000,
      })
      .toBe(true)
    await expect(remoteQuestionCard(page)).toHaveCount(0, { timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

When('the connection to the remote drops while the question waits', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const records = await readTunnelProcessRecords(pair.tunnelProcessLogPath)
  const tunnel = records.at(-1)
  if (tunnel === undefined || tunnel.marker !== 'persistent-forward') throw new Error('The persistent SSH forward was not recorded.')
  const details = readProcessDetails(tunnel.processId)
  const manager = pair.manager.host.pid
  if (manager === undefined || details.commandName !== 'ssh' || !isChildOfGuardedHost(details.parentProcessId, manager)) {
    throw new Error('Refusing to signal a process the manager DSH does not own.')
  }
  process.kill(tunnel.processId, 'SIGKILL')
  await expect.poll(async () => (await readTunnelProcessRecords(pair.tunnelProcessLogPath)).length, { timeout: 30_000 }).toBeGreaterThan(records.length)
})

Then('the remote question is back in the controlling chat after reconnecting', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-question-reconnected', async () => {
    await expect(remoteQuestionCard(page).getByRole('radio', { name: 'Production', exact: true })).toBeVisible({ timeout: 45_000 })
  })
})

const UNOPENED_QUESTION = 'Which region should the unopened thread use?'
const UNOPENED_TITLE = 'Unopened question fixture'

When('another remote thread that is not open here asks a question', async ({ page }: { readonly page: Page }) => {
  const observation = autoDestinationObservations.get(page)
  if (observation === undefined) throw new Error('The Auto destination journey did not create a remote thread.')
  const call = await hostApi(pairFor(page).manager)
  const directive = `[[title ${UNOPENED_TITLE}]] [[once call ask_user_question ${JSON.stringify({
    questions: [{ id: 'region', header: 'Region', question: UNOPENED_QUESTION, options: [{ label: 'Paris' }, { label: 'Tokyo' }] }],
  })}]]`
  const started = Schema.decodeUnknownSync(withUnknownProperties({ ok: Schema.Boolean, message: Schema.optional(Schema.String) }))(
    await call('threadStart', { runtimeId: observation.runtimeId, cwd: observation.folderPath, text: directive, model: { provider: 'commandcode_work', model: 'gpt-6-luna' } }),
  )
  expect(started.ok, started.message).toBe(true)
})

Then('the unopened thread reports it is waiting and its question opens with it', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-unopened-thread-waiting', async () => {
    await page.getByRole('tab', { name: 'Threads', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Needs you (1)', exact: true })).toBeVisible({ timeout: 45_000 })
    await page.getByRole('button', { name: new RegExp(UNOPENED_TITLE, 'u') }).first().click()
    const card = page.locator('[data-question-key]').filter({ hasText: UNOPENED_QUESTION })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.getByRole('radio', { name: 'Tokyo', exact: true }).click()
    await card.getByRole('button', { name: 'Submit', exact: true }).click()
    const fake = fakeCommandCodeFor(page)
    await expect.poll(() => fake.requests.flatMap(request => request.messages).some(message => message.text.includes('Tokyo') && message.text.includes('region')), { timeout: 30_000 }).toBe(true)
  })
  await finishJourneyAssertions(page)
})

When('the remote question is dismissed here', async ({ page }: { readonly page: Page }) => {
  await remoteQuestionCard(page).getByRole('button', { name: 'Dismiss all questions', exact: true }).click()
})

Then('the remote agent learns the question was dismissed', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-question-dismissed', async () => {
    const fake = fakeCommandCodeFor(page)
    await expect
      .poll(() => fake.requests.flatMap(request => request.messages).some(message => message.role === 'tool' && /cancel/iu.test(message.text)), { timeout: 30_000 })
      .toBe(true)
    await expect(remoteQuestionCard(page).getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0, { timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

const runScratchJj = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync('jj', ['--config', 'user.name=Scratch', '--config', 'user.email=scratch@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
  })
  if (result.error !== undefined || result.status !== 0) throw new Error(`jj ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`)
  return result.stdout
}

const remoteForks = new WeakMap<Page, string>()
const remoteJjJourneys = new WeakMap<Page, { readonly repository: string; readonly threadPath: string; readonly sessionId: string; readonly description: string }>()
const jjCallResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  code: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Unknown),
  message: Schema.optional(Schema.String),
})

When('a thread on the remote has described work in its own JJ workspace', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const call = await hostApi(pair.manager)
  const runtimeId = Schema.decodeUnknownSync(withUnknownProperties({ runtimes: Schema.Array(Schema.Struct({ id: Schema.String })) }))(
    await call('list'),
  ).runtimes[0]?.id
  if (runtimeId === undefined) throw new Error('The scratch remote is not registered.')
  const repository = join(pair.remote.homeRoot, `jj-${randomUUID()}`)
  await mkdir(repository, { recursive: true })
  runScratchJj(repository, 'git', 'init', '--colocate')
  await writeFile(join(repository, 'README.md'), 'scratch\n')
  runScratchJj(repository, 'describe', '-m', 'Initial scratch revision')
  runScratchJj(repository, 'bookmark', 'create', 'main', '-r', '@')
  runScratchJj(repository, 'new')
  const opened = Schema.decodeUnknownSync(withUnknownProperties({ ok: Schema.Literal(true), workspaceId: Schema.String }))(
    await call('runtimeOpenFolder', { runtimeId, path: repository }),
  )
  const provisioned = Schema.decodeUnknownSync(
    withUnknownProperties({ ok: Schema.Literal(true), value: withUnknownProperties({ workspaceId: Schema.String }) }),
  )(await call('runtimePluginCall', { runtimeId, method: 'provision', input: { workspaceId: opened.workspaceId, isolate: true } }))
  // The status read answers from its cache while it refreshes, so the new workspace appears on a later read.
  let threadPath: string | undefined
  await expect
    .poll(
      async () => {
        const status = Schema.decodeUnknownSync(withUnknownProperties({ workspaces: Schema.optional(Schema.Array(withUnknownProperties({ workspaceId: Schema.String, path: Schema.String }))) }))(
          await call('runtimeStatus', { runtimeId }),
        )
        threadPath = status.workspaces?.find(workspace => workspace.workspaceId === provisioned.value.workspaceId)?.path
        return threadPath
      },
      { timeout: 30_000 },
    )
    .toBeDefined()
  if (threadPath === undefined) throw new Error('The remote did not report its thread workspace.')
  const created = Schema.decodeUnknownSync(withUnknownProperties({ ok: Schema.Literal(true), sessionId: Schema.String }))(
    await call('threadStart', {
      runtimeId,
      cwd: threadPath,
      text: '[[title Remote JJ fixture]] [[answer Ready.]]',
      model: { provider: 'commandcode_work', model: 'gpt-6-luna' },
    }),
  )
  const description = `Remote work landed from this client ${randomUUID()}`
  await writeFile(join(threadPath, 'landed.txt'), 'landed\n')
  runScratchJj(threadPath, 'describe', '-m', description)
  remoteJjJourneys.set(page, { repository, threadPath, sessionId: created.sessionId, description })
})

Then('this client reads that workspace from its owner and refuses any other path', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  const call = await hostApi(pairFor(page).manager)
  await recordAssertion(page, 'multi-host-remote-jj-read', async () => {
    const read = Schema.decodeUnknownSync(jjCallResultSchema)(
      await call('sessionJjCall', { sessionId: journey.sessionId, method: 'threadAt', input: { path: journey.threadPath, sessionId: journey.sessionId } }),
    )
    expect(read.ok, read.message).toBe(true)
    expect(JSON.stringify(read.value)).toContain(journey.description)
    const refused = Schema.decodeUnknownSync(jjCallResultSchema)(
      await call('sessionJjCall', { sessionId: journey.sessionId, method: 'threadAt', input: { path: journey.repository } }),
    )
    expect(refused).toMatchObject({ ok: false, code: 'session/path-mismatch' })
  })
})

When('a revision of that thread is described through the owner', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  const call = await hostApi(pairFor(page).manager)
  const repositoryCall = async (method: string, input: Record<string, Schema.Json>) =>
    Schema.decodeUnknownSync(jjCallResultSchema)(await call('sessionRepositoryCall', { sessionId: journey.sessionId, api: 'jujutsu', method, input }))
  const refused = await repositoryCall('registerRepository', { path: journey.repository })
  expect(refused).toMatchObject({ ok: false, code: 'session/path-mismatch' })
  const registered = await repositoryCall('registerRepository', { path: journey.threadPath })
  expect(registered.ok, registered.message).toBe(true)
  const { repoId } = Schema.decodeUnknownSync(withUnknownProperties({ repoId: Schema.String }))(registered.value)
  const commitId = runScratchJj(journey.threadPath, 'log', '--no-graph', '-r', '@', '-T', 'commit_id').trim()
  const description = `${journey.description} described here`
  const prepared = await repositoryCall('prepare', { repoId, action: { kind: 'describe', commitId, message: description } })
  expect(prepared.ok, prepared.message).toBe(true)
  const preview = Schema.decodeUnknownSync(withUnknownProperties({ id: Schema.String }))(prepared.value)
  const confirmed = await repositoryCall('confirm', { repoId, previewId: preview.id })
  expect(confirmed.ok, confirmed.message).toBe(true)
  remoteJjJourneys.set(page, { ...journey, description })
})

Then('the revision panel shows that thread from its owner', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  await page.goto(new URL(`/?thread=${journey.sessionId}`, page.url()).href)
  await expect(page.getByText('Ready.', { exact: true })).toBeVisible({ timeout: 45_000 })
  await recordAssertion(page, 'multi-host-remote-jj-panel', async () => {
    await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
    await page.getByRole('button', { name: /^Jujutsu/u }).first().click({ timeout: 15_000 })
    await expect(page.getByText(journey.description).first()).toBeVisible({ timeout: 30_000 })
  })
})

When('the thread is integrated from this client', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  const workspace = page.getByRole('button', { name: /^Current thread workspace: / })
  await expect(workspace).toBeVisible({ timeout: 30_000 })
  await workspace.click()
  await page.getByRole('button', { name: 'Land this thread on main', exact: true }).click()
})

When('the thread is landed from the Land page', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  const row = page.locator('article, li').filter({ hasText: basename(journey.threadPath) }).first()
  await expect(async () => {
    await page.reload()
    await page.getByRole('tab', { name: 'Land', exact: true }).click()
    await page.getByRole('button', { name: /^Workspaces/u }).first().click()
    await expect(row).toBeVisible({ timeout: 6_000 })
  }).toPass({ timeout: 60_000 })
  await row.getByRole('button', { name: 'Land', exact: true }).click()
})

Then('the work reached the remote main bookmark', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  await recordAssertion(page, 'multi-host-remote-land-page', async () => {
    await expect.poll(() => runScratchJj(journey.repository, 'log', '--no-graph', '-r', 'main', '-T', 'description'), { timeout: 30_000 }).toContain(journey.description)
  })
})

Then('the workspace is removed from the Land page', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  await recordAssertion(page, 'multi-host-remote-land-discard', async () => {
    // A landed workspace leaves the default "Needs you" filter.
    await page.getByRole('button', { name: 'All', exact: true }).first().click()
    await page.getByRole('button', { name: `More actions for ${basename(journey.threadPath)}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Remove workspace…', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove workspace and folder', exact: true }).click()
    await expect.poll(() => existsSync(journey.threadPath), { timeout: 30_000 }).toBe(false)
  })
  await finishJourneyAssertions(page)
})

When('a turn is running on that thread', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  await page.goto(new URL(`/?thread=${journey.sessionId}`, page.url()).href)
  await expect(page.getByText('Ready.', { exact: true })).toBeVisible({ timeout: 45_000 })
  const composer = remoteComposer(page)
  await composer.fill('[[hold]]')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  // The Stop button lights before the owner starts the turn, and an idle owner would land at once rather than queue.
  const fake = fakeCommandCodeFor(page)
  await expect.poll(() => fake.requests.some(request => request.messages.some(message => message.text.includes('[[hold]]'))), { timeout: 30_000 }).toBe(true)
})

Then('landing is queued and undone from this client', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  await recordAssertion(page, 'multi-host-remote-land-queue', async () => {
    await page.getByRole('button', { name: /^Current thread workspace: / }).click()
    await page.getByRole('button', { name: /^Queue/u }).first().click({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Cancel the queued landing on main', exact: true }).first().click({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^Queue/u }).first()).toBeVisible({ timeout: 30_000 })
    expect(runScratchJj(journey.repository, 'log', '--no-graph', '-r', 'main', '-T', 'description')).not.toContain(journey.description)
  })
  fakeCommandCodeFor(page).releaseHeldTurns()
  await finishJourneyAssertions(page)
})

When('the remote thread is forked', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  await page.goto(new URL(`/?thread=${journey.sessionId}`, page.url()).href)
  await expect(page.getByText('Ready.', { exact: true })).toBeVisible({ timeout: 45_000 })
  const created = await page.evaluate(async sessionId => {
    const response = await fetch('/api/session/fork', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/fork', payload: { args: { request: { sessionId } } } }),
    })
    return await response.json()
  }, journey.sessionId)
  const fork = Schema.decodeUnknownSync(withUnknownProperties({ result: withUnknownProperties({ ok: Schema.Literal(true), value: withUnknownProperties({ sessionId: Schema.String }) }) }))(created)
  remoteForks.set(page, fork.result.value.sessionId)
})

Then('the fork is a thread of the same host', async ({ page }: { readonly page: Page }) => {
  const forkId = remoteForks.get(page)
  if (forkId === undefined) throw new Error('The journey has no fork.')
  await recordAssertion(page, 'multi-host-remote-fork', async () => {
    const call = await hostApi(pairFor(page).manager)
    const threads = Schema.decodeUnknownSync(remoteThreadListSchema)(await call('threadList')).threads
    expect(threads.some(thread => thread.sessionId === forkId)).toBe(true)
    expect(Schema.decodeUnknownSync(sessionRuntimeSchema)(await call('sessionRuntime', { sessionId: SessionId(forkId) }))).toMatchObject({ ok: true })
  })
  await finishJourneyAssertions(page)
})

Then('the work is on the remote main bookmark', async ({ page }: { readonly page: Page }) => {
  const journey = remoteJjJourneys.get(page)
  if (journey === undefined) throw new Error('The remote JJ journey has no thread.')
  await recordAssertion(page, 'multi-host-remote-jj-landed', async () => {
    await expect.poll(() => runScratchJj(journey.repository, 'log', '--no-graph', '-r', 'main', '-T', 'description')).toContain(journey.description)
  })
  await finishJourneyAssertions(page)
})

const APPROVAL_MARKER = 'approved-on-the-owning-host'
const remoteApproval = (page: Page) => page.locator('[data-remote-approval]')

When('the remote agent asks to run a command with wider access', async ({ page }: { readonly page: Page }) => {
  const directive = `[[title Remote approval fixture]] [[once call bash ${JSON.stringify({
    command: `echo ${APPROVAL_MARKER}`,
    description: 'Echo a marker',
    sandbox_permissions: 'danger-full-access',
    justification: 'The journey asks for wider access.',
  })}]]`
  await remoteComposer(page).fill(directive)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
})

Then('the remote approval opens in the controlling chat with its command', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-approval-panel', async () => {
    await expect(remoteApproval(page)).toBeVisible({ timeout: 45_000 })
    await expect(remoteApproval(page).getByText(`echo ${APPROVAL_MARKER}`, { exact: true })).toBeVisible()
  })
})

When('the remote approval is allowed once here', async ({ page }: { readonly page: Page }) => {
  await remoteApproval(page).getByRole('button', { name: 'Allow once', exact: true }).click()
})

Then('the remote command runs on its owning host', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-approval-applied', async () => {
    await expect(remoteApproval(page)).toHaveCount(0, { timeout: 30_000 })
    const fake = fakeCommandCodeFor(page)
    await expect
      .poll(() => fake.requests.flatMap(request => request.messages).some(message => message.role === 'tool' && message.text.includes(APPROVAL_MARKER)), {
        timeout: 30_000,
      })
      .toBe(true)
  })
  await finishJourneyAssertions(page)
})

When('a child agent on the remote asks for an approval', async ({ page }: { readonly page: Page }) => {
  const child = `[[once call bash ${JSON.stringify({ command: `echo ${APPROVAL_MARKER}-child`, description: 'Echo', sandbox_permissions: 'danger-full-access', justification: 'child' })}]]`
  // The directive ends at the first closing brace, so the child's own directive travels as JSON string escapes.
  const escaped = JSON.stringify({ description: 'child work', prompt: child })
    .replace(/^\{/u, 'OPEN')
    .replace(/\}$/u, 'CLOSE')
    .replaceAll('{', '\\u007b')
    .replaceAll('}', '\\u007d')
    .replaceAll('[', '\\u005b')
    .replaceAll(']', '\\u005d')
    .replace('OPEN', '{')
    .replace('CLOSE', '}')
  const directive = `[[title Child fixture]] [[once call subagent ${escaped}]]`
  await remoteComposer(page).fill(directive)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
})

Then('the owner refuses the child agent without asking anyone', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-child-approval', async () => {
    const fake = fakeCommandCodeFor(page)
    await expect
      .poll(() => fake.requests.flatMap(request => request.messages).some(message => message.role === 'tool' && message.text.includes('rejected escalating')), { timeout: 45_000 })
      .toBe(true)
    const call = await hostApi(pairFor(page).manager)
    expect(Schema.decodeUnknownSync(withUnknownProperties({ interactions: Schema.Array(Schema.Unknown) }))(await call('sessionInteractions', {})).interactions).toEqual([])
    await expect(remoteApproval(page)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('the remote approval is rejected here', async ({ page }: { readonly page: Page }) => {
  await remoteApproval(page).getByRole('button', { name: 'Reject', exact: true }).click()
})

Then('the remote command does not run', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-approval-rejected', async () => {
    await expect(remoteApproval(page)).toHaveCount(0, { timeout: 30_000 })
    const fake = fakeCommandCodeFor(page)
    await expect.poll(() => fake.requests.flatMap(request => request.messages).filter(message => message.role === 'tool').length, { timeout: 30_000 }).toBeGreaterThan(0)
    const toolText = fake.requests.flatMap(request => request.messages).filter(message => message.role === 'tool').map(message => message.text).join('\n')
    expect(toolText).not.toMatch(new RegExp(`^${APPROVAL_MARKER}$`, 'mu'))
  })
  await finishJourneyAssertions(page)
})

Then('the approval panel fits a phone', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-approval-phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const panel = remoteApproval(page)
    await expect(panel.getByRole('button', { name: 'Allow once', exact: true })).toBeInViewport({ timeout: 15_000 })
    await expect(panel.getByRole('button', { name: 'Reject', exact: true })).toBeInViewport()
    const overflow = await panel.evaluate(element => element.scrollWidth - element.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.setViewportSize({ width: 1280, height: 800 })
  })
})

Then('a host without the repository plugins says so', async ({ page }: { readonly page: Page }) => {
  const observation = autoDestinationObservations.get(page)
  if (observation === undefined) throw new Error('The Auto destination journey did not create a remote thread.')
  const call = await hostApi(pairFor(page).manager)
  await recordAssertion(page, 'multi-host-host-without-plugins', async () => {
    const repositories = Schema.decodeUnknownSync(withUnknownProperties({ unreachable: Schema.Array(Schema.String) }))(await call('remoteRepositories', {}))
    expect(repositories.unreachable).toEqual([])
    const reply = Schema.decodeUnknownSync(jjCallResultSchema)(
      await call('sessionRepositoryCall', { sessionId: observation.sessionId, api: 'jujutsu', method: 'registerRepository', input: { path: observation.folderPath } }),
    )
    expect(reply).toMatchObject({ ok: false, code: 'api-not-served', message: 'This host does not have the plugin for that. Update DSH there, or open the thread on its host.' })
  })
})

When('a terminal is opened on the remote thread', async ({ page }: { readonly page: Page }) => {
  await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await page.getByRole('button', { name: /^New terminal/u }).first().click({ timeout: 15_000 })
})

Then('the terminal is offered on its host', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-remote-terminal', async () => {
    const panel = page.locator('[data-remote-terminal]')
    await expect(panel).toBeVisible({ timeout: 30_000 })
    const observation = autoDestinationObservations.get(page)
    if (observation === undefined) throw new Error('The Auto destination journey did not create a remote thread.')
    const call = await hostApi(pairFor(page).manager)
    const view = Schema.decodeUnknownSync(runtimeOpenViewSchema, { onExcessProperty: 'error' })(await call('runtimeOpenView', { runtimeId: observation.runtimeId }))
    allowLoopbackBrowserOrigin(page, view.launchUrl)
    const [hostPage] = await Promise.all([page.context().waitForEvent('page'), panel.getByRole('button', { name: 'Open terminal on host', exact: true }).click()])
    await expect.poll(() => hostPage.url(), { timeout: 30_000 }).not.toBe('about:blank')
    await expect(hostPage.getByRole('button', { name: 'New session', exact: true }).first()).toBeVisible({ timeout: 30_000 })
    expect(new URL(hostPage.url()).origin).not.toBe(new URL(page.url()).origin)
    await hostPage.close()
  })
  await finishJourneyAssertions(page)
})

Then('a message naming this machine is refused and keeps its draft', async ({ page }: { readonly page: Page }) => {
  await recordAssertion(page, 'multi-host-local-path-refused', async () => {
    const draft = 'please read @~/notes-on-this-machine.md'
    await remoteComposer(page).fill(draft)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByText('points to this machine', { exact: false })).toBeVisible({ timeout: 15_000 })
    await expect(remoteComposer(page)).toContainText('notes-on-this-machine')
    await remoteComposer(page).clear()
  })
})

When('the Hosts page is opened', async ({ page }: { readonly page: Page }) => {
  // Hosts is a section of the Observe rail destination now, not a top-level sidebar button.
  await openGlobalPanel(page, 'Multi-host: Hosts')
  await expect(page.getByTestId('dshfiles-hosts-page')).toBeVisible()
})

Then('the Hosts page shows live resource metrics', async ({ page }: { readonly page: Page }) => {
  const hostsPage = page.getByTestId('dshfiles-hosts-page')
  await expect(hostsPage.getByText('Auto destination', { exact: true })).toBeVisible()
  await expect(hostsPage.getByText('Load · 1m', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(hostsPage.getByText('Memory used', { exact: true }).first()).toBeVisible()
  await expect(hostsPage.getByTestId(/^host-resources-/).first()).toBeVisible()
  await expect(hostsPage.getByText(/^Every machine this one can run threads on/)).toHaveCount(0)
})

/** One scratch repository trio per page: a bare origin, whoever else publishes to it, and the checkout on the host. */
const checkoutSyncRepositories = new WeakMap<Page, { readonly origin: string; readonly publisher: string; readonly checkout: string }>()

const scratchRun = (cwd: string, command: string, ...args: readonly string[]): string => {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, JJ_USER: 'Scratch', JJ_EMAIL: 'scratch@example.invalid' },
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const syncDialog = (page: Page) => page.getByTestId('checkout-sync-dialog')

When('a checkout on the host has unpushed work and origin moved', async ({ page }: { readonly page: Page }) => {
  const root = join(pairFor(page).remote.homeRoot, 'checkout-sync')
  await mkdir(root, { recursive: true })
  const origin = join(root, 'origin.git')
  const publisher = join(root, 'publisher')
  const checkout = join(root, 'host checkout')
  scratchRun(root, 'git', 'init', '--quiet', '--bare', '--initial-branch=main', origin)
  scratchRun(root, 'jj', 'git', 'init', '--colocate', publisher)
  scratchRun(publisher, 'jj', 'git', 'remote', 'add', 'origin', origin)
  await writeFile(join(publisher, 'base.txt'), 'base\n')
  scratchRun(publisher, 'jj', 'describe', '-m', 'base')
  scratchRun(publisher, 'jj', 'bookmark', 'create', 'main', '-r', '@')
  scratchRun(publisher, 'jj', 'git', 'push', '--bookmark', 'main')
  scratchRun(root, 'jj', 'git', 'clone', origin, checkout)
  scratchRun(checkout, 'jj', 'new', 'main@origin')
  await writeFile(join(checkout, 'mine.txt'), 'mine\n')
  scratchRun(checkout, 'jj', 'describe', '-m', 'feat: unpushed on this host')
  scratchRun(publisher, 'jj', 'new', 'main@origin')
  await writeFile(join(publisher, 'incoming.txt'), 'incoming\n')
  scratchRun(publisher, 'jj', 'describe', '-m', 'feat: pushed from elsewhere')
  scratchRun(publisher, 'jj', 'bookmark', 'set', 'main', '-r', '@')
  scratchRun(publisher, 'jj', 'git', 'push', '--bookmark', 'main')
  checkoutSyncRepositories.set(page, { origin, publisher, checkout })
})

When('the checkout is checked from the Sync checkout dialog', async ({ page }: { readonly page: Page }) => {
  const repositories = checkoutSyncRepositories.get(page)
  if (repositories === undefined) throw new Error('The checkout sync journey created no repositories.')
  await page.getByTestId(/^host-row-/u).filter({ hasText: scratchRemoteName }).getByRole('button', { name: 'Sync checkout', exact: true }).click()
  const dialog = syncDialog(page)
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(`Checkout on ${scratchRemoteName}`).fill(repositories.checkout)
  await dialog.getByRole('button', { name: 'Check', exact: true }).click()
})

Then('the dialog refuses over the unpushed work and says what to do', async ({ page }: { readonly page: Page }) => {
  const dialog = syncDialog(page)
  await expect(dialog.getByTestId('checkout-sync-status')).toHaveAttribute('data-status', 'unpushed-work', { timeout: 60_000 })
  await expect(dialog.getByRole('list', { name: 'Incoming from origin' })).toContainText('feat: pushed from elsewhere')
  await expect(dialog.getByRole('list', { name: 'Not pushed, in this working copy' })).toContainText('feat: unpushed on this host')
  await expect(dialog.getByRole('list', { name: 'Workspaces in this repository' })).toContainText('default')
  await expect(dialog.getByRole('list', { name: 'Recovery steps' })).toContainText('rebase -b @')
  await expect(dialog.getByRole('button', { name: /^Sync \d+ incoming/u })).toHaveCount(0)
})

When('that work is marked as local on the host and checked again', async ({ page }: { readonly page: Page }) => {
  const repositories = checkoutSyncRepositories.get(page)
  if (repositories === undefined) throw new Error('The checkout sync journey created no repositories.')
  scratchRun(repositories.checkout, 'jj', 'describe', '-m', 'wip')
  const dialog = syncDialog(page)
  await dialog.getByRole('button', { name: 'Check again', exact: true }).click()
  await expect(dialog.getByTestId('checkout-sync-status')).toHaveAttribute('data-status', 'would-sync', { timeout: 60_000 })
})

When('the incoming revision is synced from the dialog', async ({ page }: { readonly page: Page }) => {
  const dialog = syncDialog(page)
  await dialog.getByRole('button', { name: 'Sync 1 incoming revision', exact: true }).click()
  await expect(dialog.getByTestId('checkout-sync-status')).toHaveAttribute('data-status', 'synced', { timeout: 60_000 })
})

Then('the checkout holds both its own work and the incoming revision and origin did not move', async ({ page }: { readonly page: Page }) => {
  const repositories = checkoutSyncRepositories.get(page)
  if (repositories === undefined) throw new Error('The checkout sync journey created no repositories.')
  expect(await readFile(join(repositories.checkout, 'mine.txt'), 'utf8')).toBe('mine\n')
  expect(await readFile(join(repositories.checkout, 'incoming.txt'), 'utf8')).toBe('incoming\n')
  const originTip = scratchRun(repositories.origin, 'git', 'log', '-1', '--format=%s', 'main').trim()
  expect(originTip).toBe('feat: pushed from elsewhere')
})

When('the manager composer selects the recorded remote thread mention', async ({ page }: { readonly page: Page }) => {
  const observation = autoDestinationObservations.get(page)
  if (observation === undefined) throw new Error('The Auto destination journey did not create a remote thread.')
  const call = await hostApi(pairFor(page).manager)
  const created = Schema.decodeUnknownSync(remoteThreadListSchema)(await call('threadList')).threads.find(thread => thread.sessionId === observation.sessionId)
  if (created === undefined || created.mention === undefined) throw new Error('The manager did not expose a canonical mention for the remote thread.')

  await page.getByRole('button', { name: 'New thread', exact: true }).first().click()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await expect(composer).toBeVisible({ timeout: 30_000 })
  const option = page.getByRole('listbox').getByRole('option').filter({ hasText: observation.sessionId }).first()
  const chip = page.locator('[data-composer-card] [data-composer-chip="reference"]')
  // The New thread composer can remount once its destination settles, dropping keys or the open menu of the first instance.
  await expect(async () => {
    await composer.fill('')
    await composer.click()
    await composer.pressSequentially(`@t:${observation.sessionId}`)
    await option.click({ timeout: 5_000 })
    await expect(chip).toHaveCount(1, { timeout: 5_000 })
  }).toPass({ timeout: 45_000 })

  await expect(chip).toHaveCount(1)
  await expect(chip).toContainText(observation.sessionId)
})

Then('the new thread is owned by the automatically selected remote runtime', async ({ page }: { readonly page: Page }) => {
  const observation = autoDestinationObservations.get(page)
  if (observation === undefined) throw new Error('The Auto destination journey did not create a remote thread.')
  const call = await hostApi(pairFor(page).manager)
  await expect
    .poll(
      async () => Schema.decodeUnknownSync(remoteThreadListSchema)(await call('threadList')).threads.find(thread => thread.sessionId === observation.sessionId),
      {
        timeout: 30_000,
      },
    )
    .toBeDefined()
  const threads = Schema.decodeUnknownSync(remoteThreadListSchema)(await call('threadList')).threads
  const created = threads.find(thread => thread.sessionId === observation.sessionId)
  if (created === undefined) throw new Error('The manager did not list the new remote thread.')
  expect(created.runtimeId).toBe(observation.runtimeId)
  const ownership = Schema.decodeUnknownSync(sessionRuntimeSchema)(await call('sessionRuntime', { sessionId: SessionId(created.sessionId) }))
  expect(ownership).toMatchObject({ ok: true, runtimeId: observation.runtimeId })
  if (observation.prompt === undefined) throw new Error('The native composer did not submit a prompt.')
  await expect
    .poll(
      async () => {
        const transcript = Schema.decodeUnknownSync(transcriptSchema)(
          await call('threadTranscript', {
            runtimeId: observation.runtimeId,
            sessionId: observation.sessionId,
          }),
        )
        if (!transcript.ok) throw new Error(`The remote transcript could not be read: ${transcript.code}.`)
        expect(transcript.cwd).toBe(observation.folderPath)
        return transcript.entries.some(entry => entry.kind === 'user' && entry.text.includes(observation.prompt))
      },
      { timeout: 30_000 },
    )
    .toBe(true)
})

When('a Git project is cloned with selected local files', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const sourceProjectPath = join(pair.sshd.scratchRoot, 'source-project')
  const destinationPath = join(pair.sshd.scratchRoot, 'remote-project')
  await mkdir(sourceProjectPath, { recursive: true })
  await Promise.all([
    writeFile(join(sourceProjectPath, '.gitignore'), 'selected-ignored.txt\n'),
    writeFile(join(sourceProjectPath, 'tracked.txt'), 'tracked from the cloned repository\n'),
    writeFile(join(sourceProjectPath, 'selected-untracked.txt'), 'selected untracked file\n'),
    writeFile(join(sourceProjectPath, 'selected-ignored.txt'), 'selected ignored file\n'),
    writeFile(join(sourceProjectPath, 'unselected.txt'), 'this file must stay local\n'),
  ])
  runScratchGit({ args: ['init', '--quiet'], cwd: sourceProjectPath })
  runScratchGit({ args: ['add', '.gitignore', 'tracked.txt'], cwd: sourceProjectPath })
  runScratchGit({
    args: ['-c', 'user.name=DSH E2E', '-c', 'user.email=dsh-e2e@example.invalid', 'commit', '--quiet', '-m', 'scratch project'],
    cwd: sourceProjectPath,
  })
  const gitServer = await startScratchGitServer({ projectPath: sourceProjectPath, scratchRoot: pair.sshd.scratchRoot })

  try {
    await page.getByRole('button', { name: /^Run on /u }).click()
    const cloneTargetGroup = page.getByRole('group', { name: 'Add project to another machine' })
    const cloneTarget = cloneTargetGroup.getByRole('option', { name: scratchRemoteName, exact: true })
    await expect(cloneTarget).toBeVisible()
    await cloneTarget.click()

    const dialog = page.getByRole('dialog', { name: `Clone project to ${scratchRemoteName}`, exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Git repository URL').fill(gitServer.repositoryUrl)
    await dialog.getByLabel(`Folder on ${scratchRemoteName}`).fill(destinationPath)
    await dialog.getByRole('checkbox', { name: 'Copy selected local files', exact: true }).check()
    await dialog.getByLabel('Local project folder').fill(sourceProjectPath)
    await dialog.getByRole('checkbox', { name: 'Also scan ignored files', exact: true }).check()
    await dialog.getByRole('button', { name: 'Find files', exact: true }).click()

    const selectedUntracked = dialog.getByRole('checkbox', { name: /selected-untracked\.txt/u })
    const selectedIgnored = dialog.getByRole('checkbox', { name: /selected-ignored\.txt/u })
    const unselected = dialog.getByRole('checkbox', { name: /unselected\.txt/u })
    await expect(selectedUntracked).toBeVisible()
    await expect(selectedIgnored).toBeVisible()
    await expect(unselected).toBeVisible()
    await selectedUntracked.check()
    await selectedIgnored.check()
    await unselected.uncheck()
    await expect(selectedUntracked).toBeChecked()
    await expect(selectedIgnored).toBeChecked()
    await expect(unselected).not.toBeChecked()

    await dialog.getByRole('button', { name: 'Clone project', exact: true }).click()
    await expect(dialog.getByText('Project cloned and added. Copied 2 local file(s).', { exact: true })).toBeVisible({ timeout: 30_000 })
    expect(await readFile(join(destinationPath, 'tracked.txt'), 'utf8')).toBe('tracked from the cloned repository\n')
    expect(await readFile(join(destinationPath, 'selected-untracked.txt'), 'utf8')).toBe('selected untracked file\n')
    expect(await readFile(join(destinationPath, 'selected-ignored.txt'), 'utf8')).toBe('selected ignored file\n')
    expect(existsSync(join(destinationPath, 'unselected.txt'))).toBe(false)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  } finally {
    await gitServer.close()
  }
})

When('a remote thread is created and read over SSH', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const call = await hostApi(pair.manager)
  const directory = Schema.decodeUnknownSync(runtimeDirectorySchema)(await call('list'))
  const host = directory.hosts.find(item => item.name === scratchRemoteName)
  if (host === undefined) throw new Error('The saved scratch SSH host was not listed by the manager DSH.')
  const runtime = directory.runtimes.find(item => item.hostId === host.id)
  if (runtime === undefined) throw new Error('The scratch SSH host did not register a remote DSH runtime.')

  await writeFile(join(pair.remote.homeRoot, 'remote-composer-reference.txt'), 'remote attachment references belong to the owning Host.\n')
  const created = Schema.decodeUnknownSync(threadCreateSchema)(await call('threadCreate', { runtimeId: runtime.id, cwd: pair.remote.homeRoot }))
  if (!created.ok) throw new Error(`The empty remote thread could not be created: ${created.code}.`)
  const sessionId = created.sessionId
  const transcript = Schema.decodeUnknownSync(transcriptSchema)(await call('threadTranscript', { runtimeId: runtime.id, sessionId }))
  if (!transcript.ok) throw new Error(`The remote thread transcript could not be read: ${transcript.code}.`)
  expect(transcript.entries).toEqual([])
  const sessions = Schema.decodeUnknownSync(nativeSessionListSchema)(
    await call('runtimeCall', {
      runtimeId: runtime.id,
      request: { namespace: 'session', method: 'list', args: { _request: {} } },
    }),
  )
  if (!sessions.ok) throw new Error(`The remote session list could not be read: ${sessions.code}.`)
  expect(sessions.value.items.find(item => item.sessionId === sessionId)?.blank).toBe(true)
  expect(transcript.cwd).toBe(pair.remote.homeRoot)
  observations.set(page, { runtimeId: runtime.id, remoteHome: runtime.remoteHome, sessionId, transcriptCwd: transcript.cwd })
})

When('the mirrored thread opens its owning host UI', async ({ page }: { readonly page: Page }) => {
  const observation = autoDestinationObservations.get(page)
  if (observation === undefined) throw new Error('The remote thread composer journey did not produce an observation.')

  // Opening the Hosts page left the rail on Observe; the mirrored thread row lives in the Threads destination.
  const destinations = page.getByRole('tablist', { name: 'Destinations', exact: true })
  if (await destinations.isVisible()) await destinations.getByRole('tab', { name: 'Threads', exact: true }).click()
  const remoteThread = page.locator('[data-remote-thread-id]').filter({ hasText: scratchRemoteName })
  await expect(remoteThread).toHaveAttribute('data-remote-thread-id', `${observation.runtimeId}:${observation.sessionId}`, { timeout: 30_000 })
  await remoteThread.click()

  const conversation = page.locator('[data-conversation-content]:visible')
  await expect.poll(() => conversation.getAttribute('data-conversation-session')).toBe(observation.sessionId)
  const openRemoteHost = page.getByRole('button', { name: 'Open on remote host', exact: true })
  await expect(openRemoteHost).toBeVisible({ timeout: 30_000 })
  const call = await hostApi(pairFor(page).manager)
  const view = Schema.decodeUnknownSync(runtimeOpenViewSchema, { onExcessProperty: 'error' })(
    await call('runtimeOpenView', { runtimeId: observation.runtimeId }),
  )
  allowLoopbackBrowserOrigin(page, view.launchUrl)
  const [remotePage] = await Promise.all([page.context().waitForEvent('page', { timeout: 30_000 }), openRemoteHost.click()])
  await expect.poll(() => remotePage.url(), { timeout: 30_000 }).not.toBe('about:blank')
  await expect(remotePage.getByRole('button', { name: 'New session', exact: true }).first()).toBeVisible({ timeout: 30_000 })
  expect(new URL(remotePage.url()).origin).not.toBe(new URL(page.url()).origin)
  await finishJourneyAssertions(page)
})

When('the remote composer resolves @file suggestions on SSH', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const observation = observations.get(page)
  if (observation === undefined) throw new Error('The remote thread journey did not produce an observation.')
  const call = await hostApi(pair.manager)
  const ownership = Schema.decodeUnknownSync(sessionRuntimeSchema)(await call('sessionRuntime', { sessionId: observation.sessionId }))
  if (!ownership.ok) throw new Error(`The owning runtime could not be resolved: ${ownership.code}.`)
  expect(ownership.runtimeId).toBe(observation.runtimeId)
  const result = Schema.decodeUnknownSync(fileReferencesSchema)(
    await call('runtimeFileReferences', {
      runtimeId: observation.runtimeId,
      sessionId: SessionId(observation.sessionId),
      query: 'remote-composer-reference',
    }),
  )
  if (!result.ok) throw new Error(`Remote file-reference discovery failed: ${result.code}: ${result.message}.`)
  expect(result.candidates).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'file', path: expect.stringContaining('remote-composer-reference.txt') })]),
  )
})

When('a remote file attachment is staged on its owning SSH host', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const observation = observations.get(page)
  if (observation === undefined) throw new Error('The remote thread journey did not produce an observation.')
  const call = await hostApi(pair.manager)
  const content = 'A file staged by the native remote composer.\n'
  const result = Schema.decodeUnknownSync(fileUploadSchema)(
    await call('sessionUploadFile', {
      runtimeId: observation.runtimeId,
      sessionId: observation.sessionId,
      data: Buffer.from(content).toString('base64'),
      name: 'remote-composer-attachment.txt',
    }),
  )
  if (!result.ok) throw new Error(`Remote attachment upload failed: ${result.code}: ${result.message}`)
  expect(result.value.file).toMatchObject({ name: 'remote-composer-attachment.txt', bytes: Buffer.byteLength(content) })
})

When('the SSH tunnel drops and reconnects', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const observation = observations.get(page)
  if (observation === undefined) throw new Error('The remote thread journey did not produce an observation.')
  const call = await hostApi(pair.manager)
  const readyBeforeDrop = Schema.decodeUnknownSync(runtimePingSchema)(await call('runtimePing', { runtimeId: observation.runtimeId }))
  if (!readyBeforeDrop.ok) throw new Error(`The scratch runtime was not ready before tunnel loss: ${readyBeforeDrop.code}.`)
  const tunnelProcessRecordsBeforeDrop = await readTunnelProcessRecords(pair.tunnelProcessLogPath)
  const tunnelProcessRecord = tunnelProcessRecordsBeforeDrop.at(-1)
  const managerProcessId = pair.manager.host.pid
  if (managerProcessId === undefined || !isProcessRunning(managerProcessId)) {
    throw new Error('The manager DSH process was not running for tunnel ownership validation.')
  }
  if (tunnelProcessRecord === undefined) throw new Error('The persistent SSH forward was not recorded by the manager wrapper.')
  const tunnelProcessId = tunnelProcessRecord.processId
  if (!isProcessRunning(tunnelProcessId)) throw new Error('The recorded persistent SSH forward was not running.')
  const tunnelProcessDetails = readProcessDetails(tunnelProcessId)
  if (
    tunnelProcessRecord.marker !== 'persistent-forward' ||
    tunnelProcessDetails.commandName !== 'ssh' ||
    !isChildOfGuardedHost(tunnelProcessDetails.parentProcessId, managerProcessId) ||
    !ownsProcessGroup(tunnelProcessDetails.processGroupId, { processId: tunnelProcessId, managerProcessId }) ||
    !isProcessRunning(tunnelProcessId)
  ) {
    throw new Error(
      `Refusing to signal a process not owned by the manager DSH tunnel fixture: recorded ${tunnelProcessRecord.marker} pid ${String(tunnelProcessId)} is ${tunnelProcessDetails.commandName} (parent ${String(tunnelProcessDetails.parentProcessId)}, group ${String(tunnelProcessDetails.processGroupId)}); the manager DSH is pid ${String(managerProcessId)}.`,
    )
  }
  process.kill(tunnelProcessId, 'SIGKILL')
  for (let attempt = 0; attempt < 100 && isProcessRunning(tunnelProcessId); attempt += 1) await delay(25)
  expect(isProcessRunning(tunnelProcessId)).toBe(false)

  const readyAfterDrop = Schema.decodeUnknownSync(runtimePingSchema)(await call('runtimePing', { runtimeId: observation.runtimeId }))
  if (!readyAfterDrop.ok) throw new Error(`The scratch tunnel did not recover after loss: ${readyAfterDrop.code}.`)
  const tunnelProcessRecordsAfterDrop = await readTunnelProcessRecords(pair.tunnelProcessLogPath)
  expect(tunnelProcessRecordsAfterDrop.length).toBeGreaterThan(tunnelProcessRecordsBeforeDrop.length)
  const recoveredTunnelProcessRecord = tunnelProcessRecordsAfterDrop.at(-1)
  if (recoveredTunnelProcessRecord === undefined || recoveredTunnelProcessRecord.processId === tunnelProcessId) {
    throw new Error('The SSH tunnel did not start a new process after loss.')
  }
  const recoveredTunnelProcessDetails = readProcessDetails(recoveredTunnelProcessRecord.processId)
  if (
    recoveredTunnelProcessRecord.marker !== 'persistent-forward' ||
    recoveredTunnelProcessDetails.commandName !== 'ssh' ||
    !isChildOfGuardedHost(recoveredTunnelProcessDetails.parentProcessId, managerProcessId) ||
    !ownsProcessGroup(recoveredTunnelProcessDetails.processGroupId, { processId: recoveredTunnelProcessRecord.processId, managerProcessId }) ||
    !isProcessRunning(recoveredTunnelProcessRecord.processId)
  ) {
    throw new Error('The restarted SSH tunnel process was not owned by the manager DSH.')
  }

  const reconnect = Schema.decodeUnknownSync(runtimeReconnectSchema)(await call('runtimeReconnect', { runtimeId: observation.runtimeId }))
  if (!reconnect.ok) throw new Error(`The scratch SSH tunnel did not reconnect: ${reconnect.code}.`)
  const pingAfterReconnect = Schema.decodeUnknownSync(runtimePingSchema)(await call('runtimePing', { runtimeId: observation.runtimeId }))
  expect(pingAfterReconnect.ok).toBe(true)
  updateObservation(page, { tunnelReconnected: true })
})

When('stale SSH launch metadata is rejected', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const staleHome = join(pair.sshd.scratchRoot, 'stale-dsh-home')
  const [staleLaunchPath] = launchFilePaths(staleHome)
  const stalePort = await reserveLoopbackPort()
  const processId = pair.remote.host.pid
  if (processId === undefined) throw new Error('The scratch DSH process did not expose its pid.')
  const staleLaunchUrl = new URL(`http://127.0.0.1:${stalePort}/`)
  staleLaunchUrl.searchParams.set('token', randomBytes(32).toString('base64url'))
  await mkdir(dirname(staleLaunchPath), { recursive: true, mode: 0o700 })
  try {
    await writeFile(staleLaunchPath, `${JSON.stringify({ schemaVersion: 1, launchUrl: staleLaunchUrl.toString(), pid: processId })}\n`, { mode: 0o600 })
    await chmod(staleLaunchPath, 0o600)
    expect((await stat(staleLaunchPath)).mode & 0o777).toBe(0o600)
    const call = await hostApi(pair.manager)
    const result = Schema.decodeUnknownSync(connectionTestSchema)(
      await call('testConnection', { name: 'Stale scratch runtime', sshTarget: pair.sshd.targetAlias, remoteHome: staleHome }),
    )
    if (result.ok) throw new Error('The manager accepted a launch URL with no DSH listener.')
    expect(result.code).toBe('runtime-not-running')
  } finally {
    await rm(staleHome, { recursive: true, force: true })
  }
  updateObservation(page, { staleLaunchRejected: true })
})

When('a failed scratch profile sync is cleaned without starting DSH', async ({ page }: { readonly page: Page }) => {
  let failedHomeRoot: string | undefined
  await expect(
    bootComposedPluginProfile({
      packageIds: [multiHostPackageId],
      profileLabel: 'multi-host-sync-failure',
      seedHome: async homeRoot => {
        failedHomeRoot = homeRoot
        const seedDirectory = join(homeRoot, 'invalid-profile-seed')
        await mkdir(seedDirectory, { recursive: true, mode: 0o700 })
        await writeFile(join(seedDirectory, 'package.json'), '{', { mode: 0o600 })
        const syncResult = spawnSync(
          process.execPath,
          [
            '--experimental-strip-types',
            join(DSHFILES_ROOT, 'scripts/profile-sync.ts'),
            '--profile',
            'multi-host-sync-failure',
            '--home',
            homeRoot,
            '--seed',
            seedDirectory,
          ],
          {
            cwd: DSHFILES_ROOT,
            encoding: 'utf8',
            timeout: 30_000,
            env: { DSH_HOME: homeRoot, HOME: homeRoot, PATH: process.env.PATH ?? '', TMPDIR: process.env.TMPDIR ?? '' },
          },
        )
        if (syncResult.error !== undefined) throw syncResult.error
        expect(syncResult.status).toBe(1)
        expect(syncResult.stderr).toContain('profile-sync:')
        throw new Error('Injected profile-sync failure.')
      },
    }),
  ).rejects.toThrow('Injected profile-sync failure.')
  if (failedHomeRoot === undefined) throw new Error('The profile-sync failure did not create a scratch home.')
  expect(existsSync(failedHomeRoot)).toBe(false)
  updateObservation(page, { profileSyncFailureCleaned: true })
})

When('a lost mutation response is reconciled without replay', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const observation = observations.get(page)
  if (observation === undefined) throw new Error('The remote thread journey did not produce an observation.')
  const [launchFilePath] = launchFilePaths(pair.remote.homeRoot)
  const originalLaunchContents = await readFile(launchFilePath, 'utf8')
  const originalLaunch = parseRuntimeLaunch(originalLaunchContents)
  if (originalLaunch === undefined) throw new Error('The remote DSH launch metadata could not be parsed.')
  expect(originalLaunch.port).toBe(pair.remote.port)
  expect((await stat(launchFilePath)).mode & 0o777).toBe(0o600)
  const processId = pair.remote.host.pid
  if (processId === undefined) throw new Error('The scratch DSH process did not expose its pid.')
  const call = await hostApi(pair.manager)
  const sessionsBeforeMutation = Schema.decodeUnknownSync(nativeSessionListSchema)(
    await call('runtimeCall', {
      runtimeId: observation.runtimeId,
      request: { namespace: 'session', method: 'list', args: { _request: {} } },
    }),
  )
  if (!sessionsBeforeMutation.ok) throw new Error(`The existing remote sessions could not be listed: ${sessionsBeforeMutation.code}.`)
  const existingSessionIds = new Set(sessionsBeforeMutation.value.items.map(item => item.sessionId))
  const proxy = await startMutationResponseProxy({ upstreamPort: pair.remote.port })
  try {
    const proxyLaunchUrl = new URL(`http://127.0.0.1:${proxy.port}/`)
    proxyLaunchUrl.searchParams.set('token', originalLaunch.token)
    const proxyLaunch = { schemaVersion: 1, launchUrl: proxyLaunchUrl.toString(), pid: processId }
    const parsedProxyLaunch = parseRuntimeLaunch(JSON.stringify(proxyLaunch))
    if (parsedProxyLaunch === undefined || parsedProxyLaunch.port !== proxy.port) {
      throw new Error('The scratch mutation proxy launch metadata did not validate.')
    }
    await writeFile(launchFilePath, `${JSON.stringify(proxyLaunch)}\n`, { mode: 0o600 })
    await chmod(launchFilePath, 0o600)
    expect((await stat(launchFilePath)).mode & 0o777).toBe(0o600)

    const reconnect = Schema.decodeUnknownSync(runtimeReconnectSchema)(await call('runtimeReconnect', { runtimeId: observation.runtimeId }))
    if (!reconnect.ok) throw new Error(`The scratch runtime did not reconnect through the local proxy: ${reconnect.code}.`)
    const mutation = Schema.decodeUnknownSync(nativeCreateSchema)(
      await call('runtimeCall', {
        runtimeId: observation.runtimeId,
        request: { namespace: 'session', method: 'create', args: { request: { cwd: pair.remote.homeRoot } } },
      }),
    )
    if (mutation.ok) throw new Error('The admitted remote create returned a response instead of an unknown outcome.')
    expect(mutation.code).toBe('unknown-mutation-outcome')
    const firstProxyState = proxy.state()
    expect(firstProxyState.mutationRequests).toBe(1)
    expect(firstProxyState.droppedResponses).toBe(1)
    expect(firstProxyState.committedSessionIds).toHaveLength(1)
    const admittedSessionId = firstProxyState.committedSessionIds[0]
    if (admittedSessionId === undefined) throw new Error('The remote DSH did not commit the lost-response session.')
    const sessions = Schema.decodeUnknownSync(nativeSessionListSchema)(
      await call('runtimeCall', {
        runtimeId: observation.runtimeId,
        request: { namespace: 'session', method: 'list', args: { _request: {} } },
      }),
    )
    if (!sessions.ok) throw new Error(`The committed remote session could not be reconciled: ${sessions.code}.`)
    expect(sessions.value.items.some(item => item.sessionId === admittedSessionId)).toBe(true)
    const newlyObservedSessionIds = sessions.value.items.map(item => item.sessionId).filter(sessionId => !existingSessionIds.has(sessionId))
    expect(newlyObservedSessionIds).toEqual([admittedSessionId])
    expect(proxy.state().mutationRequests).toBe(1)
    expect(proxy.state().committedSessionIds).toHaveLength(1)
  } finally {
    try {
      await writeFile(launchFilePath, originalLaunchContents, { mode: 0o600 })
    } finally {
      try {
        await chmod(launchFilePath, 0o600)
      } finally {
        await proxy.close()
      }
    }
  }
  const actualReconnect = Schema.decodeUnknownSync(runtimeReconnectSchema)(await call('runtimeReconnect', { runtimeId: observation.runtimeId }))
  if (!actualReconnect.ok) throw new Error(`The scratch DSH did not reconnect after proxy cleanup: ${actualReconnect.code}.`)
  const pingAfterProxyCleanup = Schema.decodeUnknownSync(runtimePingSchema)(await call('runtimePing', { runtimeId: observation.runtimeId }))
  if (!pingAfterProxyCleanup.ok) throw new Error(`The scratch DSH was not ready after proxy cleanup: ${pingAfterProxyCleanup.code}.`)
  updateObservation(page, { mutationReconciled: true, remoteReadyAfterMutation: true })
})

When('the remote DSH crashes and its scratch home is cleaned', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const processId = pair.remote.host.pid
  if (processId === undefined) throw new Error('The scratch DSH process did not expose its pid.')
  if (pair.remote.host.exitCode !== null || pair.remote.host.signalCode !== null) throw new Error('The scratch DSH exited before the crash-cleanup check.')
  process.kill(-processId, 'SIGKILL')
  for (let attempt = 0; attempt < 100 && pair.remote.host.exitCode === null && pair.remote.host.signalCode === null; attempt += 1) await delay(25)
  expect(pair.remote.host.signalCode).toBe('SIGKILL')
  await pair.remote.close()
  expect(existsSync(pair.remote.homeRoot)).toBe(false)
  updateObservation(page, { remoteCrashCleaned: true })
})

When('a thread is started directly on the scratch remote', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const call = await hostApi(pair.manager)
  const directory = Schema.decodeUnknownSync(runtimeDirectorySchema)(await call('list'))
  const host = directory.hosts.find(item => item.name === scratchRemoteName)
  if (host === undefined) throw new Error('The saved scratch SSH host was not listed by the manager DSH.')
  const runtime = directory.runtimes.find(item => item.hostId === host.id)
  if (runtime === undefined) throw new Error('The scratch SSH host did not register a remote DSH runtime.')

  const created = Schema.decodeUnknownSync(nativeCreateSchema)(
    await call('runtimeCall', {
      runtimeId: runtime.id,
      request: { namespace: 'session', method: 'create', args: { request: { cwd: pair.remote.homeRoot } } },
    }),
  )
  if (!created.ok) throw new Error(`The remote session could not be created: ${created.code}.`)
  const sessionId = created.value.sessionId
  const prompted = Schema.decodeUnknownSync(promptAcceptedSchema)(
    await call('runtimeCall', {
      runtimeId: runtime.id,
      request: {
        namespace: 'session',
        method: 'prompt',
        args: { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: 'Inventory probe' }] } },
      },
    }),
  )
  if (!prompted.ok) throw new Error(`The remote session did not accept its first message: ${prompted.code}.`)
  const listed = Schema.decodeUnknownSync(remoteThreadListSchema)(await call('threadList'))
  expect(listed.threads.some(thread => thread.runtimeId === runtime.id && thread.sessionId === sessionId)).toBe(false)
  inventoryObservations.set(page, { runtimeId: runtime.id, sessionId, startedHere: false, hostName: scratchRemoteName })
})

Then('the manager lists it as started on the host', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const observed = inventoryObservations.get(page)
  if (observed === undefined) throw new Error('The inventory journey did not observe a remote-started thread.')
  const call = await hostApi(pair.manager)
  const directory = Schema.decodeUnknownSync(runtimeDirectorySchema)(await call('list'))
  const hostName = observed.hostName
  // The Host answers `runtime-status-refreshing` while its first snapshot loads asynchronously, so one call is not a verdict.
  let status = Schema.decodeUnknownSync(inventoryStatusSchema)(await call('runtimeStatus', { runtimeId: observed.runtimeId }))
  for (let attempt = 0; attempt < 40 && !status.ok && status.code === 'runtime-status-refreshing'; attempt += 1) {
    await delay(500)
    status = Schema.decodeUnknownSync(inventoryStatusSchema)(await call('runtimeStatus', { runtimeId: observed.runtimeId }))
  }
  if (!status.ok) throw new Error(`The scratch runtime status was unavailable: ${status.code}.`)
  expect(directory.hosts.some(host => host.name === hostName)).toBe(true)
  const row = mergeInventory({
    startedHere: [],
    statuses: [
      {
        runtimeId: observed.runtimeId,
        hostName,
        status: {
          ok: true,
          runtime: { id: observed.runtimeId, hostId: status.runtime.hostId, name: status.runtime.name, identity: null, connected: true },
          workspaces: [],
          sessions: status.sessions.map(session => ({ ...session, runtimeId: observed.runtimeId })),
        },
      },
    ],
  }).find(item => item.runtimeId === observed.runtimeId && item.sessionId === observed.sessionId)
  if (row === undefined) throw new Error('The remote-started thread did not reach the merged inventory.')
  expect(row.startedHere).toBe(false)
  expect(row.cwd).toBe(pair.remote.homeRoot)
  await recordAssertion(page, 'multi-host-remote-inventory', async () => expect(row.startedHere).toBe(false))
})

Then('the scratch DSH readiness and recovery checks pass', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const observation = observations.get(page)
  if (observation === undefined) throw new Error('The remote thread journey did not produce an observation.')
  expect(observation.remoteHome).toBe(pair.remote.homeRoot)
  expect(observation.sessionId).not.toBe('')
  expect(observation.transcriptCwd).toBe(pair.remote.homeRoot)
  expect(observation.tunnelReconnected).toBe(true)
  expect(observation.staleLaunchRejected).toBe(true)
  expect(observation.profileSyncFailureCleaned).toBe(true)
  expect(observation.mutationReconciled).toBe(true)
  expect(observation.remoteReadyAfterMutation).toBe(true)
  expect(observation.remoteCrashCleaned).toBe(true)
  await recordAssertion(page, 'multi-host-scratch-ready', async () => expect(observation.remoteReadyAfterMutation).toBe(true))
  await recordAssertion(page, 'multi-host-thread-roundtrip', async () => expect(observation.transcriptCwd).toBe(pair.remote.homeRoot))
  await recordAssertion(page, 'multi-host-ssh-reconnect', async () => expect(observation.tunnelReconnected).toBe(true))
  await recordAssertion(page, 'multi-host-stale-launch-rejected', async () => expect(observation.staleLaunchRejected).toBe(true))
  await recordAssertion(page, 'multi-host-profile-sync-cleanup', async () => expect(observation.profileSyncFailureCleaned).toBe(true))
  await recordAssertion(page, 'multi-host-mutation-no-replay', async () => expect(observation.mutationReconciled).toBe(true))
  await recordAssertion(page, 'multi-host-crash-cleanup', async () => expect(observation.remoteCrashCleaned).toBe(true))
  await finishJourneyAssertions(page)
})

After(async ({ page }: { readonly page: Page }) => {
  observations.delete(page)
  const pair = pairs.get(page)
  if (pair === undefined) return
  pairs.delete(page)
  let cleanupSucceeded = true
  for (const close of [() => pair.manager.close(), () => pair.remote.close(), () => pair.sshd.close()]) {
    try {
      await close()
    } catch {
      cleanupSucceeded = false
    }
  }
  expect(cleanupSucceeded).toBe(true)
  const remainingScratchRoots = [pair.manager.homeRoot, pair.remote.homeRoot, pair.sshd.scratchRoot].filter(existsSync)
  expect(remainingScratchRoots).toEqual([])
})
