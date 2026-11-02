import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JjFilesystem } from './jj-filesystem.js'
import { createThreads, ThreadWorkspaceModel, type JjExecutor } from './threads.js'

/**
 * Characterization for the Effect-native rewrite (plans/effect-native/reviews/vcs-multihost.md §4 step 0, jj-int a/e):
 * one repository's mutations run strictly in order while different repositories land in parallel, and a shared view
 * read never carries any one caller's abort signal.
 */

const jjAvailable = spawnSync('jj', ['--version']).status === 0
const env = { ...process.env, JJ_CONFIG: '' }

interface RecordedCall {
  readonly args: readonly string[]
  readonly cwd: string
  readonly signalled: boolean
}

const runJj = (args: readonly string[], cwd: string): Promise<{ exitCode: number; stdout: string; stdoutLossy: boolean; stderr: string }> =>
  new Promise(resolvePromise => {
    const child = spawn('jj', ['--color=never', '--no-pager', ...args], { cwd, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    child.on('close', code => resolvePromise({ exitCode: code ?? 1, stdout, stdoutLossy: false, stderr }))
  })

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })

const initRepository = (repo: string): void => {
  execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore', env })
  jj(repo, 'config', 'set', '--repo', 'user.name', 'Test')
  jj(repo, 'config', 'set', '--repo', 'user.email', 'test@example.com')
  writeFileSync(join(repo, 'shared.txt'), 'one\n')
  jj(repo, 'commit', '-m', 'base')
  jj(repo, 'bookmark', 'create', 'main', '-r', '@-')
}

const deferred = () => {
  let release = (): void => undefined
  const promise = new Promise<void>(resolvePromise => {
    release = resolvePromise
  })
  return { promise, release }
}

describe.skipIf(!jjAvailable)('thread landing serialization against real jj', () => {
  let root: string
  let calls: RecordedCall[]
  const executor: JjExecutor = input => {
    calls.push({ args: input.args, cwd: input.cwd, signalled: input.signal !== undefined })
    return runJj(input.args, input.cwd)
  }
  const threads = createThreads({
    executor,
    filesystem: JjFilesystem,
    bookmark: () => 'main',
    threadsDirectory: ThreadWorkspaceModel.defaultThreadsDirectory,
    gitWorktree: async (repoRoot, args) => {
      execFileSync('git', ['-C', repoRoot, 'worktree', ...args], { stdio: 'ignore' })
    },
  })

  const describedThread = async (repo: string, file: string) => {
    const provisioned = await threads.provision(repo)
    writeFileSync(join(provisioned.path, file), `${file}\n`)
    jj(provisioned.path, 'describe', '-m', `feat: add ${file}`)
    const location = await threads.locate(provisioned.path)
    if (location.threadName === undefined) throw new Error('provisioned workspace is not a thread')
    return { ...location, threadName: location.threadName }
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-land-serial-')))
    calls = []
  })

  afterEach(() => {
    for (const name of ['repo-a', 'repo-b']) rmSync(ThreadWorkspaceModel.defaultThreadsDirectory(join(root, name)), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('runs two lands of one repository strictly one after the other, both landing', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    const first = await describedThread(repo, 'first.txt')
    const second = await describedThread(repo, 'second.txt')
    const firstGate = deferred()
    const order: string[] = []
    calls = []

    const firstLand = threads.landAt(first, {
      validate: async () => {
        order.push('first:validate')
        await firstGate.promise
      },
    })
    const secondLand = threads.landAt(second, {
      validate: async () => {
        order.push('second:validate')
      },
    })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 150))
    expect(order).toEqual(['first:validate'])

    firstGate.release()
    const [firstOutcome, secondOutcome] = await Promise.all([firstLand, secondLand])

    expect(order).toEqual(['first:validate', 'second:validate'])
    const lastFirstCall = calls.findLastIndex(call => call.cwd === first.workspaceRoot)
    const firstSecondCall = calls.findIndex(call => call.cwd === second.workspaceRoot)
    expect(lastFirstCall).toBeLessThan(firstSecondCall)
    expect(firstOutcome.status).toBe('landed')
    expect(secondOutcome.status).toBe('landed')
    expect(jj(repo, '--ignore-working-copy', 'log', '--no-graph', '-r', '::main & ~root()', '-T', 'description.first_line() ++ "\\n"')).toBe(
      'feat: add second.txt\nfeat: add first.txt\nbase\n',
    )
  })

  it('lets a land in another repository run while the first repository is held', async () => {
    const repoA = join(root, 'repo-a')
    const repoB = join(root, 'repo-b')
    initRepository(repoA)
    initRepository(repoB)
    const threadA = await describedThread(repoA, 'a.txt')
    const threadB = await describedThread(repoB, 'b.txt')
    const gateA = deferred()

    const landA = threads.landAt(threadA, { validate: () => gateA.promise })
    const outcomeB = await threads.landAt(threadB)
    expect(outcomeB.status).toBe('landed')

    gateA.release()
    expect((await landA).status).toBe('landed')
  })

  it('a failing land releases the repository for the next one', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    const first = await describedThread(repo, 'first.txt')
    const second = await describedThread(repo, 'second.txt')

    const failed = threads.landAt(first, {
      validate: async () => {
        throw new Error('guard refused')
      },
    })
    const next = threads.landAt(second)
    await expect(failed).rejects.toThrow('guard refused')
    expect((await next).status).toBe('landed')
  })

  it('reports queued, validating then rebasing progress in that order', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    const thread = await describedThread(repo, 'first.txt')
    const phases: string[] = []
    await threads.landAt(thread, { onProgress: phase => phases.push(phase) })
    expect(phases).toEqual(['queued', 'validating', 'rebasing'])
  })

  it('shares one in-flight view read between callers and never passes a caller signal to it', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    calls = []
    const aborted = new AbortController()
    aborted.abort()

    const [first, second] = await Promise.all([threads.locate(repo, aborted.signal), threads.locate(repo)])

    expect(first).toEqual(second)
    const rootReads = calls.filter(call => call.args.join(' ') === '--ignore-working-copy root')
    expect(rootReads).toHaveLength(1)
    expect(rootReads.every(call => !call.signalled)).toBe(true)
  })

  it('passes the caller signal to mutations, which are never cached', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    const thread = await describedThread(repo, 'first.txt')
    calls = []
    await threads.landAt(thread, { signal: new AbortController().signal })
    const rebase = calls.find(call => call.args[0] === 'rebase')
    expect(rebase?.signalled).toBe(true)
  })
})
