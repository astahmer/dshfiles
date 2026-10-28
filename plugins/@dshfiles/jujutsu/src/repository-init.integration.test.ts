import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test } from 'vitest'
import { ensureJujutsuRepository, RepositoryInitializationError, type RepositoryInitRunner } from './repository-init.ts'

const fixture = async () => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-init-'))
  const repo = join(home, 'repo')
  await mkdir(repo)
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const command = (executable: string, cwd: string, args: readonly string[]): string => {
    const result = spawnSync(executable, args, {
      cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: join(home, 'no-global-gitconfig'),
        GIT_OPTIONAL_LOCKS: '0',
      },
      encoding: 'utf8',
      shell: false,
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`${executable} failed (${String(result.status)}): ${result.stderr}`)
    return result.stdout
  }
  const git = (args: readonly string[], cwd = repo): string => command('git', cwd, args)
  const jj = (args: readonly string[], cwd = repo): string => command(process.env.JJ_TEST_EXECUTABLE ?? 'jj', cwd, ['--color=never', '--no-pager', ...args])
  const calls: { readonly cwd: string; readonly args: readonly string[] }[] = []
  const runJj: RepositoryInitRunner = async (cwd, args, signal) => {
    signal?.throwIfAborted()
    calls.push({ cwd, args })
    return { stdout: jj(args, cwd), truncated: false }
  }
  const createGit = async (cwd = repo): Promise<void> => {
    await mkdir(cwd, { recursive: true })
    git(['init', '--initial-branch=main'], cwd)
    git(['config', '--local', 'user.name', 'Repository Init Test'], cwd)
    git(['config', '--local', 'user.email', 'repository-init@example.invalid'], cwd)
    git(['config', '--local', 'commit.gpgsign', 'false'], cwd)
    await writeFile(join(cwd, 'tracked.txt'), 'base\n')
    await writeFile(join(cwd, 'deleted.txt'), 'keep in history\n')
    git(['add', '.'], cwd)
    git(['commit', '--message', 'initial history'], cwd)
    git(['branch', 'feature/preserved'], cwd)
  }
  const open = (path = repo) => ensureJujutsuRepository({ path, runJj })
  return { home, repo, git, jj, createGit, calls, runJj, open }
}

const absent = async (path: string): Promise<void> => {
  await assert.rejects(lstat(path), { code: 'ENOENT' })
}
const initCalls = <T extends { readonly args: readonly string[] }>(calls: readonly T[]): T[] => calls.filter(call => call.args.includes('init'))

