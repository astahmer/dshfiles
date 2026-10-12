import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { JjExecutor } from './jj.js'
import type { CleanupPolicy } from './cleanup.js'
import { createJjIntegrationService, type JjIntegrationService } from './service.js'
import { jjIntegrationStateSchema } from './types.js'

const day = 86_400_000
const policy: CleanupPolicy = { enabled: true, idleAfterMs: day, deleteAfterMs: 7 * day, dryRun: false }
const temporaryRoots: string[] = []
let jjConfigPath: string | undefined

const ensureJjConfig = async (): Promise<string> => {
  if (jjConfigPath !== undefined) return jjConfigPath
  const root = await mkdtemp(join(tmpdir(), 'jjclean-config-'))
  temporaryRoots.push(root)
  jjConfigPath = join(root, 'config.toml')
  await writeFile(jjConfigPath, '[user]\nname = "Cleanup Test"\nemail = "cleanup@example.com"\n', { mode: 0o600 })
  return jjConfigPath
}

const runJj = async (cwd: string, args: readonly string[]) => {
  const config = await ensureJjConfig()
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(resolve => {
    execFile(
      'jj',
      ['--color=never', '--no-pager', ...args],
      { cwd, env: { ...process.env, JJ_CONFIG: config }, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr })
      },
    )
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

const createFixture = async (): Promise<Fixture> => {
  const root = await temporaryDirectory('jjclean-repo-')
  const repo = join(root, 'repo')
  await jjOrThrow(root, ['git', 'init', repo])
  await writeFile(join(repo, 'base.txt'), 'base\n')
  await jjOrThrow(repo, ['describe', '-m', 'base'])
  const base = (await jjOrThrow(repo, ['log', '-r', '@', '--no-graph', '-T', 'commit_id'])).trim()
  await jjOrThrow(repo, ['bookmark', 'create', 'integration-spine', '-r', base])
  await jjOrThrow(repo, ['new'])
  const statePath = join(await temporaryDirectory('jjclean-state-'), 'state.json')
  const workspacePath = join(await temporaryDirectory('jjclean-ws-'), 'thread-a')
  await jjOrThrow(repo, ['workspace', 'add', workspacePath, '--name', 'thread-a'])
  const service = createJjIntegrationService({ executor, options: { statePath, spineBookmark: 'integration-spine' } })
  const workspace = await service.registerWorkspace({ path: workspacePath, sessionId: 'session-a', source: 'session-cwd', isolated: true })
  // A finished thread: the Session detached, which is when the idle clock starts.
  await service.detachSession(workspace.id, 'session-a')
  return { repo, statePath, service, workspacePath, workspaceId: workspace.id }
}

/** Age the recorded activity, which is the only thing cleanup counts. */
const ageWorkspace = async (statePath: string, workspaceId: string, ageMs: number): Promise<void> => {
  const state = jjIntegrationStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
  state.workspaces = state.workspaces.map(workspace => (workspace.id === workspaceId ? { ...workspace, lastActivityAt: Date.now() - ageMs } : workspace))
  await writeFile(statePath, JSON.stringify(state))
}

const workspaceNames = async (repo: string): Promise<readonly string[]> =>
  (await jjOrThrow(repo, ['workspace', 'list', '--ignore-working-copy', '-T', 'name ++ "\\n"'])).split('\n').filter(line => line.length > 0)

const directoryExists = async (path: string): Promise<boolean> =>
  readFile(join(path, 'base.txt'))
    .then(() => true)
    .catch(() => false)

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workspace cleanup (real jj repositories)', () => {
  it('removes an idle thread workspace and nothing else, and is idempotent', async () => {
    const fixture = await createFixture()
    await ageWorkspace(fixture.statePath, fixture.workspaceId, 8 * day)

    const preview = await fixture.service.cleanupReport({ policy })
    expect(preview.eligible.map(entry => entry.workspaceId)).toEqual([fixture.workspaceId])
    expect(preview.reclaimableBytes).toBeGreaterThanOrEqual(0)

    const report = await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    expect(report.removed.map(entry => entry.workspaceId)).toEqual([fixture.workspaceId])
    expect(report.failed).toEqual([])
    expect(await directoryExists(fixture.workspacePath)).toBe(false)
    expect(await workspaceNames(fixture.repo)).not.toContain('thread-a')
    expect(await fixture.service.listWorkspaces()).toEqual([])

    // Running again must not fail and must not report a removal.
    const again = await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    expect(again.removed).toEqual([])
    expect(again.failed).toEqual([])
  })

  it('never removes a workspace that holds revisions the spine does not', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.workspacePath, 'work.txt'), 'work\n')
    await jjOrThrow(fixture.workspacePath, ['describe', '-m', 'unintegrated work'])
    // A clean working copy over a described commit: content outside the spine
    // that is not "uncommitted" either.
    await jjOrThrow(fixture.workspacePath, ['new'])
    await ageWorkspace(fixture.statePath, fixture.workspaceId, 8 * day)

    const report = await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    expect(report.removed).toEqual([])
    expect(report.skipped.find(entry => entry.workspaceId === fixture.workspaceId)?.code).toBe('unique-revisions')
    expect(await directoryExists(fixture.workspacePath)).toBe(true)
  })

  it('never removes a workspace with uncommitted changes', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.workspacePath, 'scratch.txt'), 'uncommitted\n')
    await ageWorkspace(fixture.statePath, fixture.workspaceId, 8 * day)

    const report = await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    expect(report.skipped.find(entry => entry.workspaceId === fixture.workspaceId)?.code).toBe('uncommitted')
    expect(await directoryExists(fixture.workspacePath)).toBe(true)
  })

  it('never removes a workspace with an open integration candidate', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.workspacePath, 'candidate.txt'), 'candidate\n')
    await jjOrThrow(fixture.workspacePath, ['describe', '-m', 'candidate work'])
    await fixture.service.markReady(fixture.workspaceId, 'session-a')
    await fixture.service.submitCandidate({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })
    await ageWorkspace(fixture.statePath, fixture.workspaceId, 8 * day)

    const report = await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    expect(report.removed).toEqual([])
    expect(report.skipped.find(entry => entry.workspaceId === fixture.workspaceId)?.code).toBe('pending-integration')
    expect(await directoryExists(fixture.workspacePath)).toBe(true)
  })

  it('never removes a workspace whose lease is still recorded, stale or not', async () => {
    const fixture = await createFixture()
    await fixture.service.acquireWriter({ workspaceId: fixture.workspaceId, sessionId: 'session-a' })
    // A crashed writer: the Session is gone, the lease record remains.
    await fixture.service.detachSession(fixture.workspaceId, 'session-a')
    await ageWorkspace(fixture.statePath, fixture.workspaceId, 8 * day)

    const report = await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    expect(report.skipped.find(entry => entry.workspaceId === fixture.workspaceId)?.code).toBe('leased')
    expect(await directoryExists(fixture.workspacePath)).toBe(true)
  })

  it('honours a pin and a dry run', async () => {
    const fixture = await createFixture()
    await ageWorkspace(fixture.statePath, fixture.workspaceId, 8 * day)

    const dry = await fixture.service.cleanupWorkspaces({ policy, dryRun: true })
    expect(dry.eligible.map(entry => entry.workspaceId)).toEqual([fixture.workspaceId])
    expect(dry.removed).toEqual([])
    expect(await directoryExists(fixture.workspacePath)).toBe(true)

    await fixture.service.setWorkspacePinned(fixture.workspaceId, true)
    const pinned = await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    expect(pinned.skipped.find(entry => entry.workspaceId === fixture.workspaceId)?.code).toBe('pinned')
    expect(await directoryExists(fixture.workspacePath)).toBe(true)

    await fixture.service.setWorkspacePinned(fixture.workspaceId, false)
    const unpinned = await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    expect(unpinned.removed.map(entry => entry.workspaceId)).toEqual([fixture.workspaceId])
  })

  it('leaves a registration alone when its directory disappeared, and still removes nothing', async () => {
    const fixture = await createFixture()
    await rm(fixture.workspacePath, { recursive: true, force: true })
    await ageWorkspace(fixture.statePath, fixture.workspaceId, 8 * day)

    const report = await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    expect(report.removed).toEqual([])
    expect(report.skipped.find(entry => entry.workspaceId === fixture.workspaceId)?.code).toBe('missing')
  })

  it('does not clean while cleanup is disabled', async () => {
    const fixture = await createFixture()
    await ageWorkspace(fixture.statePath, fixture.workspaceId, 30 * day)

    const report = await fixture.service.cleanupWorkspaces({ policy: { ...policy, enabled: false }, dryRun: false })
    expect(report.removed).toEqual([])
    expect(report.eligible).toEqual([])
    expect(report.skipped.find(entry => entry.workspaceId === fixture.workspaceId)?.code).toBe('disabled')
    expect(await directoryExists(fixture.workspacePath)).toBe(true)
  })

  it('records a cleanup event for the activity timeline', async () => {
    const fixture = await createFixture()
    await ageWorkspace(fixture.statePath, fixture.workspaceId, 8 * day)
    await fixture.service.cleanupWorkspaces({ policy, dryRun: false })
    const events = await fixture.service.listEvents(50)
    expect(events.some(event => event.type === 'workspace.cleaned')).toBe(true)
  })
})
