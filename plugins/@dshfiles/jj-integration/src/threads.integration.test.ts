import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { JsonText } from './json-text.js'
import { createThreads, ThreadWorkspaceModel, type JjExecutor } from './threads.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0

const executor: JjExecutor = async ({ args, cwd }) => {
  const result = spawnSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', env: { ...process.env, JJ_CONFIG: '' } })
  return { exitCode: result.status ?? 1, stdout: result.stdout, stdoutLossy: false, stderr: result.stderr }
}

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JJ_CONFIG: '' },
  })

const bookmarkTarget = (cwd: string): string => jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', 'main', '-T', 'description.first_line()')
const bookmarkTargetCommitId = (cwd: string): string =>
  jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', 'bookmarks(exact:"main")', '-T', 'commit_id').trim()
const commitIdAt = (cwd: string, revset: string): string => jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'commit_id').trim()
const changeIdAt = (cwd: string, revset: string): string =>
  jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'change_id.short(12)').trim()

describe.skipIf(!jjAvailable)('thread workspaces against real jj', () => {
  let root: string
  let repo: string
  const threads = createThreads({ executor, bookmark: () => 'main', threadsDirectory: ThreadWorkspaceModel.defaultThreadsDirectory })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-threads-')))
    repo = join(root, 'repo')
    execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore', env: { ...process.env, JJ_CONFIG: '' } })
    jj(repo, 'config', 'set', '--repo', 'user.name', 'Test')
    jj(repo, 'config', 'set', '--repo', 'user.email', 'test@example.com')
    writeFileSync(join(repo, 'shared.txt'), 'one\n')
    jj(repo, 'commit', '-m', 'base')
    jj(repo, 'bookmark', 'create', 'main', '-r', '@-')
  })

  afterEach(() => {
    rmSync(ThreadWorkspaceModel.defaultThreadsDirectory(repo), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('provisions a checked-out workspace on the bookmark and recognises it as a thread', async () => {
    const thread = await threads.provision(repo)
    expect(thread.path).toBe(join(`${repo}-threads`, thread.name))
    expect(existsSync(join(thread.path, 'shared.txt'))).toBe(true)
    expect((await threads.locate(thread.path)).threadName).toBe(thread.name)
    expect((await threads.locate(repo)).threadName).toBeUndefined()
    expect((await threads.list(repo)).map(entry => entry.name)).toEqual([thread.name])
  })

  it('identifies non-thread secondary workspaces by their owning JJ checkout', async () => {
    const secondaryPath = join(root, 'secondary')
    jj(repo, 'workspace', 'add', secondaryPath, '--name', 'secondary')

    const rootLocation = await threads.locate(repo)
    const secondaryLocation = await threads.locate(secondaryPath)

    expect(ThreadWorkspaceModel.isSecondaryWorkspace(rootLocation)).toBe(false)
    expect(ThreadWorkspaceModel.isSecondaryWorkspace(secondaryLocation)).toBe(true)
    expect(secondaryLocation).toMatchObject({ repoRoot: repo, workspaceRoot: secondaryPath, threadName: undefined })
  })

  it('creates the thread workspace under the name the client already shows', async () => {
    const thread = await threads.provision(repo, undefined, 'thread-c0ffee')
    expect(thread).toEqual({ name: 'thread-c0ffee', path: join(`${repo}-threads`, 'thread-c0ffee') })
    expect((await threads.locate(thread.path)).threadName).toBe('thread-c0ffee')
  })

  it('can isolate from the current working-copy revision when explicitly requested', async () => {
    writeFileSync(join(repo, 'local-context.txt'), 'existing context\n')
    const base = await threads.workingCopyCommitId(repo)
    const thread = await threads.provision(repo, base)

    expect(readFileSync(join(thread.path, 'local-context.txt'), 'utf8')).toBe('existing context\n')
    expect(readFileSync(join(repo, 'local-context.txt'), 'utf8')).toBe('existing context\n')
    expect((await threads.locate(thread.path)).threadName).toBe(thread.name)
  })

  it('starts a new isolated thread from the configured bookmark, not local checkout commits', async () => {
    writeFileSync(join(repo, 'local-context.txt'), 'checkout only\n')
    jj(repo, 'commit', '-m', 'feat: local checkout context')

    const thread = await threads.provision(repo)

    expect(() => readFileSync(join(thread.path, 'local-context.txt'), 'utf8')).toThrow()
    expect(jj(thread.path, '--ignore-working-copy', 'log', '--no-graph', '-r', '@-', '-T', 'commit_id')).toBe(
      jj(repo, '--ignore-working-copy', 'log', '--no-graph', '-r', 'main', '-T', 'commit_id'),
    )
  })

  it('reads one thread status from its workspace without listing siblings', async () => {
    const target = await threads.provision(repo)
    await threads.provision(repo)
    writeFileSync(join(target.path, 'feature.txt'), 'feature\n')
    jj(target.path, 'describe', '-m', 'feat: target only')
    const invocations: { readonly cwd: string; readonly command: string }[] = []
    const focusedThreads = createThreads({
      executor: async input => {
        invocations.push({ cwd: input.cwd, command: input.args[1] ?? '' })
        return executor(input)
      },
      bookmark: () => 'main',
      threadsDirectory: ThreadWorkspaceModel.defaultThreadsDirectory,
    })

    const status = await focusedThreads.status(repo, target.name)

    expect(status).toMatchObject({ name: target.name, path: target.path, unlanded: [{ description: 'feat: target only' }] })
    expect(status).toEqual((await threads.list(repo)).find(thread => thread.name === target.name))
    expect(invocations).toHaveLength(2)
    expect(invocations.every(invocation => invocation.cwd === target.path && invocation.command === 'log')).toBe(true)
  })

  it('lists local bookmarks and starts a thread from the chosen one', async () => {
    jj(repo, 'bookmark', 'create', 'feature', '-r', '@')
    jj(repo, 'describe', '-m', 'feature base')
    expect(await threads.bookmarks(repo)).toEqual({ current: 'feature', names: ['feature', 'main'] })
    const thread = await threads.provision(repo, 'feature')
    expect(jj(thread.path, 'log', '--no-graph', '-r', '@-', '-T', 'description.first_line()')).toBe('feature base')
    expect((await threads.bookmarks(thread.path)).current).toBe('feature')
  })

  it('renders a compact graph of the thread, configured bookmark, origin bookmark, and default workspace', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'feature\n')
    jj(thread.path, 'describe', '-m', 'feat: graph preview')
    jj(repo, 'git', 'remote', 'add', 'origin', join(repo, '.git'))
    jj(repo, 'git', 'fetch', '--remote', 'origin')
    const operationBefore = jj(thread.path, '--ignore-working-copy', 'op', 'log', '--limit', '1', '--no-graph', '-T', 'id').trim()

    const graph = await threads.revisionGraph(thread.path)
    const operationAfter = jj(thread.path, '--ignore-working-copy', 'op', 'log', '--limit', '1', '--no-graph', '-T', 'id').trim()

    expect(graph).toContain('feat: graph preview')
    expect(graph).toContain('main')
    expect(graph).toContain('main@origin')
    expect(graph).toContain('default@')
    expect(graph.split('\n').some(line => line.startsWith('@ '))).toBe(true)
    expect(graph.split('\n').length).toBeLessThan(24)
    expect(operationAfter).toBe(operationBefore)
  })

  it('refuses to show a graph for the shared checkout', async () => {
    await expect(threads.revisionGraph(repo)).rejects.toMatchObject({ code: 'not-a-thread' })
  })

  it('renders the graph when no origin bookmark exists', async () => {
    const thread = await threads.provision(repo)

    const graph = await threads.revisionGraph(thread.path)

    expect(graph).toContain('main')
    expect(graph).toContain('default@')
    expect(graph).not.toContain('main@origin')
  })

  it('reads legacy rebase timestamps without a stored tip revision', async () => {
    const thread = await threads.provision(repo)
    const rebasedAt = Date.now()
    writeFileSync(join(ThreadWorkspaceModel.defaultThreadsDirectory(repo), '.dshfiles-rebase-timestamps.json'), JSON.stringify({ [thread.name]: rebasedAt }))

    const status = await threads.status(repo, thread.name)

    expect(status.rebasedAt).toBe(rebasedAt)
    expect(status.rebasedTipChangeId).toBeUndefined()
  })

  it('runs Project Checks on the exact rebased candidate before moving the bookmark', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'verified feature\n')
    jj(thread.path, 'describe', '-m', 'feat: verified feature')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)
    const verifiedCandidates: string[] = []

    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: sourceRevision,
      authorize: async location => location.threadName === thread.name,
      verifyCandidate: async candidate => {
        verifiedCandidates.push(candidate.workingCopyCommitId)
        expect(candidate.attempt).toBe(1)
        expect(await threads.workingCopyCommitId(thread.path)).toBe(candidate.workingCopyCommitId)
        expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
        return { status: 'passed' }
      },
    })

    expect(outcome).toMatchObject({ status: 'landed', head: { commitId: verifiedCandidates[0] } })
    expect(verifiedCandidates).toHaveLength(1)
    expect(bookmarkTargetCommitId(repo)).toBe(verifiedCandidates[0])
    expect(bookmarkTargetCommitId(repo)).not.toBe(bookmarkBefore)
  })

  it('does not move the bookmark when Project Checks reject the rebased candidate', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'unverified feature\n')
    jj(thread.path, 'describe', '-m', 'feat: unverified feature')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)

    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: sourceRevision,
      authorize: async () => true,
      verifyCandidate: async () => ({ status: 'failed', message: 'post-rebase test failed' }),
    })

    expect(outcome).toEqual({ status: 'verification-failed', message: 'post-rebase test failed' })
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
  })

  it('rejects a stale completion source before rebasing the thread', async () => {
    const thread = await threads.provision(repo)
    const staleSourceRevision = await threads.workingCopyCommitId(thread.path)
    writeFileSync(join(thread.path, 'feature.txt'), 'changed after checks\n')
    jj(thread.path, 'describe', '-m', 'feat: changed after checks')
    const currentSourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)

    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: staleSourceRevision,
      authorize: async () => true,
      verifyCandidate: async () => ({ status: 'passed' }),
    })

    expect(outcome).toMatchObject({ status: 'verification-stale' })
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
    expect(await threads.workingCopyCommitId(thread.path)).toBe(currentSourceRevision)
  })

  it('does not replay an exact patch already represented on the bookmark', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(repo, 'shared.txt'), 'one\nrepresented\n')
    jj(repo, 'describe', '-m', 'feat: target patch')
    jj(repo, 'bookmark', 'set', 'main', '-r', '@')
    writeFileSync(join(thread.path, 'shared.txt'), 'one\nrepresented\n')
    jj(thread.path, 'describe', '-m', 'feat: duplicate thread patch')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)
    let verified = false

    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: sourceRevision,
      authorize: async () => true,
      verifyCandidate: async () => {
        verified = true
        return { status: 'passed' }
      },
    })

    expect(outcome).toMatchObject({ status: 'already-integrated', revisions: [{ commitId: sourceRevision }] })
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
    expect(await threads.workingCopyCommitId(thread.path)).toBe(sourceRevision)
    expect(verified).toBe(false)
  })

  it('blocks mixed represented and unique work before candidate verification', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(repo, 'shared.txt'), 'one\nrepresented\n')
    jj(repo, 'describe', '-m', 'feat: target patch')
    jj(repo, 'bookmark', 'set', 'main', '-r', '@')
    writeFileSync(join(thread.path, 'shared.txt'), 'one\nrepresented\n')
    jj(thread.path, 'describe', '-m', 'feat: represented thread patch')
    jj(thread.path, 'new')
    writeFileSync(join(thread.path, 'unique.txt'), 'unique work\n')
    jj(thread.path, 'describe', '-m', 'feat: unique thread patch')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)
    let verified = false

    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: sourceRevision,
      authorize: async () => true,
      verifyCandidate: async () => {
        verified = true
        return { status: 'passed' }
      },
    })

    expect(outcome.status).toBe('patch-equivalent-work')
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
    expect(await threads.workingCopyCommitId(thread.path)).toBe(sourceRevision)
    expect(verified).toBe(false)
  })

  it('blocks detached thread-owned work without moving the bookmark', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'detached.txt'), 'detached work\n')
    jj(thread.path, 'describe', '-m', 'feat: detached thread work')
    const detachedCommitId = await threads.workingCopyCommitId(thread.path)
    jj(thread.path, 'new', 'main')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)
    let verified = false

    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: sourceRevision,
      authorize: async () => true,
      verifyCandidate: async () => {
        verified = true
        return { status: 'passed' }
      },
    })

    expect(outcome).toMatchObject({ status: 'detached-work', revisions: [{ commitId: detachedCommitId }] })
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
    expect(verified).toBe(false)
  })

  it('does not block a thread on a sibling workspace detached head', async () => {
    const thread = await threads.provision(repo)
    const sibling = await threads.provision(repo)
    writeFileSync(join(sibling.path, 'sibling-detached.txt'), 'sibling work\n')
    jj(sibling.path, 'describe', '-m', 'feat: sibling detached work')
    const siblingDetachedCommitId = await threads.workingCopyCommitId(sibling.path)
    jj(sibling.path, 'new', 'main')
    writeFileSync(join(thread.path, 'target.txt'), 'target work\n')
    jj(thread.path, 'describe', '-m', 'feat: target work')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    let verified = false

    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: sourceRevision,
      authorize: async () => true,
      verifyCandidate: async () => {
        verified = true
        return { status: 'passed' }
      },
    })

    expect(outcome).toMatchObject({ status: 'landed' })
    expect(verified).toBe(true)
    expect(jj(repo, '--ignore-working-copy', 'log', '--no-graph', '-r', `all() ~ ::main`, '-T', 'commit_id')).toContain(siblingDetachedCommitId)
  })

  it('fails closed on binary patches whose equivalence cannot be proven', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'binary.dat'), Buffer.from([0, 255, 1, 0]))
    jj(thread.path, 'describe', '-m', 'feat: binary payload')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)
    let verified = false

    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: sourceRevision,
      authorize: async () => true,
      verifyCandidate: async () => {
        verified = true
        return { status: 'passed' }
      },
    })

    expect(outcome).toMatchObject({ status: 'patch-equivalence-unavailable', revisions: [{ commitId: sourceRevision }] })
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
    expect(await threads.workingCopyCommitId(thread.path)).toBe(sourceRevision)
    expect(verified).toBe(false)
  })

  it('rejects work added during candidate checks before moving the bookmark', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'candidate feature\n')
    jj(thread.path, 'describe', '-m', 'feat: candidate feature')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)

    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: sourceRevision,
      authorize: async () => true,
      verifyCandidate: async () => {
        writeFileSync(join(thread.path, 'late.txt'), 'late work\n')
        jj(thread.path, 'describe', '-m', 'feat: late work')
        return { status: 'passed' }
      },
    })

    expect(outcome).toMatchObject({ status: 'verification-stale' })
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
  })

  it('does not move the bookmark when candidate checks are cancelled', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'cancelled feature\n')
    jj(thread.path, 'describe', '-m', 'feat: cancelled feature')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)
    const controller = new AbortController()

    const outcome = await threads.landVerified({
      path: thread.path,
      signal: controller.signal,
      expectedSourceRevision: sourceRevision,
      authorize: async () => true,
      verifyCandidate: async () => {
        controller.abort()
        return { status: 'cancelled' }
      },
    })

    expect(outcome).toEqual({ status: 'verification-cancelled' })
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
  })

  it('confirms a completed bookmark move even if cancellation arrives immediately afterward', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'landed before cancellation\n')
    jj(thread.path, 'describe', '-m', 'feat: landed before cancellation')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const controller = new AbortController()
    const verifiedCandidates: string[] = []
    const abortAfterMoveExecutor: JjExecutor = async input => {
      const result = await executor(input)
      if (input.args.includes('bookmark') && input.args.includes('move')) controller.abort()
      return result
    }
    const guardedThreads = createThreads({
      executor: abortAfterMoveExecutor,
      bookmark: () => 'main',
      threadsDirectory: ThreadWorkspaceModel.defaultThreadsDirectory,
    })

    const outcome = await guardedThreads.landVerified({
      path: thread.path,
      signal: controller.signal,
      expectedSourceRevision: sourceRevision,
      authorize: async () => true,
      verifyCandidate: async candidate => {
        verifiedCandidates.push(candidate.workingCopyCommitId)
        return { status: 'passed' }
      },
    })

    expect(outcome).toMatchObject({ status: 'landed', head: { commitId: verifiedCandidates[0] } })
    expect(controller.signal.aborted).toBe(true)
    expect(bookmarkTargetCommitId(repo)).toBe(verifiedCandidates[0])
  })

  it('fails closed when JJ truncates revision metadata', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'truncated output case\n')
    jj(thread.path, 'describe', '-m', 'feat: truncated output case')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)
    const lossyExecutor: JjExecutor = async input => {
      const result = await executor(input)
      return input.args.some(argument => argument.includes('change_id ++')) ? { ...result, stdoutLossy: true } : result
    }
    const guardedThreads = createThreads({ executor: lossyExecutor, bookmark: () => 'main', threadsDirectory: ThreadWorkspaceModel.defaultThreadsDirectory })

    await expect(
      guardedThreads.landVerified({
        path: thread.path,
        expectedSourceRevision: sourceRevision,
        authorize: async () => true,
        verifyCandidate: async () => ({ status: 'passed' }),
      }),
    ).rejects.toMatchObject({ code: 'jj-failed' })
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
    expect(await threads.workingCopyCommitId(thread.path)).toBe(sourceRevision)
  })

  it('fails closed on malformed revision rows instead of treating them as empty', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'malformed output case\n')
    jj(thread.path, 'describe', '-m', 'feat: malformed output case')
    const sourceRevision = await threads.workingCopyCommitId(thread.path)
    const bookmarkBefore = bookmarkTargetCommitId(repo)
    const malformedExecutor: JjExecutor = async input => {
      const result = await executor(input)
      return input.args.some(argument => argument.includes('change_id ++')) ? { ...result, stdout: 'malformed\\tmetadata\\n' } : result
    }
    const guardedThreads = createThreads({
      executor: malformedExecutor,
      bookmark: () => 'main',
      threadsDirectory: ThreadWorkspaceModel.defaultThreadsDirectory,
    })

    await expect(
      guardedThreads.landVerified({
        path: thread.path,
        expectedSourceRevision: sourceRevision,
        authorize: async () => true,
        verifyCandidate: async () => ({ status: 'passed' }),
      }),
    ).rejects.toMatchObject({ code: 'jj-failed' })
    expect(bookmarkTargetCommitId(repo)).toBe(bookmarkBefore)
    expect(await threads.workingCopyCommitId(thread.path)).toBe(sourceRevision)
  })

  it('rebases described work onto the bookmark and leaves a fresh working copy', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'feature\n')
    jj(thread.path, 'describe', '-m', 'feat: add feature')
    writeFileSync(join(repo, 'other.txt'), 'other\n')
    jj(repo, 'commit', '-m', 'other work')
    jj(repo, 'bookmark', 'set', 'main', '-r', '@-')

    const phases: string[] = []
    const outcome = await threads.land(thread.path, { onProgress: phase => phases.push(phase) })
    expect(phases).toEqual(['queued', 'validating', 'rebasing'])
    expect(outcome).toMatchObject({
      status: 'landed',
      revisions: [{ description: 'feat: add feature', conflict: false }],
      head: { description: 'feat: add feature' },
    })
    expect(bookmarkTarget(repo)).toBe('feat: add feature')
    expect(jj(repo, '--ignore-working-copy', 'log', '--no-graph', '-r', 'main-', '-T', 'description.first_line()')).toBe('other work')
    const [status] = await threads.list(repo)
    const tipChangeId = changeIdAt(repo, 'main')
    expect(status).toMatchObject({ unlanded: [], behind: false, rebasedAt: expect.any(Number), rebasedTipChangeId: tipChangeId })
    const reloaded = createThreads({ executor, bookmark: () => 'main', threadsDirectory: ThreadWorkspaceModel.defaultThreadsDirectory })
    expect((await reloaded.list(repo))[0]?.rebasedAt).toBe(status?.rebasedAt)
    expect((await reloaded.list(repo))[0]?.rebasedTipChangeId).toBe(tipChangeId)
  })

  it('syncs the default checkout to the exact landed commit even if the bookmark advances later', async () => {
    writeFileSync(join(repo, '.secret.json'), 'local\n')
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'feature\n')
    jj(thread.path, 'describe', '-m', 'feat: add feature')
    const landed = await threads.land(thread.path)
    expect(landed.status).toBe('landed')
    if (landed.status !== 'landed' || landed.head === undefined) throw new Error('Expected a landed commit id.')
    const landedCommitId = landed.head.commitId

    jj(thread.path, 'new', 'main')
    writeFileSync(join(thread.path, 'later.txt'), 'later work\n')
    jj(thread.path, 'describe', '-m', 'feat: later work')
    jj(thread.path, 'bookmark', 'set', 'main', '-r', '@')
    const laterBookmarkTarget = bookmarkTargetCommitId(repo)
    expect(laterBookmarkTarget).not.toBe(landedCommitId)

    const [command = '', ...args] = ThreadWorkspaceModel.checkoutSyncArgv({
      repoRoot: repo,
      workspace: 'default',
      bookmark: 'main',
      revision: landedCommitId,
    })
    const synced = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, JJ_CONFIG: '' } })
    expect(JsonText.decode(z.unknown(), synced.stdout)?.data).toMatchObject({
      ok: true,
      data: { status: 'synced', to: landedCommitId, kept: [{ description: '' }], changedFiles: ['feature.txt'] },
    })
    expect(commitIdAt(repo, 'default@-')).toBe(landedCommitId)
    expect(bookmarkTargetCommitId(repo)).toBe(laterBookmarkTarget)
    expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe('feature\n')
    expect(() => readFileSync(join(repo, 'later.txt'))).toThrow()
    expect(readFileSync(join(repo, '.secret.json'), 'utf8')).toBe('local\n')
  })

  it('rebases a located thread without resolving its workspace a second time', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'feature\n')
    jj(thread.path, 'describe', '-m', 'feat: add feature')
    const invocations: string[][] = []
    const observedThreads = createThreads({
      executor: async input => {
        invocations.push([...input.args])
        return executor(input)
      },
      bookmark: () => 'main',
      threadsDirectory: ThreadWorkspaceModel.defaultThreadsDirectory,
    })
    const location = await threads.locate(thread.path)
    const threadName = location.threadName
    if (threadName === undefined) throw new Error('Expected a thread workspace.')

    const outcome = await observedThreads.landAt({ ...location, threadName })
    expect(outcome).toMatchObject({ status: 'landed' })
    expect(invocations).toHaveLength(4)
    expect(invocations.some(args => args.includes('root'))).toBe(false)
  })

  it('requires a description before rebasing placeholder work', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'feature\n')
    jj(thread.path, 'describe', '-m', 'wip')
    expect(await threads.land(thread.path)).toMatchObject({ status: 'needs-description' })
    expect(bookmarkTarget(repo)).toBe('base')
  })

  it('reports conflicting files and keeps the bookmark where it was', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'shared.txt'), 'thread\n')
    jj(thread.path, 'describe', '-m', 'thread edit')
    writeFileSync(join(repo, 'shared.txt'), 'main\n')
    jj(repo, 'commit', '-m', 'main edit')
    jj(repo, 'bookmark', 'set', 'main', '-r', '@-')

    expect(await threads.land(thread.path)).toMatchObject({ status: 'conflicted', files: ['shared.txt'] })
    expect(bookmarkTarget(repo)).toBe('main edit')
  })

  it('discards an empty thread completely and refuses one with revisions to rebase', async () => {
    const empty = await threads.provision(repo)
    const busy = await threads.provision(repo)
    writeFileSync(join(busy.path, 'draft.txt'), 'draft\n')

    expect(await threads.discard({ repoRoot: repo, name: empty.name, force: false })).toEqual({ status: 'discarded' })
    expect(existsSync(empty.path)).toBe(false)
    expect(jj(repo, '--ignore-working-copy', 'log', '--no-graph', '-r', 'heads(mutable()) & empty() ~ working_copies()', '-T', 'commit_id')).toBe('')

    expect(await threads.discard({ repoRoot: repo, name: busy.name, force: false })).toMatchObject({ status: 'has-work' })
    expect(existsSync(join(busy.path, 'draft.txt'))).toBe(true)
    expect(await threads.discard({ repoRoot: repo, name: busy.name, force: true })).toEqual({ status: 'discarded' })
    expect((await threads.list(repo)).map(entry => entry.name)).toEqual([])
  })
})