// GIT_OPTIONAL_LOCKS=0 makes the read-side probes independent of Git's index
// cache refreshes. We preserve staged content/diffs, not index cache bytes.
const gitState = (git: (args: readonly string[]) => string) => ({
  head: git(['rev-parse', 'HEAD']),
  symbolicHead: git(['symbolic-ref', 'HEAD']),
  // JJ adds its own refs/jj/keep GC roots; user branches/tags/history do not move.
  refs: git(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads/', 'refs/tags/', 'refs/remotes/']),
  history: git(['log', '--branches', '--tags', '--remotes', '--format=%H %P %s']),
  status: git(['status', '--porcelain=v1', '--untracked-files=all']),
  staged: git(['diff', '--cached', '--binary', '--no-ext-diff']),
  unstaged: git(['diff', '--binary', '--no-ext-diff']),
  config: git(['config', '--local', '--list']),
})

const dirty = async (repo: string, git: (args: readonly string[]) => string): Promise<void> => {
  await writeFile(join(repo, 'tracked.txt'), 'staged\n')
  await writeFile(join(repo, 'staged-new.bin'), Buffer.from([0, 1, 254, 255]))
  git(['add', 'tracked.txt', 'staged-new.bin'])
  await writeFile(join(repo, 'tracked.txt'), 'unstaged\n')
  await writeFile(join(repo, 'staged-new.bin'), Buffer.from([0, 2, 253, 255]))
  await rm(join(repo, 'deleted.txt'))
  await writeFile(join(repo, 'untracked.bin'), Buffer.from([0, 9, 128, 255]))
}

test('initialization preserves history, HEAD, branches, dirty/staged diffs and exact file bytes', async () => {
  const f = await fixture()
  await f.createGit()
  await dirty(f.repo, f.git)
  const before = gitState(f.git)
  const paths = ['tracked.txt', 'staged-new.bin', 'untracked.bin']
  const bytes = await Promise.all(paths.map(path => readFile(join(f.repo, path))))

  assert.deepEqual(await f.open(), { root: await realpath(f.repo), initialized: true })

  assert.deepEqual(gitState(f.git), before)
  assert.deepEqual(await Promise.all(paths.map(path => readFile(join(f.repo, path)))), bytes)
  await absent(join(f.repo, 'deleted.txt'))
  assert.equal(f.jj(['--ignore-working-copy', 'root']).trim(), await realpath(f.repo))
  assert.equal(initCalls(f.calls).length, 1)
  assert.deepEqual(initCalls(f.calls)[0]?.args, ['--config=snapshot.auto-track=none()', 'git', 'init', '--colocate'])
})

test('repeat opens only verify root and never initialize or snapshot existing JJ again', async () => {
  const f = await fixture()
  await f.createGit()
  await f.open()
  await dirty(f.repo, f.git)
  const before = gitState(f.git)
  const operations = f.jj(['--ignore-working-copy', 'op', 'log', '--no-graph', '--template', 'id ++ "\\n"'])

  assert.deepEqual(await f.open(), { root: await realpath(f.repo), initialized: false })
  assert.deepEqual(await f.open(), { root: await realpath(f.repo), initialized: false })

  assert.equal(initCalls(f.calls).length, 1)
  assert.deepEqual(gitState(f.git), before)
  assert.equal(f.jj(['--ignore-working-copy', 'op', 'log', '--no-graph', '--template', 'id ++ "\\n"']), operations)
})

test('concurrent root and nested opens coalesce one initialization at the canonical Git root', async () => {
  const f = await fixture()
  await f.createGit()
  const nested = join(f.repo, 'one', 'two')
  await mkdir(nested, { recursive: true })
  const alias = join(f.home, 'alias')
  await symlink(nested, alias, 'dir')
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => f.open(i % 2 === 0 ? alias : f.repo)))

  assert.ok(results.every(result => result.root === f.repo))
  assert.equal(initCalls(f.calls).length, 1)
  assert.ok(f.calls.every(call => call.cwd === f.repo))
  await absent(join(nested, '.jj'))
})

test('an existing standalone JJ repository is a read-only no-op', async () => {
  const f = await fixture()
  f.jj(['git', 'init', '--no-colocate'])
  await writeFile(join(f.repo, 'not-snapshotted.txt'), 'dirty\n')
  assert.deepEqual(await f.open(), { root: f.repo, initialized: false })
  assert.deepEqual(
    f.calls.map(call => call.args),
    [['--ignore-working-copy', 'root']],
  )
  await absent(join(f.repo, '.git'))
})

for (const marker of ['file', 'directory', 'dangling-symlink'] as const) {
  test(`a broken existing JJ ${marker} is never replaced or retried with init`, async () => {
    const f = await fixture()
    await f.createGit()
    const jjPath = join(f.repo, '.jj')
    if (marker === 'file') await writeFile(jjPath, 'do not overwrite\n')
    else if (marker === 'directory') await mkdir(jjPath)
    else await symlink(join(f.home, 'missing-jj'), jjPath, 'dir')
    const before = await lstat(jjPath)
    await assert.rejects(f.open(), RepositoryInitializationError)
    assert.equal((await lstat(jjPath)).ino, before.ino)
    assert.equal(initCalls(f.calls).length, 0)
    if (marker === 'file') assert.equal(await readFile(jjPath, 'utf8'), 'do not overwrite\n')
  })
}

test('plain, missing and regular-file selections never invoke JJ or create metadata', async () => {
  const f = await fixture()
  const file = join(f.repo, 'ordinary.txt')
  await writeFile(file, 'plain\n')
  for (const selection of [f.repo, join(f.home, 'missing'), file]) await assert.rejects(f.open(selection), RepositoryInitializationError)
  assert.deepEqual(f.calls, [])
  await absent(join(f.repo, '.jj'))
  await absent(join(f.repo, '.git'))
})

test('bare repositories and their subdirectories never initialize, even inside a Git checkout', async () => {
  const f = await fixture()
  await f.createGit()
  const bare = join(f.repo, 'nested.git')
  f.git(['init', '--bare', bare])
  await assert.rejects(f.open(bare), RepositoryInitializationError)
  await assert.rejects(f.open(join(bare, 'objects')), RepositoryInitializationError)
  assert.deepEqual(f.calls, [])
  await absent(join(bare, '.jj'))
  await absent(join(f.repo, '.jj'))
})

