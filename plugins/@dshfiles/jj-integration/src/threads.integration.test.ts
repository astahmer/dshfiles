import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { JsonText } from './json-text.js'
import { checkoutSyncArgv, createThreads, defaultThreadsDirectory, isSecondaryWorkspace, type JjExecutor } from './threads.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0

const executor: JjExecutor = async ({ args, cwd }) => {
  const result = spawnSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', env: { ...process.env, JJ_CONFIG: '' } })
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JJ_CONFIG: '' },
  })

const bookmarkTarget = (cwd: string): string => jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', 'main', '-T', 'description.first_line()')
const changeIdAt = (cwd: string, revset: string): string =>
  jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'change_id.short(12)').trim()

describe.skipIf(!jjAvailable)('thread workspaces against real jj', () => {
  let root: string
  let repo: string
  const threads = createThreads({ executor, bookmark: () => 'main', threadsDirectory: defaultThreadsDirectory })

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
    rmSync(defaultThreadsDirectory(repo), { recursive: true, force: true })
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

    expect(isSecondaryWorkspace(rootLocation)).toBe(false)
    expect(isSecondaryWorkspace(secondaryLocation)).toBe(true)
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
      threadsDirectory: defaultThreadsDirectory,
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

  it('reads legacy rebase timestamps without a stored tip revision', async () => {
    const thread = await threads.provision(repo)
    const rebasedAt = Date.now()
    writeFileSync(join(defaultThreadsDirectory(repo), '.dshfiles-rebase-timestamps.json'), JSON.stringify({ [thread.name]: rebasedAt }))

    const status = await threads.status(repo, thread.name)

    expect(status.rebasedAt).toBe(rebasedAt)
    expect(status.rebasedTipChangeId).toBeUndefined()
  })

  it('rebases described work onto the bookmark and leaves a fresh working copy', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'feature\n')
    jj(thread.path, 'describe', '-m', 'feat: add feature')
    writeFileSync(join(repo, 'other.txt'), 'other\n')
    jj(repo, 'commit', '-m', 'other work')
    jj(repo, 'bookmark', 'set', 'main', '-r', '@-')

    const outcome = await threads.land(thread.path)
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
    const reloaded = createThreads({ executor, bookmark: () => 'main', threadsDirectory: defaultThreadsDirectory })
    expect((await reloaded.list(repo))[0]?.rebasedAt).toBe(status?.rebasedAt)
    expect((await reloaded.list(repo))[0]?.rebasedTipChangeId).toBe(tipChangeId)
  })

  it('brings the default checkout onto the rebased bookmark with dshx checkout sync, keeping its local edits', async () => {
    writeFileSync(join(repo, '.secret.json'), 'local\n')
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'feature\n')
    jj(thread.path, 'describe', '-m', 'feat: add feature')
    expect(await threads.land(thread.path)).toMatchObject({ status: 'landed' })

    const [command = '', ...args] = checkoutSyncArgv({ repoRoot: repo, workspace: 'default', bookmark: 'main' })
    const synced = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, JJ_CONFIG: '' } })
    expect(JsonText.decode(z.unknown(), synced.stdout)?.data).toMatchObject({
      ok: true,
      data: { status: 'synced', kept: [{ description: '' }], changedFiles: ['feature.txt'] },
    })
    expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe('feature\n')
    expect(readFileSync(join(repo, '.secret.json'), 'utf8')).toBe('local\n')
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
