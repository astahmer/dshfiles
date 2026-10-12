import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { JjExecutor } from './jj.js'
import { decideToolCall, type WorkspaceOwnershipView } from './ownership.js'
import { createJjIntegrationService, type JjIntegrationService } from './service.js'
import { readUnsafeWorkspaces } from './thread-provision.js'

const temporaryRoots: string[] = []
let jjConfigPath: string | undefined

const ensureJjConfig = async (): Promise<string> => {
  if (jjConfigPath !== undefined) return jjConfigPath
  const root = await mkdtemp(join(tmpdir(), 'jjown-config-'))
  temporaryRoots.push(root)
  jjConfigPath = join(root, 'config.toml')
  await writeFile(jjConfigPath, '[user]\nname = "Ownership Test"\nemail = "ownership@example.com"\n', { mode: 0o600 })
  return jjConfigPath
}

const runJj = async (cwd: string, args: readonly string[]) => {
  const config = await ensureJjConfig()
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(resolve => {
    execFile('jj', ['--color=never', '--no-pager', ...args], { cwd, env: { ...process.env, JJ_CONFIG: config }, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr })
    })
  })
}

const jjOrThrow = async (cwd: string, args: readonly string[]): Promise<string> => {
  const result = await runJj(cwd, args)
  if (result.exitCode !== 0) throw new Error(`jj ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

const executor: JjExecutor = async input => runJj(input.cwd, input.args)

const temporaryDirectory = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

interface Fixture {
  readonly repo: string
  readonly statePath: string
  readonly service: JjIntegrationService
  readonly workspacePath: string
  readonly workspaceId: string
}

const createFixture = async (options: { readonly staleWriterMs?: number; readonly integrationMode?: 'auto' | 'manual' | 'off' } = {}): Promise<Fixture> => {
  const root = await temporaryDirectory('jjown-repo-')
  const repo = join(root, 'repo')
  await jjOrThrow(root, ['git', 'init', repo])
  await writeFile(join(repo, 'base.txt'), 'base\n')
  await jjOrThrow(repo, ['describe', '-m', 'base'])
  const base = (await jjOrThrow(repo, ['log', '-r', '@', '--no-graph', '-T', 'commit_id'])).trim()
  await jjOrThrow(repo, ['bookmark', 'create', 'integration-spine', '-r', base])
  await jjOrThrow(repo, ['new'])
  const statePath = join(await temporaryDirectory('jjown-state-'), 'state.json')
  const workspacePath = join(await temporaryDirectory('jjown-ws-'), 'thread-a')
  await jjOrThrow(repo, ['workspace', 'add', workspacePath, '--name', 'thread-a'])
  const service = createJjIntegrationService({
    executor,
    options: {
      statePath,
      spineBookmark: 'integration-spine',
      ...(options.staleWriterMs === undefined ? {} : { staleWriterMs: options.staleWriterMs }),
      ...(options.integrationMode === undefined ? {} : { integrationMode: options.integrationMode }),
    },
  })
  const workspace = await service.registerWorkspace({ path: workspacePath, sessionId: 'session-a', source: 'session-cwd', isolated: true })
  return { repo, statePath, service, workspacePath, workspaceId: workspace.id }
}

const restartService = (fixture: Fixture, options: { readonly staleWriterMs?: number; readonly integrationMode?: 'auto' | 'manual' | 'off' } = {}): JjIntegrationService =>
  createJjIntegrationService({
    executor,
    options: {
      statePath: fixture.statePath,
      spineBookmark: 'integration-spine',
      ...(options.staleWriterMs === undefined ? {} : { staleWriterMs: options.staleWriterMs }),
      ...(options.integrationMode === undefined ? {} : { integrationMode: options.integrationMode }),
    },
  })

const ownershipView = async (service: JjIntegrationService, path: string): Promise<WorkspaceOwnershipView> => {
  const found = await service.ownershipForPath(path)
  if (found === undefined) throw new Error('workspace is not registered')
  return found.view
}

const decide = (view: WorkspaceOwnershipView, sessionId: string, toolName: string, heldEpoch: number | null, now: number, staleAfterMs: number) =>
  decideToolCall({ workspace: view, sessionId, toolName, heldEpoch, now, staleAfterMs, readOnlyTools: ['read', 'grep'] })

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workspace writer ownership (real jj repositories)', () => {
  it('keeps exactly one writer and refuses a second claimant', async () => {
    const fixture = await createFixture()
    const first = await fixture.service.acquireWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })
    expect(first.writerLease).toMatchObject({ sessionId: 'session-a', epoch: 1 })

    await expect(fixture.service.acquireWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-b' })).rejects.toMatchObject({ code: 'writer-held' })

    // The holder keeps working; a release lets the next session in with a new epoch.
    const released = await fixture.service.releaseWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })
    expect(released.writerLease).toBe(null)
    expect(released.writerEpoch).toBe(2)
    const second = await fixture.service.acquireWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-b' })
    expect(second.writerLease).toMatchObject({ sessionId: 'session-b', epoch: 3 })
  })

  it('refuses a release from a session that does not hold the lease', async () => {
    const fixture = await createFixture()
    await fixture.service.acquireWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })
    await expect(fixture.service.releaseWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-b' })).rejects.toMatchObject({ code: 'writer-held' })
  })

  it('reclaims a stale lease and fences its previous holder', async () => {
    const fixture = await createFixture({ staleWriterMs: 40 })
    await fixture.service.acquireWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })
    await new Promise(resolveWait => setTimeout(resolveWait, 80))
    const reclaimed = await fixture.service.acquireWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-b' })
    expect(reclaimed.writerLease).toMatchObject({ sessionId: 'session-b', epoch: 2 })

    const view = await ownershipView(fixture.service, fixture.workspacePath)
    expect(decide(view, 'session-a', 'write', 1, Date.now(), 40)).toMatchObject({ kind: 'deny', code: 'writer-fenced' })
    expect(decide(view, 'session-b', 'write', 2, Date.now(), 40)).toEqual({ kind: 'allow' })
  })

  it('blocks a live transfer until it is acknowledged, then fences the old writer and keeps it as an observer', async () => {
    const fixture = await createFixture()
    await fixture.service.acquireWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })
    await expect(
      fixture.service.transferWriter({ workspaceId: fixture.workspaceId, toSessionId: 'session-b', acknowledgeStopped: false }),
    ).rejects.toMatchObject({ code: 'writer-held' })

    const transferred = await fixture.service.transferWriter({ workspaceId: fixture.workspaceId, toSessionId: 'session-b', acknowledgeStopped: true })
    expect(transferred.writerLease).toMatchObject({ sessionId: 'session-b', epoch: 2 })
    expect(transferred.observers.map(observer => observer.sessionId)).toEqual(['session-a'])

    const view = await ownershipView(fixture.service, fixture.workspacePath)
    expect(decide(view, 'session-a', 'write', 1, Date.now(), 60_000)).toMatchObject({ kind: 'deny', code: 'writer-fenced' })
    expect(decide(view, 'session-a', 'read', 1, Date.now(), 60_000)).toEqual({ kind: 'allow' })
    expect(decide(view, 'session-b', 'write', 2, Date.now(), 60_000)).toEqual({ kind: 'allow' })
  })

  it('survives a restart: the lease is durable, and a disposed session releases it', async () => {
    const fixture = await createFixture()
    await fixture.service.acquireWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })

    const restarted = restartService(fixture)
    const view = await ownershipView(restarted, fixture.workspacePath)
    expect(decide(view, 'session-b', 'write', null, Date.now(), 60_000)).toMatchObject({ kind: 'deny', code: 'writer-held' })

    const released = await restarted.releaseWriterForSession('session-a')
    expect(released).toEqual([fixture.workspaceId])
    const after = await ownershipView(restarted, fixture.workspacePath)
    expect(decide(after, 'session-b', 'write', null, Date.now(), 60_000)).toEqual({ kind: 'acquire', reclaim: false })
  })

  it('does not enforce ownership on a discovered workspace', async () => {
    const fixture = await createFixture()
    const discoveredPath = join(await temporaryDirectory('jjown-ws-'), 'discovered')
    await jjOrThrow(fixture.repo, ['workspace', 'add', discoveredPath, '--name', 'discovered'])
    const discovered = await fixture.service.registerWorkspace({ path: discoveredPath, sessionId: 'session-other', source: 'session-cwd' })
    expect(discovered.isolated).toBe(false)
    await fixture.service.acquireWriter({ workspaceId: discovered.id, sessionId: 'session-a' })
    const view = await ownershipView(fixture.service, discoveredPath)
    expect(decide(view, 'session-elsewhere', 'write', null, Date.now(), 60_000)).toEqual({ kind: 'allow' })
  })

  it('quarantines a workspace the guard recorded as a folded checkout', async () => {
    const fixture = await createFixture()
    await mkdir(join(fixture.repo, '.jj', 'repo'), { recursive: true })
    await writeFile(join(fixture.repo, '.jj', 'repo', 'jj-isolation-unsafe.json'), JSON.stringify({ unavailableForNewWork: ['thread-a'] }))
    expect(readUnsafeWorkspaces(fixture.repo)).toEqual(['thread-a'])

    const view = await ownershipView(fixture.service, fixture.workspacePath)
    expect(view.unsafe).toBe(true)
    expect(decide(view, 'session-a', 'read', null, Date.now(), 60_000)).toEqual({ kind: 'allow' })
    expect(decide(view, 'session-a', 'bash', null, Date.now(), 60_000)).toMatchObject({ kind: 'deny', code: 'unsafe-workspace' })
  })
})

describe('integration configuration and eligibility', () => {
  it('refuses every coordinator run when integration is off', async () => {
    const fixture = await createFixture({ integrationMode: 'off' })
    await writeFile(join(fixture.workspacePath, 'work.txt'), 'work\n')
    await jjOrThrow(fixture.workspacePath, ['describe', '-m', 'work'])
    await expect(fixture.service.submitCandidate({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })).rejects.toMatchObject({
      code: 'integration-disabled',
    })
  })

  it('reads the lease and quarantine at the service level, not only in the gate', async () => {
    const fixture = await createFixture()
    await mkdir(join(fixture.repo, '.jj', 'repo'), { recursive: true })
    await writeFile(join(fixture.repo, '.jj', 'repo', 'jj-isolation-unsafe.json'), JSON.stringify({ unavailableForNewWork: ['thread-a'] }))
    await writeFile(join(fixture.workspacePath, 'work.txt'), 'work\n')
    await jjOrThrow(fixture.workspacePath, ['describe', '-m', 'work'])
    await expect(fixture.service.submitCandidate({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })).rejects.toMatchObject({
      code: 'unsafe-workspace',
    })
  })

  it('marks a workspace ready explicitly and leaves an unmarked workspace queued only on request', async () => {
    const fixture = await createFixture()
    const types: string[] = []
    const observing = createJjIntegrationService({
      executor,
      options: { statePath: fixture.statePath, spineBookmark: 'integration-spine', onEvent: event => types.push(event.type) },
    })
    await writeFile(join(fixture.workspacePath, 'work.txt'), 'work\n')
    await jjOrThrow(fixture.workspacePath, ['describe', '-m', 'work'])

    // Queueing is explicit; nothing integrates because a turn ended.
    const candidate = await observing.submitCandidate({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })
    expect(candidate.state).toBe('queued')
    expect(types).toContain('integration.queued')
    expect(types).not.toContain('workspace.ready')

    await observing.markReady(fixture.workspaceId, 'session-a')
    expect(types).toContain('workspace.ready')

    const run = await observing.runCandidate({ candidateId: candidate.id, sessionId: 'session-a' })
    expect(run.outcome).toBe('integrated')
    expect(types).toContain('integration.completed')
  })

  it('keeps the spine unchanged and blocks the candidate when the source is quarantined after queueing', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.workspacePath, 'work.txt'), 'work\n')
    await jjOrThrow(fixture.workspacePath, ['describe', '-m', 'work'])
    const candidate = await fixture.service.submitCandidate({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })
    const spineBefore = (await jjOrThrow(fixture.repo, ['log', '-r', 'integration-spine', '--no-graph', '-T', 'commit_id'])).trim()

    await mkdir(join(fixture.repo, '.jj', 'repo'), { recursive: true })
    await writeFile(join(fixture.repo, '.jj', 'repo', 'jj-isolation-unsafe.json'), JSON.stringify({ unavailableForNewWork: ['thread-a'] }))

    const run = await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-a' })
    expect(run.outcome).toBe('blocked')
    const spineAfter = (await jjOrThrow(fixture.repo, ['log', '-r', 'integration-spine', '--no-graph', '-T', 'commit_id'])).trim()
    expect(spineAfter).toBe(spineBefore)
  })
})
