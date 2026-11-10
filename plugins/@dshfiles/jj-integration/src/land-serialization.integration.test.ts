import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThreadWorkspaceModel } from './thread-workspace-model.js'
import { ThreadWorkspacesTestSupport, type JjExecutor } from './thread-workspaces-test-support.js'

/**
 * Characterization that pins the Host half's behaviour through the Effect-native edge (formerly recorded in the migration plan, jj-int a/e):
 * one repository's mutations run strictly in order while different repositories land in parallel, and a shared view
 * read keeps running for its other callers when one of them is interrupted.
 */

const jjAvailable = spawnSync('jj', ['--version']).status === 0
const env = { ...process.env, JJ_CONFIG: '' }

interface RecordedCall {
  readonly args: readonly string[]
  readonly cwd: string
}

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
  let beforeCall: (input: RecordedCall) => Promise<void> = async () => undefined
  const executor: JjExecutor = async input => {
    calls.push({ args: input.args, cwd: input.cwd })
    await beforeCall(input)
    return ThreadWorkspacesTestSupport.spawnJj(input)
  }
  const threads = ThreadWorkspacesTestSupport.promiseThreads({ executor })

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
    beforeCall = async () => undefined
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

  it('provision claims a spare still being added instead of adding a second workspace beside it', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    const addedPaths = () => calls.filter(call => call.args[0] === 'workspace' && call.args[1] === 'add').map(call => call.args[2])
    // Hold the spare the first provision warms (the second `workspace add`), so the next provision overlaps it.
    beforeCall = async input => {
      if (input.args[0] === 'workspace' && input.args[1] === 'add' && addedPaths().length === 2)
        await new Promise(resolvePromise => setTimeout(resolvePromise, 400))
    }
    const first = await threads.provision(repo)
    const second = await threads.provision(repo)
    const [firstAdded, spareAdded] = addedPaths()
    expect(firstAdded).toBe(first.path)
    // A concurrent `jj workspace add` here can fail with “Could not commit packed-ref transaction” in a colocated repo.
    expect(second.path).toBe(spareAdded)
  })

  it('reports queued, validating then rebasing progress in that order', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    const thread = await describedThread(repo, 'first.txt')
    const phases: string[] = []
    await threads.landAt(thread, { onProgress: phase => phases.push(phase) })
    expect(phases).toEqual(['queued', 'validating', 'rebasing'])
  })

  it('answers the other caller of a view read when one caller is interrupted', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    calls = []
    const readStarted = deferred()
    const readGate = deferred()
    beforeCall = async input => {
      if (input.args.join(' ') !== '--ignore-working-copy root') return
      readStarted.release()
      await readGate.promise
    }
    const interrupted = new AbortController()

    const first = threads.locate(repo, interrupted.signal)
    const second = threads.locate(repo)
    await readStarted.promise
    interrupted.abort()
    readGate.release()

    const [firstOutcome, secondOutcome] = await Promise.allSettled([first, second])
    expect(firstOutcome.status).toBe('rejected')
    expect(secondOutcome).toMatchObject({ status: 'fulfilled', value: { repoRoot: repo, workspaceRoot: repo } })
  })

  it('shares one view read between concurrent callers', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    calls = []
    const [first, second] = await Promise.all([threads.locate(repo), threads.locate(repo)])
    expect(first).toEqual(second)
    expect(calls.filter(call => call.args.join(' ') === '--ignore-working-copy root')).toHaveLength(1)
  })

  it('runs every mutation as its own jj process, never from the view cache', async () => {
    const repo = join(root, 'repo-a')
    initRepository(repo)
    const thread = await describedThread(repo, 'first.txt')
    // The spare for the next thread is checked out in the background and would race the counted snapshots.
    await expect.poll(() => existsSync(join(`${repo}-threads`, '.dshfiles-spare-workspaces.json')), { timeout: 20_000 }).toBe(true)
    calls = []
    await threads.snapshotFiles(thread.workspaceRoot)
    await threads.snapshotFiles(thread.workspaceRoot)
    expect(calls.filter(call => call.args.join(' ') === 'util snapshot')).toHaveLength(2)
  })
})
