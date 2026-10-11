import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { JjExecutor } from './jj.js'
import { createJjIntegrationService, type JjIntegrationService } from './service.js'

interface JjResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const temporaryRoots: string[] = []
let jjConfigPath: string | undefined

const ensureJjConfig = async (): Promise<string> => {
  if (jjConfigPath !== undefined) return jjConfigPath
  const root = await mkdtemp(join(tmpdir(), 'jjint-config-'))
  temporaryRoots.push(root)
  jjConfigPath = join(root, 'config.toml')
  await writeFile(jjConfigPath, '[user]\nname = "Integration Test"\nemail = "integration@example.com"\n', { mode: 0o600 })
  return jjConfigPath
}

const runJj = async (cwd: string, args: readonly string[]): Promise<JjResult> => {
  const config = await ensureJjConfig()
  return new Promise(resolve => {
    execFile(
      'jj',
      ['--color=never', '--no-pager', ...args],
      { cwd, env: { ...process.env, JJ_CONFIG: config }, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ exitCode, stdout, stderr })
      },
    )
  })
}

const jjOrThrow = async (cwd: string, args: readonly string[]): Promise<string> => {
  const result = await runJj(cwd, args)
  if (result.exitCode !== 0) throw new Error(`jj ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

const executor: JjExecutor = async input => {
  const result = await runJj(input.cwd, input.args)
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

const commandExecutor = async (input: { readonly command: string; readonly cwd: string }): Promise<JjResult> => {
  return new Promise(resolve => {
    execFile('/bin/sh', ['-c', input.command], { cwd: input.cwd, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr })
    })
  })
}

const temporaryDirectory = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

interface Fixture {
  readonly repo: string
  readonly statePath: string
  readonly service: JjIntegrationService
  readonly spine: string
}

const createFixture = async (options: { readonly validationCommand?: string } = {}): Promise<Fixture> => {
  const root = await temporaryDirectory('jjint-repo-')
  const repo = join(root, 'repo')
  await jjOrThrow(root, ['git', 'init', repo])
  await writeFile(join(repo, 'base.txt'), 'base\n')
  await jjOrThrow(repo, ['describe', '-m', 'base'])
  const base = (await jjOrThrow(repo, ['log', '-r', '@', '--no-graph', '-T', 'commit_id'])).trim()
  await jjOrThrow(repo, ['bookmark', 'create', 'integration-spine', '-r', base])
  await jjOrThrow(repo, ['new'])
  const statePath = join(await temporaryDirectory('jjint-state-'), 'state.json')
  const service = createJjIntegrationService({
    executor,
    executeCommand: commandExecutor,
    options: {
      statePath,
      spineBookmark: 'integration-spine',
      ...(options.validationCommand === undefined ? {} : { validationCommand: options.validationCommand }),
    },
  })
  return { repo, statePath, service, spine: 'integration-spine' }
}

const addAgentWorkspace = async (fixture: Fixture, name: string, revision?: string): Promise<string> => {
  const path = join(await temporaryDirectory('jjint-ws-'), name)
  await jjOrThrow(fixture.repo, ['workspace', 'add', path, '--name', name, ...(revision === undefined ? [] : ['-r', revision])])
  return path
}

const headCommit = async (cwd: string): Promise<string> => (await jjOrThrow(cwd, ['log', '-r', '@', '--no-graph', '-T', 'commit_id'])).trim()
const spineDescription = async (fixture: Fixture): Promise<string> => (await jjOrThrow(fixture.repo, ['log', '-r', fixture.spine, '--no-graph', '-T', 'description.first_line()'])).trim()
const spineCommit = async (fixture: Fixture): Promise<string> => (await jjOrThrow(fixture.repo, ['log', '-r', fixture.spine, '--no-graph', '-T', 'commit_id'])).trim()

const commitWork = async (path: string, file: string, content: string, description: string): Promise<void> => {
  await writeFile(join(path, file), content)
  await jjOrThrow(path, ['describe', '-m', description])
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('jj integration coordination (real jj repositories)', () => {
  it('registers a workspace and records its owning session', async () => {
    const fixture = await createFixture()
    const workspacePath = await addAgentWorkspace(fixture, 'ws-owner')
    const workspace = await fixture.service.registerWorkspace({ path: workspacePath, sessionId: 'session-owner', source: 'agent-tool' })

    expect(workspace.path).toBe(workspacePath)
    expect(workspace.currentRevision).not.toBeNull()
    expect(workspace.owners).toMatchObject([{ sessionId: 'session-owner', detachedAt: null, source: 'agent-tool' }])
    expect(workspace.lifecycle).toBe('active')
  })

  it('integrates two independent workspaces sequentially', async () => {
    const fixture = await createFixture()
    const firstPath = await addAgentWorkspace(fixture, 'ws-first')
    await commitWork(firstPath, 'first.txt', 'first\n', 'first work')
    const firstWorkspace = await fixture.service.registerWorkspace({ path: firstPath, sessionId: 'session-first', source: 'agent-tool' })
    const firstCandidate = await fixture.service.submitCandidate({ workspaceId: firstWorkspace.id, sessionId: 'session-first' })
    const firstRun = await fixture.service.runCandidate({ candidateId: firstCandidate.id, sessionId: 'session-first' })
    expect(firstRun.outcome).toBe('integrated')

    const secondPath = await addAgentWorkspace(fixture, 'ws-second')
    await commitWork(secondPath, 'second.txt', 'second\n', 'second work')
    const secondWorkspace = await fixture.service.registerWorkspace({ path: secondPath, sessionId: 'session-second', source: 'agent-tool' })
    const secondCandidate = await fixture.service.submitCandidate({ workspaceId: secondWorkspace.id, sessionId: 'session-second' })
    const secondRun = await fixture.service.runCandidate({ candidateId: secondCandidate.id, sessionId: 'session-second' })
    expect(secondRun.outcome).toBe('integrated')

    expect(await spineDescription(fixture)).toBe('second work')
    const history = await jjOrThrow(fixture.repo, ['log', '-r', `::${fixture.spine}`, '--no-graph', '-T', 'description.first_line() ++ "\\n"'])
    expect(history).toContain('first work')
    expect(history).toContain('base')
  })

  it('integrates work started from an older canonical revision', async () => {
    const fixture = await createFixture()
    const base = (await jjOrThrow(fixture.repo, ['log', '-r', '@', '--no-graph', '-T', 'commit_id'])).trim()
    const agentPath = await addAgentWorkspace(fixture, 'ws-old-base', base)
    await commitWork(agentPath, 'agent.txt', 'agent\n', 'agent from old base')

    await jjOrThrow(fixture.repo, ['new', base])
    await commitWork(fixture.repo, 'canonical.txt', 'canonical\n', 'canonical advance')
    const canonical = await headCommit(fixture.repo)
    await jjOrThrow(fixture.repo, ['bookmark', 'set', fixture.spine, '-r', canonical, '--allow-backwards'])
    await jjOrThrow(fixture.repo, ['new'])

    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-old', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-old' })
    const run = await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-old' })
    expect(run.outcome).toBe('integrated')
    expect(await spineDescription(fixture)).toBe('agent from old base')
    const parents = await jjOrThrow(fixture.repo, ['log', '-r', `${fixture.spine}-`, '--no-graph', '-T', 'description.first_line()'])
    expect(parents).toContain('canonical advance')
  })

  it('integrates overlapping but non-conflicting changes cleanly', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.repo, 'shared.txt'), 'one\ntwo\nthree\n')
    await jjOrThrow(fixture.repo, ['describe', '-m', 'shared base'])
    const sharedBase = await headCommit(fixture.repo)
    await jjOrThrow(fixture.repo, ['bookmark', 'set', fixture.spine, '-r', sharedBase, '--allow-backwards'])
    const agentPath = await addAgentWorkspace(fixture, 'ws-overlap', sharedBase)
    await commitWork(agentPath, 'shared.txt', 'one\ntwo\nthree\nagent line\n', 'agent appends')

    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-overlap', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-overlap' })

    await jjOrThrow(fixture.repo, ['new', sharedBase])
    await commitWork(fixture.repo, 'shared.txt', 'canonical line\none\ntwo\nthree\n', 'canonical prepends')
    await jjOrThrow(fixture.repo, ['bookmark', 'set', fixture.spine, '-r', await headCommit(fixture.repo), '--allow-backwards'])
    await jjOrThrow(fixture.repo, ['new'])

    const preview = await fixture.service.inspectCandidate(candidate.id)
    expect(preview.overlappingFiles).toContain('shared.txt')
    const run = await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-overlap' })
    expect(run.outcome).toBe('integrated')
  })

  it('blocks a conflicting candidate without advancing the spine or touching the source workspace', async () => {
    const fixture = await createFixture()
    await writeFile(join(fixture.repo, 'shared.txt'), 'base\n')
    await jjOrThrow(fixture.repo, ['describe', '-m', 'shared base'])
    const sharedBase = await headCommit(fixture.repo)
    await jjOrThrow(fixture.repo, ['bookmark', 'set', fixture.spine, '-r', sharedBase, '--allow-backwards'])
    const agentPath = await addAgentWorkspace(fixture, 'ws-conflict', sharedBase)
    await commitWork(agentPath, 'shared.txt', 'agent version\n', 'agent changes shared')
    const agentHeadBefore = await headCommit(agentPath)

    await jjOrThrow(fixture.repo, ['new', sharedBase])
    await commitWork(fixture.repo, 'shared.txt', 'canonical version\n', 'canonical changes shared')
    const canonical = await headCommit(fixture.repo)
    await jjOrThrow(fixture.repo, ['bookmark', 'set', fixture.spine, '-r', canonical, '--allow-backwards'])
    await jjOrThrow(fixture.repo, ['new'])

    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-conflict', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-conflict' })
    const run = await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-conflict' })

    expect(run.outcome).toBe('blocked')
    expect(run.candidate.conflict?.files).toContain('shared.txt')
    expect(await spineCommit(fixture)).toBe(canonical)
    expect(await headCommit(agentPath)).toBe(agentHeadBefore)
  })

  it('marks a candidate stale when the source revision evolves after queueing', async () => {
    const fixture = await createFixture()
    const agentPath = await addAgentWorkspace(fixture, 'ws-stale')
    await commitWork(agentPath, 'work.txt', 'v1\n', 'work v1')
    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-stale', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-stale' })

    await writeFile(join(agentPath, 'work.txt'), 'v2\n')
    await jjOrThrow(agentPath, ['describe', '-m', 'work v2'])

    const spineBefore = await spineCommit(fixture)
    const run = await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-stale' })
    expect(run.outcome).toBe('stale')
    expect(await spineCommit(fixture)).toBe(spineBefore)
  })

  it('detects an already integrated candidate and does not duplicate it', async () => {
    const fixture = await createFixture()
    const agentPath = await addAgentWorkspace(fixture, 'ws-repeat')
    await commitWork(agentPath, 'repeat.txt', 'once\n', 'repeat work')
    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-repeat', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-repeat' })
    expect((await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-repeat' })).outcome).toBe('integrated')
    const spineAfterFirst = await spineCommit(fixture)
    const second = await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-repeat' })
    expect(second.outcome).toBe('already-integrated')
    expect(await spineCommit(fixture)).toBe(spineAfterFirst)
  })

  it('leaves the canonical spine unchanged when validation fails', async () => {
    const fixture = await createFixture({ validationCommand: 'exit 3' })
    const agentPath = await addAgentWorkspace(fixture, 'ws-validation')
    await commitWork(agentPath, 'validated.txt', 'work\n', 'needs validation')
    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-validation', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-validation' })
    const spineBefore = await spineCommit(fixture)
    const run = await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-validation' })
    expect(run.outcome).toBe('failed')
    expect(run.candidate.validation).toMatchObject({ kind: 'command', exitCode: 3 })
    expect(await spineCommit(fixture)).toBe(spineBefore)
  })

  it('serializes concurrent integration requests without corrupting the spine', async () => {
    const fixture = await createFixture()
    const firstPath = await addAgentWorkspace(fixture, 'ws-concurrent-a')
    await commitWork(firstPath, 'a.txt', 'a\n', 'concurrent a')
    const secondPath = await addAgentWorkspace(fixture, 'ws-concurrent-b')
    await commitWork(secondPath, 'b.txt', 'b\n', 'concurrent b')
    const firstWorkspace = await fixture.service.registerWorkspace({ path: firstPath, sessionId: 'session-a', source: 'agent-tool' })
    const secondWorkspace = await fixture.service.registerWorkspace({ path: secondPath, sessionId: 'session-b', source: 'agent-tool' })
    const first = await fixture.service.submitCandidate({ workspaceId: firstWorkspace.id, sessionId: 'session-a' })
    const second = await fixture.service.submitCandidate({ workspaceId: secondWorkspace.id, sessionId: 'session-b' })

    const results = await Promise.all([
      fixture.service.runCandidate({ candidateId: first.id, sessionId: 'session-a' }),
      fixture.service.runCandidate({ candidateId: second.id, sessionId: 'session-b' }),
    ])
    expect(results.map(result => result.outcome).sort()).toEqual(['integrated', 'integrated'])
    const history = await jjOrThrow(fixture.repo, ['log', '-r', `::${fixture.spine}`, '--no-graph', '-T', 'description.first_line() ++ "\\n"'])
    expect(history).toContain('concurrent a')
    expect(history).toContain('concurrent b')
  })

  it('orders explicit dependencies before their dependents', async () => {
    const fixture = await createFixture()
    const firstPath = await addAgentWorkspace(fixture, 'ws-dep-first')
    await commitWork(firstPath, 'dep-a.txt', 'a\n', 'dependency a')
    const secondPath = await addAgentWorkspace(fixture, 'ws-dep-second')
    await commitWork(secondPath, 'dep-b.txt', 'b\n', 'dependent b')
    const firstWorkspace = await fixture.service.registerWorkspace({ path: firstPath, sessionId: 'session-dep-a', source: 'agent-tool' })
    const secondWorkspace = await fixture.service.registerWorkspace({ path: secondPath, sessionId: 'session-dep-b', source: 'agent-tool' })
    const first = await fixture.service.submitCandidate({ workspaceId: firstWorkspace.id, sessionId: 'session-dep-a' })
    const second = await fixture.service.submitCandidate({ workspaceId: secondWorkspace.id, sessionId: 'session-dep-b', dependsOn: [first.id] })

    const blocked = await fixture.service.runCandidate({ candidateId: second.id, sessionId: 'session-dep-b' })
    expect(blocked.outcome).toBe('blocked')
    expect((await fixture.service.runCandidate({ candidateId: first.id, sessionId: 'session-dep-a' })).outcome).toBe('integrated')
    expect((await fixture.service.runCandidate({ candidateId: second.id, sessionId: 'session-dep-b' })).outcome).toBe('integrated')
    expect(await spineDescription(fixture)).toBe('dependent b')
  })

  it('recovers after a coordinator restart', async () => {
    const fixture = await createFixture()
    const agentPath = await addAgentWorkspace(fixture, 'ws-restart')
    await commitWork(agentPath, 'restart.txt', 'work\n', 'restart work')
    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-restart', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-restart' })

    const restarted = createJjIntegrationService({
      executor,
      executeCommand: commandExecutor,
      options: { statePath: fixture.statePath, spineBookmark: 'integration-spine' },
    })
    const recovered = await restarted.listCandidates()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.id).toBe(candidate.id)
    expect((await restarted.runCandidate({ candidateId: candidate.id, sessionId: 'session-restart' })).outcome).toBe('integrated')
  })

  it('refuses to queue an empty source revision instead of advancing the spine', async () => {
    const fixture = await createFixture()
    const agentPath = await addAgentWorkspace(fixture, 'ws-empty')
    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-empty', source: 'agent-tool' })
    const spineBefore = await spineCommit(fixture)
    await expect(fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-empty' })).rejects.toMatchObject({
      code: 'empty-revision',
    })
    expect(await fixture.service.listCandidates()).toHaveLength(0)
    expect(await spineCommit(fixture)).toBe(spineBefore)
  })

  it('records the exact validated revision in the validation receipt', async () => {
    const fixture = await createFixture({ validationCommand: 'exit 0' })
    const agentPath = await addAgentWorkspace(fixture, 'ws-receipt')
    await commitWork(agentPath, 'receipt.txt', 'work\n', 'receipt work')
    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-receipt', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-receipt' })
    const run = await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-receipt' })
    expect(run.outcome).toBe('integrated')
    expect(run.candidate.validation.kind).toBe('command')
    expect(run.candidate.validation.revision?.commitId).toBe(run.candidate.resultRevision?.commitId)
  })

  it('refuses a second coordinator process that holds the integration lock', async () => {
    const fixture = await createFixture()
    const agentPath = await addAgentWorkspace(fixture, 'ws-lock')
    await commitWork(agentPath, 'lock.txt', 'work\n', 'lock work')
    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-lock', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-lock' })
    const spineBefore = await spineCommit(fixture)
    await writeFile(`${fixture.statePath}.lock`, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { mode: 0o600 })

    await expect(fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-lock' })).rejects.toMatchObject({
      code: 'integration-busy',
    })
    expect(await spineCommit(fixture)).toBe(spineBefore)
  })

  it('handles a missing source workspace without advancing the spine', async () => {    const fixture = await createFixture()
    const agentPath = await addAgentWorkspace(fixture, 'ws-missing')
    await commitWork(agentPath, 'missing.txt', 'work\n', 'missing work')
    const workspace = await fixture.service.registerWorkspace({ path: agentPath, sessionId: 'session-missing', source: 'agent-tool' })
    const candidate = await fixture.service.submitCandidate({ workspaceId: workspace.id, sessionId: 'session-missing' })
    const spineBefore = await spineCommit(fixture)
    await rm(agentPath, { recursive: true, force: true })
    await fixture.service.refreshWorkspace(workspace.id)
    const run = await fixture.service.runCandidate({ candidateId: candidate.id, sessionId: 'session-missing' })
    expect(['failed', 'blocked']).toContain(run.outcome)
    expect(await spineCommit(fixture)).toBe(spineBefore)
  })
})
