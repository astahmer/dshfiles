import { expect, type Page } from '@playwright/test'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:https'
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { After, Given, Then, When } from '../bdd.js'
import { bootComposedPluginProfile, type BootedProfile } from '../boot.js'
import { startMutationResponseProxy } from '../mutation-response-proxy.mjs'
import { reserveLoopbackPort, startLoopbackSshd } from '../loopback-sshd.mjs'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { DSHFILES_ROOT } from '../../../packages/dshx/src/project/local-bundles.js'
import { launchFilePaths, parseRuntimeLaunch } from '../../../../../plugins/@dshfiles/multi-host/src/launch-file.js'
import { mergeInventory } from '../../../../../plugins/@dshfiles/multi-host/src/inventory.js'

const multiHostPackageId = '@dshfiles/multi-host'
const jjIntegrationPackageId = '@dshfiles/jj-integration'
const multiHostApiId = 'multi-host'
const scratchRemoteName = 'Scratch SSH runtime'

const nativeCreateSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({ sessionId: z.string() }).passthrough() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const threadCreateSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), sessionId: z.string() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string(), sessionId: z.string().optional() }),
])

const nativeSessionListSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({ items: z.array(z.object({ sessionId: z.string(), blank: z.boolean() }).passthrough()) }).passthrough() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const runtimePingSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), ms: z.number().int().nonnegative() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const runtimeReconnectSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const connectionTestSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).passthrough(),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }).passthrough(),
])

const transcriptSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), cwd: z.string(), entries: z.array(z.unknown()) }).passthrough(),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }).passthrough(),
])

const sessionRuntimeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), runtimeId: z.string().nullable() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const fileReferencesSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), candidates: z.array(z.object({ path: z.string(), kind: z.enum(['file', 'directory']) })) }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const fileUploadSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    value: z.object({
      receiptId: z.string().min(1),
      file: z.object({ attachmentId: z.string().min(1), name: z.string(), bytes: z.number().int().nonnegative() }),
    }),
  }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const runtimeDirectorySchema = z.object({
  hosts: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
  runtimes: z.array(z.object({ id: z.string(), hostId: z.string(), name: z.string(), remoteHome: z.string(), connected: z.boolean() }).passthrough()),
})

const promptAcceptedSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.object({ accepted: z.literal(true) }).passthrough() }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
])

const inventoryStatusSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      runtime: z.object({ hostId: z.string(), name: z.string() }).passthrough(),
      sessions: z.array(z.object({ sessionId: z.string(), blank: z.boolean(), running: z.boolean(), cwd: z.string().optional() }).passthrough()),
    })
    .passthrough(),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }).passthrough(),
])

const remoteThreadListSchema = z.object({ threads: z.array(z.object({ runtimeId: z.string(), sessionId: z.string() }).passthrough()) })

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

const updateObservation = (page: Page, update: Partial<JourneyObservation>): void => {
  const previous = observations.get(page)
  if (previous === undefined) throw new Error('The remote thread journey did not produce an observation.')
  observations.set(page, { ...previous, ...update })
}

const tunnelProcessRecordSchema = z.object({ marker: z.literal('persistent-forward'), processId: z.number().int().positive() })
const tunnelProcessRecordsSchema = z.array(tunnelProcessRecordSchema)
const processDetailsSchema = z.object({
  parentProcessId: z.number().int().positive(),
  processGroupId: z.number().int().positive(),
  commandName: z.string().min(1),
})

const readTunnelProcessRecords = async (path: string) => {
  const log = (await readFile(path, 'utf8')).trim()
  if (log === '') return []
  return tunnelProcessRecordsSchema.parse(
    log.split(/\r?\n/).map(line => {
      const [marker, processId] = line.split(' ')
      return { marker, processId: Number(processId) }
    }),
  )
}

const readProcessDetails = (processId: number) => {
  const result = spawnSync('ps', ['-o', 'ppid=', '-o', 'pgid=', '-o', 'comm=', '-p', String(processId)], { encoding: 'utf8', timeout: 5_000 })
  if (result.error !== undefined || result.status !== 0) throw new Error('Could not inspect the scratch tunnel process.')
  const [parentProcessId, processGroupId, ...commandName] = result.stdout.trim().split(/\s+/)
  if (parentProcessId === undefined || processGroupId === undefined || commandName.length === 0) {
    throw new Error('The scratch tunnel process is no longer listed.')
  }
  return processDetailsSchema.parse({
    parentProcessId: Number(parentProcessId),
    processGroupId: Number(processGroupId),
    commandName: basename(commandName.join(' ')),
  })
}

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