test('nested Git wins over an existing outer JJ root', async () => {
  const f = await fixture()
  await f.createGit()
  await f.open()
  const nested = join(f.repo, 'nested')
  await f.createGit(nested)
  const child = join(nested, 'deep')
  await mkdir(child)
  assert.deepEqual(await f.open(child), { root: nested, initialized: true })
  assert.deepEqual(
    initCalls(f.calls).map(call => call.cwd),
    [f.repo, nested],
  )
})

test('a nested Git checkout initializes itself, never its outer Git ancestor', async () => {
  const f = await fixture()
  await f.createGit()
  const nested = join(f.repo, 'nested')
  await f.createGit(nested)
  assert.deepEqual(await f.open(nested), { root: nested, initialized: true })
  await absent(join(f.repo, '.jj'))
  assert.deepEqual(
    initCalls(f.calls).map(call => call.cwd),
    [nested],
  )
})

test('a malformed nested Git marker blocks initialization of its valid outer Git ancestor', async () => {
  const f = await fixture()
  await f.createGit()
  const nested = join(f.repo, 'nested')
  await mkdir(nested)
  await writeFile(join(nested, '.git'), 'not a gitdir pointer\n')
  await assert.rejects(f.open(nested), RepositoryInitializationError)
  assert.deepEqual(f.calls, [])
  await absent(join(f.repo, '.jj'))
  assert.equal(await readFile(join(nested, '.git'), 'utf8'), 'not a gitdir pointer\n')
})

test('a real linked Git worktree initializes on installed JJ and preserves both Git checkouts', async () => {
  const f = await fixture()
  await f.createGit()
  const worktree = join(f.home, 'worktree')
  f.git(['worktree', 'add', '-b', 'linked-worktree', worktree])
  const worktreeGit = (args: readonly string[]) => f.git(args, worktree)
  await dirty(worktree, worktreeGit)
  const before = gitState(worktreeGit)
  const primaryBefore = gitState(f.git)
  const pointer = await readFile(join(worktree, '.git'))
  assert.deepEqual(await f.open(worktree), { root: worktree, initialized: true })
  assert.deepEqual(gitState(worktreeGit), before)
  assert.deepEqual(gitState(f.git), primaryBefore)
  assert.deepEqual(await readFile(join(worktree, '.git')), pointer)
  await absent(join(f.repo, '.jj'))
  assert.deepEqual(await f.open(worktree), { root: worktree, initialized: false })
})

test('a worktree init failure is static, leaves markers untouched and does not initialize the main checkout', async () => {
  const f = await fixture()
  await f.createGit()
  const worktree = join(f.home, 'worktree')
  f.git(['worktree', 'add', '-b', 'linked-worktree', worktree])
  const pointer = await readFile(join(worktree, '.git'))
  const runJj: RepositoryInitRunner = async () => {
    throw new Error('raw stderr https://secret@example.invalid/private')
  }
  await assert.rejects(ensureJujutsuRepository({ path: worktree, runJj }), {
    message: 'Jujutsu could not initialize this Git worktree. This JJ version may not support Git worktrees; existing metadata was not replaced.',
  })
  assert.deepEqual(await readFile(join(worktree, '.git')), pointer)
  await absent(join(worktree, '.jj'))
  await absent(join(f.repo, '.jj'))
})

test('initialization verifies the exact canonical root and rejects wrong or truncated runner output', async () => {
  for (const mode of ['wrong-root', 'truncated'] as const) {
    const f = await fixture()
    await f.createGit()
    const runJj: RepositoryInitRunner = async (cwd, args, signal) =>
      args.includes('init') ? f.runJj(cwd, args, signal) : { stdout: `${mode === 'wrong-root' ? f.home : f.repo}\n`, truncated: mode === 'truncated' }
    await assert.rejects(ensureJujutsuRepository({ path: f.repo, runJj }), { message: 'Jujutsu did not confirm the exact selected repository root.' })
  }
})

test('a changed root identity during a managed init is rejected rather than accepted as the original repository', async () => {
  const f = await fixture()
  await f.createGit()
  const runJj: RepositoryInitRunner = async (cwd, args, signal) => {
    const result = await f.runJj(cwd, args, signal)
    if (args.includes('init')) {
      await rename(f.repo, join(f.home, 'original'))
      await f.createGit()
    }
    return result
  }
  await assert.rejects(ensureJujutsuRepository({ path: f.repo, runJj }), {
    message: 'Repository identity changed before initialization. Open the repository again.',
  })
  await absent(join(f.repo, '.jj'))
})

