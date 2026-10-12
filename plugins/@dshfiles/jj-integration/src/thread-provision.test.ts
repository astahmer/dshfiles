import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JjExecutor } from './jj.js'
import { provisionThreadWorkspace, workspaceNameFor } from './thread-provision.js'

const realJj: JjExecutor = async ({ args, cwd }) => {
  try {
    const stdout = execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return { exitCode: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { exitCode: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

const mkRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'thread-provision-'))
  const repo = join(root, 'repo')
  execFileSync('jj', ['git', 'init', '--no-colocate', repo], { cwd: root, encoding: 'utf8' })
  execFileSync('jj', ['describe', '-m', 'spine'], { cwd: repo, encoding: 'utf8' })
  execFileSync('jj', ['bookmark', 'set', 'integration-spine', '-r', '@'], { cwd: repo, encoding: 'utf8' })
  // Move the default checkout off the spine so the canonical base is not itself a
  // live working copy — the shape the guard requires of any provisioning base.
  execFileSync('jj', ['new', '-m', 'default slot'], { cwd: repo, encoding: 'utf8' })
  return { root, repo, workspaceRoot: join(root, 'workspaces') }
}

const spineCommit = (repo: string) =>
  execFileSync('jj', ['--ignore-working-copy', 'log', '-r', 'integration-spine', '--no-graph', '-T', 'commit_id'], { cwd: repo, encoding: 'utf8' }).trim()

describe('thread workspace provisioning', () => {
  it('gives concurrent threads distinct independent leaves from one frozen base', async () => {
    const { root, repo, workspaceRoot } = mkRepo()
    execFileSync('mkdir', ['-p', workspaceRoot])
    const base = spineCommit(repo)
    const threads = Array.from({ length: 20 }, (_, index) => ({ threadName: `agent ${index}`, sessionId: `session-${index}` }))

    const outcomes = await Promise.all(
      threads.map(thread => provisionThreadWorkspace({ executor: realJj, repoRoot: repo, workspacesDirectory: workspaceRoot, spineRevision: base, ...thread })),
    )
    expect(outcomes.every(outcome => outcome.status === 'created')).toBe(true)
    expect(new Set(outcomes.map(outcome => outcome.workspaceName)).size).toBe(20)

    const heads = execFileSync('jj', ['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\t" ++ target.commit_id() ++ "\\t" ++ target.change_id() ++ "\\n"'], {
      cwd: repo,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => line.split('\t'))
    // default + 20 threads, every target distinct, every base the frozen commit
    expect(heads.length).toBe(21)
    expect(new Set(heads.map(([, commitId]) => commitId)).size).toBe(21)
    expect(new Set(heads.map(([, , changeId]) => changeId)).size).toBe(21)
    const parents = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', 'heads(all())', '--no-graph', '-T', 'parents.map(|p| p.commit_id()).join(",") ++ "\\n"'], { cwd: repo, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
    expect(parents.filter(parent => parent === base).length).toBeGreaterThanOrEqual(20)
    rmSync(root, { recursive: true, force: true })
  }, 60_000)

  it('is idempotent on retry and returns the existing binding without touching jj', async () => {
    const { repo, workspaceRoot } = mkRepo()
    execFileSync('mkdir', ['-p', workspaceRoot])
    const base = spineCommit(repo)
    const input = { repoRoot: repo, workspacesDirectory: workspaceRoot, threadName: 'retry me', sessionId: 'session-retry', spineRevision: base }
    const first = await provisionThreadWorkspace({ executor: realJj, ...input })
    expect(first.status).toBe('created')
    const second = await provisionThreadWorkspace({ executor: realJj, ...input })
    // A retry without the recorded binding must refuse rather than create a second workspace.
    expect(second.status).toBe('refused-collision')

    const bound = await provisionThreadWorkspace({ executor: realJj, ...input, existing: { workspaceName: first.workspaceName, path: first.path ?? '' } })
    expect(bound.status).toBe('existing')
    expect(bound.path).toBe(first.path)
    const names = execFileSync('jj', ['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"'], { cwd: repo, encoding: 'utf8' })
    expect(names.split('\n').filter(line => line.startsWith('retry-me-')).length).toBe(1)
    rmSync(join(repo, '..'), { recursive: true, force: true })
  })

  it('refuses a base that a live workspace is sitting on, with no side effects', async () => {
    const { root, repo, workspaceRoot } = mkRepo()
    execFileSync('mkdir', ['-p', workspaceRoot])
    const base = spineCommit(repo)
    // default's @ is the spine; ask for a workspace based on the spine itself and
    // then on a live workspace's own working copy.
    const first = await provisionThreadWorkspace({ executor: realJj, repoRoot: repo, workspacesDirectory: workspaceRoot, threadName: 'one', sessionId: 's1', spineRevision: base })
    expect(first.status).toBe('created')
    const liveHead = execFileSync('jj', ['--ignore-working-copy', 'workspace', 'list', '-T', 'target.commit_id() ++ "\\n"'], { cwd: repo, encoding: 'utf8' }).trim().split('\n')[1] ?? ''
    const refused = await provisionThreadWorkspace({ executor: realJj, repoRoot: repo, workspacesDirectory: workspaceRoot, threadName: 'two', sessionId: 's2', spineRevision: liveHead })
    expect(refused.status).toBe('refused-base')
    expect(existsSync(join(workspaceRoot, workspaceNameFor({ threadName: 'two', sessionId: 's2' })))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it('never selects a workspace recorded as unavailable, and passes non-jj roots through', async () => {
    const { root, repo, workspaceRoot } = mkRepo()
    execFileSync('mkdir', ['-p', workspaceRoot])
    const base = spineCommit(repo)
    const name = workspaceNameFor({ threadName: 'parked thread', sessionId: 'session-parked' })
    execFileSync('mkdir', ['-p', join(repo, '.jj', 'repo')])
    execFileSync('sh', ['-c', `printf '%s' '{"unavailableForNewWork":["${name}"]}' > ${join(repo, '.jj', 'repo', 'jj-isolation-unsafe.json')}`])
    const refused = await provisionThreadWorkspace({ executor: realJj, repoRoot: repo, workspacesDirectory: workspaceRoot, threadName: 'parked thread', sessionId: 'session-parked', spineRevision: base })
    expect(refused.status).toBe('refused-unsafe')

    const notARepo = await provisionThreadWorkspace({
      executor: realJj,
      repoRoot: root,
      workspacesDirectory: join(root, 'ws'),
      threadName: 'plain folder',
      sessionId: 'session-plain',
      spineRevision: base,
    })
    expect(notARepo.status).toBe('not-a-jj-repository')
    expect(notARepo.path).toBe(null)
    rmSync(root, { recursive: true, force: true })
  })

  it('rejects a partially registered workspace whose base or path is not the requested one', async () => {
    const { root, repo, workspaceRoot } = mkRepo()
    execFileSync('mkdir', ['-p', workspaceRoot])
    const base = spineCommit(repo)
    const other = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@', '--no-graph', '-T', 'commit_id'], { cwd: repo, encoding: 'utf8' }).trim()
    expect(other === base).toBe(false)

    const simulatedPartial = (options: { readonly name: string; readonly parentId: string; readonly createDirectory: boolean }): JjExecutor => {
      const destination = join(workspaceRoot, options.name)
      let listCalls = 0
      return async ({ args, cwd }) => {
        const command = args.join(' ')
        if (command.startsWith('workspace add')) {
          if (options.createDirectory) execFileSync('mkdir', ['-p', destination])
          return { exitCode: 1, stdout: '', stderr: 'simulated failure after registering' }
        }
        if (command.startsWith('--ignore-working-copy workspace list')) {
          listCalls += 1
          // Only the post-add read reports the partial registration; the pre-add
          // read must not look like a live workspace sitting on the base.
          return listCalls === 1
            ? { exitCode: 0, stdout: 'default\tdeadbeef\tbase\n', stderr: '' }
            : { exitCode: 0, stdout: `${options.name}\tsimulatedcommit\t${options.parentId}\n`, stderr: '' }
        }
        return realJj({ args, cwd })
      }
    }

    // Registered, but its working copy is a child of a different revision than the
    // one requested: accepting it would stack the thread's mutable @ elsewhere.
    const mismatched = await provisionThreadWorkspace({
      executor: simulatedPartial({
        name: workspaceNameFor({ threadName: 'partial', sessionId: 'session-partial' }),
        parentId: other,
        createDirectory: true,
      }),
      repoRoot: repo,
      workspacesDirectory: workspaceRoot,
      threadName: 'partial',
      sessionId: 'session-partial',
      spineRevision: base,
    })
    expect(mismatched.status).toBe('failed')
    expect(mismatched.path).toBe(null)

    // Registered at the requested base, but with no directory on disk: still not a
    // workspace this thread can be handed.
    const noDirectory = await provisionThreadWorkspace({
      executor: simulatedPartial({
        name: workspaceNameFor({ threadName: 'partial-2', sessionId: 'session-partial-2' }),
        parentId: base,
        createDirectory: false,
      }),
      repoRoot: repo,
      workspacesDirectory: workspaceRoot,
      threadName: 'partial-2',
      sessionId: 'session-partial-2',
      spineRevision: base,
    })
    expect(noDirectory.status).toBe('failed')
    rmSync(root, { recursive: true, force: true })
  })
})