Given('a loopback SSH DSH pair is booted', async ({ page }: { readonly page: Page }) => {
  const sshd = await startLoopbackSshd({ gitSslNoVerify: true })
  let remote: BootedProfile | undefined
  let manager: BootedProfile | undefined
  try {
    remote = await bootComposedPluginProfile({ packageIds: [multiHostPackageId], profileLabel: 'multi-host-remote' })
    let wrapperInvocationLogPath: string | undefined
    let tunnelProcessLogPath: string | undefined
    manager = await bootComposedPluginProfile({
      packageIds: [multiHostPackageId, jjIntegrationPackageId],
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
})

When('the scratch remote is added from the host UI', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: 'Run on Local', exact: true }).click()
  await page.getByText('Add host…', { exact: true }).click()
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
  await dialog.getByRole('button', { name: 'Add host', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: `Run on ${scratchRemoteName}`, exact: true })).toBeVisible()
  const wrapperCalls = (await readFile(pair.wrapperInvocationLogPath, 'utf8')).trim().split(/\r?\n/)
  expect(wrapperCalls).toContain('invoked')
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
    await page.getByRole('button', { name: `Run on ${scratchRemoteName}`, exact: true }).click()
    const cloneTargetGroup = page.getByRole('group', { name: 'Add project to another machine' })
    const cloneTarget = cloneTargetGroup.getByRole('option', { name: scratchRemoteName, exact: true })
    await expect(cloneTarget).toBeVisible()
    await cloneTarget.click()

    const dialog = page.getByRole('dialog', { name: `Clone project to ${scratchRemoteName}`, exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Git repository URL').fill(gitServer.repositoryUrl)
    await dialog.getByLabel(`Folder on ${scratchRemoteName}`).fill(destinationPath)
    await dialog.getByRole('checkbox', { name: 'Copy local ignored and untracked files', exact: true }).check()
    await dialog.getByLabel('Local project folder').fill(sourceProjectPath)
    await dialog.getByRole('button', { name: 'Find files', exact: true }).click()

    const selectedUntracked = dialog.getByRole('checkbox', { name: /selected-untracked\.txt/u })
    const selectedIgnored = dialog.getByRole('checkbox', { name: /selected-ignored\.txt/u })
    const unselected = dialog.getByRole('checkbox', { name: /unselected\.txt/u })
    await expect(selectedUntracked).toBeVisible()
    await expect(selectedIgnored).toBeVisible()
    await expect(unselected).toBeVisible()
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
  const directory = runtimeDirectorySchema.parse(await call('list'))
  const host = directory.hosts.find(item => item.name === scratchRemoteName)
  if (host === undefined) throw new Error('The saved scratch SSH host was not listed by the manager DSH.')
  const runtime = directory.runtimes.find(item => item.hostId === host.id)
  if (runtime === undefined) throw new Error('The scratch SSH host did not register a remote DSH runtime.')

  await writeFile(join(pair.remote.homeRoot, 'remote-composer-reference.txt'), 'remote attachment references belong to the owning Host.\n')
  const created = threadCreateSchema.parse(await call('threadCreate', { runtimeId: runtime.id, cwd: pair.remote.homeRoot }))
  if (!created.ok) throw new Error(`The empty remote thread could not be created: ${created.code}.`)
  const sessionId = created.sessionId
  const transcript = transcriptSchema.parse(await call('threadTranscript', { runtimeId: runtime.id, sessionId }))
  if (!transcript.ok) throw new Error(`The remote thread transcript could not be read: ${transcript.code}.`)
  expect(transcript.entries).toEqual([])
  const sessions = nativeSessionListSchema.parse(
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

When('the remote composer resolves @file suggestions on SSH', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const observation = observations.get(page)
  if (observation === undefined) throw new Error('The remote thread journey did not produce an observation.')
  const call = await hostApi(pair.manager)
  const ownership = sessionRuntimeSchema.parse(await call('sessionRuntime', { sessionId: observation.sessionId }))
  if (!ownership.ok) throw new Error(`The owning runtime could not be resolved: ${ownership.code}.`)
  expect(ownership.runtimeId).toBe(observation.runtimeId)
  const result = fileReferencesSchema.parse(
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
  const result = fileUploadSchema.parse(
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
  const readyBeforeDrop = runtimePingSchema.parse(await call('runtimePing', { runtimeId: observation.runtimeId }))
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
    tunnelProcessDetails.parentProcessId !== managerProcessId ||
    tunnelProcessDetails.processGroupId !== managerProcessId ||
    !isProcessRunning(tunnelProcessId)
  ) {
    throw new Error('Refusing to signal a process not owned by the manager DSH tunnel fixture.')
  }
  process.kill(tunnelProcessId, 'SIGKILL')
  for (let attempt = 0; attempt < 100 && isProcessRunning(tunnelProcessId); attempt += 1) await delay(25)
  expect(isProcessRunning(tunnelProcessId)).toBe(false)

  const readyAfterDrop = runtimePingSchema.parse(await call('runtimePing', { runtimeId: observation.runtimeId }))
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
    recoveredTunnelProcessDetails.parentProcessId !== managerProcessId ||
    recoveredTunnelProcessDetails.processGroupId !== managerProcessId ||
    !isProcessRunning(recoveredTunnelProcessRecord.processId)
  ) {
    throw new Error('The restarted SSH tunnel process was not owned by the manager DSH.')
  }

  const reconnect = runtimeReconnectSchema.parse(await call('runtimeReconnect', { runtimeId: observation.runtimeId }))
  if (!reconnect.ok) throw new Error(`The scratch SSH tunnel did not reconnect: ${reconnect.code}.`)
  const pingAfterReconnect = runtimePingSchema.parse(await call('runtimePing', { runtimeId: observation.runtimeId }))
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
    const result = connectionTestSchema.parse(
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
  const sessionsBeforeMutation = nativeSessionListSchema.parse(
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

    const reconnect = runtimeReconnectSchema.parse(await call('runtimeReconnect', { runtimeId: observation.runtimeId }))
    if (!reconnect.ok) throw new Error(`The scratch runtime did not reconnect through the local proxy: ${reconnect.code}.`)
    const mutation = nativeCreateSchema.parse(
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
    const sessions = nativeSessionListSchema.parse(
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
  const actualReconnect = runtimeReconnectSchema.parse(await call('runtimeReconnect', { runtimeId: observation.runtimeId }))
  if (!actualReconnect.ok) throw new Error(`The scratch DSH did not reconnect after proxy cleanup: ${actualReconnect.code}.`)
  const pingAfterProxyCleanup = runtimePingSchema.parse(await call('runtimePing', { runtimeId: observation.runtimeId }))
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
  const directory = runtimeDirectorySchema.parse(await call('list'))
  const host = directory.hosts.find(item => item.name === scratchRemoteName)
  if (host === undefined) throw new Error('The saved scratch SSH host was not listed by the manager DSH.')
  const runtime = directory.runtimes.find(item => item.hostId === host.id)
  if (runtime === undefined) throw new Error('The scratch SSH host did not register a remote DSH runtime.')

  const created = nativeCreateSchema.parse(
    await call('runtimeCall', {
      runtimeId: runtime.id,
      request: { namespace: 'session', method: 'create', args: { request: { cwd: pair.remote.homeRoot } } },
    }),
  )
  if (!created.ok) throw new Error(`The remote session could not be created: ${created.code}.`)
  const sessionId = created.value.sessionId
  const prompted = promptAcceptedSchema.parse(
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
  const listed = remoteThreadListSchema.parse(await call('threadList'))
  expect(listed.threads.some(thread => thread.runtimeId === runtime.id && thread.sessionId === sessionId)).toBe(false)
  inventoryObservations.set(page, { runtimeId: runtime.id, sessionId, startedHere: false, hostName: scratchRemoteName })
})

Then('the manager lists it as started on the host', async ({ page }: { readonly page: Page }) => {
  const pair = pairFor(page)
  const observed = inventoryObservations.get(page)
  if (observed === undefined) throw new Error('The inventory journey did not observe a remote-started thread.')
  const call = await hostApi(pair.manager)
  const directory = runtimeDirectorySchema.parse(await call('list'))
  const hostName = observed.hostName
  // The Host answers `runtime-status-refreshing` while its first snapshot loads asynchronously, so one call is not a verdict.
  let status = inventoryStatusSchema.parse(await call('runtimeStatus', { runtimeId: observed.runtimeId }))
  for (let attempt = 0; attempt < 40 && !status.ok && status.code === 'runtime-status-refreshing'; attempt += 1) {
    await delay(500)
    status = inventoryStatusSchema.parse(await call('runtimeStatus', { runtimeId: observed.runtimeId }))
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
