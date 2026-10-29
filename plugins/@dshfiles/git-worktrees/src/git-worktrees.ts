import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { PluginApiError } from '@dshfiles/dshx/api'
import { commandAttributes, tracingEnabled, withSpan } from '@dshfiles/dshx/tracing'

interface GitResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface GitLocation {
  /** The main worktree: the repository a thread worktree belongs to. */
  readonly repoRoot: string
  readonly workspaceRoot: string
  /** Set when the worktree is one of the thread worktrees this plugin creates. */
  readonly threadName: string | undefined
}

export interface ThreadWorktree {
  readonly name: string
  readonly path: string
  readonly branch: string | null
}

const THREAD_NAME = /^thread-[0-9a-f]{6}$/u
const OBJECT_ID = /^[0-9a-f]{40,64}$/u
const SNAPSHOT_AUTHOR = { GIT_AUTHOR_NAME: 'dsh', GIT_AUTHOR_EMAIL: 'dsh@localhost', GIT_COMMITTER_NAME: 'dsh', GIT_COMMITTER_EMAIL: 'dsh@localhost' }

const runGit = (args: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Promise<GitResult> => {
  const execute = () =>
    new Promise<GitResult>(settle => {
      execFile(
        'git',
        ['-c', 'core.quotePath=false', ...args],
        { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
          settle({ exitCode, stdout, stderr })
        },
      )
    })
  if (!tracingEnabled()) return execute()
  const attributes = commandAttributes({ executable: 'git', args, valueFlags: ['-c', '-C', '-b', '-m'] })
  return withSpan(`git ${String(attributes['process.command.verb'])}`.trim(), { kind: 'client', attributes }, async span => {
    const result = await execute()
    span.setAttributes({ 'process.exit.code': result.exitCode })
    if (result.exitCode !== 0) span.setStatus('error', `exit ${String(result.exitCode)}`)
    return result
  })
}

const git = async (args: readonly string[], cwd: string, env?: Readonly<Record<string, string>>): Promise<string> => {
  const result = await runGit(args, cwd, env)
  if (result.exitCode !== 0) throw new PluginApiError(`git ${args[0] ?? ''}: ${result.stderr.trim().slice(0, 400)}`, { code: 'git-failed' })
  return result.stdout
}

/**
 * Plain git repositories: thread worktrees beside the repository and file snapshots as unreferenced-but-kept commits.
 * A snapshot is a commit of every tracked and untracked, non-ignored file under `refs/dsh/snapshots/`, built in a
 * throwaway index so neither the real index nor HEAD moves.
 */
export const createGitWorktrees = (options: { readonly threadsDirectory: (repoRoot: string) => string }) => {
  const locate = async (path: string): Promise<GitLocation | undefined> => {
    const result = await runGit(['rev-parse', '--show-toplevel', '--git-common-dir'], path)
    if (result.exitCode !== 0) return undefined
    const [toplevel, commonDir] = result.stdout.trim().split('\n')
    if (toplevel === undefined || commonDir === undefined) return undefined
    const workspaceRoot = resolve(toplevel)
    const repoRoot = dirname(resolve(workspaceRoot, commonDir))
    const threadsDirectory = options.threadsDirectory(repoRoot)
    const isThread = workspaceRoot !== repoRoot && dirname(workspaceRoot) === threadsDirectory && THREAD_NAME.test(basename(workspaceRoot))
    return { repoRoot, workspaceRoot, threadName: isThread ? basename(workspaceRoot) : undefined }
  }

  const requireLocation = async (path: string): Promise<GitLocation> => {
    const location = await locate(path)
    if (location === undefined) throw new PluginApiError(`${path} is not inside a git repository.`, { code: 'not-a-repository' })
    return location
  }

  const worktrees = async (repoRoot: string): Promise<readonly ThreadWorktree[]> => {
    const threadsDirectory = options.threadsDirectory(repoRoot)
    const listed = await git(['worktree', 'list', '--porcelain'], repoRoot)
    return listed.split('\n\n').flatMap((block): ThreadWorktree[] => {
      const lines = block.split('\n')
      const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
      const branch = lines.find(line => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? null
      if (path === undefined || dirname(path) !== threadsDirectory || !THREAD_NAME.test(basename(path))) return []
      return [{ name: basename(path), path, branch }]
    })
  }

  const provision = async (repoRoot: string, base: string | undefined): Promise<ThreadWorktree> => {
    const threadsDirectory = options.threadsDirectory(repoRoot)
    await mkdir(threadsDirectory, { recursive: true })
    const name = `thread-${randomBytes(3).toString('hex')}`
    const path = join(threadsDirectory, name)
    const branch = `dsh/${name}`
    await git(['worktree', 'add', '-b', branch, path, base ?? 'HEAD'], repoRoot)
    return { name, path, branch }
  }

  const remove = async (path: string, force: boolean): Promise<void> => {
    const location = await requireLocation(path)
    if (location.threadName === undefined) throw new PluginApiError(`${path} is not a thread worktree this plugin created.`, { code: 'not-a-thread' })
    await git(['worktree', 'remove', ...(force ? ['--force'] : []), location.workspaceRoot], location.repoRoot)
  }

  const snapshot = async (path: string): Promise<string> => {
    const { workspaceRoot } = await requireLocation(path)
    const scratch = await mkdtemp(join(tmpdir(), 'dsh-git-snapshot-'))
    try {
      const index = { GIT_INDEX_FILE: join(scratch, 'index') }
      await git(['add', '--all', '.'], workspaceRoot, index)
      const tree = (await git(['write-tree'], workspaceRoot, index)).trim()
      const commit = (await git(['commit-tree', tree, '-m', 'dsh file snapshot'], workspaceRoot, SNAPSHOT_AUTHOR)).trim()
      if (!OBJECT_ID.test(commit)) throw new PluginApiError('git commit-tree returned no commit id.', { code: 'git-failed' })
      await git(['update-ref', `refs/dsh/snapshots/${commit}`, commit], workspaceRoot)
      return commit
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  const restore = async (path: string, target: string): Promise<string> => {
    if (!OBJECT_ID.test(target)) throw new PluginApiError('That snapshot is not a git commit id.', { code: 'invalid-snapshot' })
    const { workspaceRoot } = await requireLocation(path)
    const previous = await snapshot(workspaceRoot)
    const added = (await git(['diff', '--name-only', '-z', '--diff-filter=A', target, previous], workspaceRoot)).split('\0').filter(file => file.length > 0)
    await Promise.all(added.map(file => rm(join(workspaceRoot, file), { force: true })))
    const scratch = await mkdtemp(join(tmpdir(), 'dsh-git-restore-'))
    try {
      const index = { GIT_INDEX_FILE: join(scratch, 'index') }
      await git(['read-tree', target], workspaceRoot, index)
      await git(['checkout-index', '--all', '--force'], workspaceRoot, index)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
    return previous
  }

  return { locate, worktrees, provision, remove, snapshot, restore }
}

export type GitWorktrees = ReturnType<typeof createGitWorktrees>