test('pre-cancelled requests do not execute any subprocess', async () => {
  const f = await fixture()
  await f.createGit()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(ensureJujutsuRepository({ path: f.repo, runJj: f.runJj, signal: controller.signal }), { message: 'Jujutsu request was cancelled.' })
  assert.deepEqual(f.calls, [])
  await absent(join(f.repo, '.jj'))
})

test('an unborn Git branch initializes without creating a Git commit or moving staged/untracked content', async () => {
  const f = await fixture()
  f.git(['init', '--initial-branch=unborn'])
  await writeFile(join(f.repo, 'staged.txt'), 'staged\n')
  f.git(['add', 'staged.txt'])
  await writeFile(join(f.repo, 'untracked.txt'), 'untracked\n')
  const before = {
    head: f.git(['symbolic-ref', 'HEAD']),
    refs: f.git(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads/']),
    status: f.git(['status', '--porcelain']),
    staged: f.git(['diff', '--cached', '--binary']),
  }
  assert.deepEqual(await f.open(), { root: f.repo, initialized: true })
  assert.deepEqual(
    {
      head: f.git(['symbolic-ref', 'HEAD']),
      refs: f.git(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads/']),
      status: f.git(['status', '--porcelain']),
      staged: f.git(['diff', '--cached', '--binary']),
    },
    before,
  )
})

test('an existing linked JJ workspace repo pointer remains a read-only no-op', async () => {
  const f = await fixture()
  f.jj(['git', 'init', '--no-colocate'])
  const workspace = join(f.home, 'jj-workspace')
  f.jj(['workspace', 'add', workspace])
  const pointer = await readFile(join(workspace, '.jj', 'repo'))
  assert.deepEqual(await f.open(workspace), { root: workspace, initialized: false })
  assert.deepEqual(await readFile(join(workspace, '.jj', 'repo')), pointer)
  assert.equal(initCalls(f.calls).length, 0)
})

test('oversized Git markers fail closed before any JJ command', async () => {
  const f = await fixture()
  await f.createGit()
  const nested = join(f.repo, 'nested')
  await mkdir(nested)
  await writeFile(join(nested, '.git'), `gitdir: ${'x'.repeat(9000)}\n`)
  await assert.rejects(f.open(nested), RepositoryInitializationError)
  assert.deepEqual(f.calls, [])
  await absent(join(f.repo, '.jj'))
})

test("an aborted waiting opener cannot cancel another opener's shared initialization", async () => {
  const f = await fixture()
  await f.createGit()
  let entered: (() => void) | undefined
  let release: (() => void) | undefined
  const started = new Promise<void>(resolveStarted => {
    entered = resolveStarted
  })
  const gate = new Promise<void>(resolveGate => {
    release = resolveGate
  })
  const runJj: RepositoryInitRunner = async (cwd, args, signal) => {
    if (args.includes('init')) {
      entered?.()
      await gate
    }
    return f.runJj(cwd, args, signal)
  }
  const owner = ensureJujutsuRepository({ path: f.repo, runJj })
  await started
  const controller = new AbortController()
  const waiter = ensureJujutsuRepository({ path: f.repo, runJj, signal: controller.signal })
  controller.abort()
  await assert.rejects(waiter, { message: 'Jujutsu request was cancelled.' })
  release?.()
  assert.deepEqual(await owner, { root: f.repo, initialized: true })
  assert.equal(initCalls(f.calls).length, 1)
})

test('a normal JJ snapshot after init has its usual independent untracked-file/index effects', async () => {
  const f = await fixture()
  await f.createGit()
  await dirty(f.repo, f.git)
  await f.open()
  assert.ok(f.git(['status', '--porcelain']).includes('?? untracked.bin'))
  f.jj(['status'])
  assert.ok(!f.git(['status', '--porcelain']).includes('?? untracked.bin'))
  assert.ok(f.git(['status', '--porcelain']).includes(' A untracked.bin'))
  assert.equal(f.git(['diff', '--name-only', '--', 'untracked.bin']).trim(), 'untracked.bin')
  assert.equal(f.git(['diff', '--cached', '--name-only', '--', 'untracked.bin']).trim(), '')
  assert.deepEqual(await readFile(join(f.repo, 'untracked.bin')), Buffer.from([0, 9, 128, 255]))
})
