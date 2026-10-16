import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { JsonText } from './json-text.js'

export interface JjResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type JjExecutor = (input: { readonly args: readonly string[]; readonly cwd: string; readonly signal?: AbortSignal }) => Promise<JjResult>

export class ThreadError extends Error {
  constructor(
    readonly code: 'not-a-repository' | 'not-a-thread' | 'jj-failed' | 'unsafe-path',
    message: string,
  ) {
    super(message)
    this.name = 'ThreadError'
  }
}

export interface ThreadRevision {
  readonly changeId: string
  readonly commitId: string
  readonly description: string
  readonly conflict: boolean
}

export interface ThreadLocation {
  /** Root of the checkout that owns the jj store; thread workspaces sit in its `-threads` sibling. */
  readonly repoRoot: string
  readonly workspaceRoot: string
  readonly threadName: string | undefined
}

export const isSecondaryWorkspace = (location: ThreadLocation): boolean => location.workspaceRoot !== location.repoRoot

export interface ThreadStatus {
  readonly name: string
  readonly path: string
  readonly repoRoot: string
  readonly missing: boolean
  /** Non-empty revisions in the thread that the target bookmark does not contain yet. */
  readonly unlanded: readonly ThreadRevision[]
  /** The target bookmark moved since this thread last rebased. */
  readonly behind: boolean
  /** Timestamp of the latest successful land, persisted beside the thread workspaces. */
  readonly rebasedAt?: number
  /** Change ID of the bookmark tip when this thread last landed. */
  readonly rebasedTipChangeId?: string
}

export type LandOutcome =
  | { readonly status: 'landed'; readonly revisions: readonly ThreadRevision[]; readonly head: ThreadRevision | undefined }
  | { readonly status: 'nothing-to-land' }
  | { readonly status: 'needs-description'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'conflicted'; readonly revisions: readonly ThreadRevision[]; readonly files: readonly string[] }

export type DiscardOutcome = { readonly status: 'discarded' } | { readonly status: 'has-work'; readonly revisions: readonly ThreadRevision[] }

const REVISION_TEMPLATE = 'change_id.short(12) ++ "\\t" ++ commit_id ++ "\\t" ++ conflict ++ "\\t" ++ description.first_line() ++ "\\n"'
const PLACEHOLDER_DESCRIPTIONS = new Set(['', 'wip'])
const MAX_CONFLICT_FILES = 50
const LAND_ATTEMPTS = 3
const rebaseTimestampSchema = z.number().int().nonnegative().safe()
const rebaseMetadataEntrySchema = z.object({ at: rebaseTimestampSchema, tipChangeId: z.string().min(1).max(128).optional() }).strict()
const rebaseMetadataValueSchema = z.union([rebaseTimestampSchema, rebaseMetadataEntrySchema])
const rebaseMetadataSchema = z.record(z.string(), rebaseMetadataValueSchema)
type RebaseMetadataEntry = z.infer<typeof rebaseMetadataEntrySchema>

const parseRevisions = (stdout: string): readonly ThreadRevision[] =>
  stdout
    .split('\n')
    .filter(line => line.includes('\t'))
    .map(line => {
      const [changeId = '', commitId = '', conflict = 'false', ...description] = line.split('\t')
      return { changeId, commitId, conflict: conflict === 'true', description: description.join('\t').trim() }
    })

/** `<root>/.jj/repo` is the store in the owning checkout and a pointer file in every other workspace. */
const storeRootOf = (workspaceRoot: string): string | undefined => {
  const marker = join(workspaceRoot, '.jj', 'repo')
  if (!existsSync(marker)) return undefined
  if (statSync(marker).isDirectory()) return workspaceRoot
  const store = resolve(dirname(marker), readFileSync(marker, 'utf8').trim())
  return dirname(dirname(store))
}

export const createThreads = (options: {
  readonly executor: JjExecutor
  readonly bookmark: () => string
  readonly threadsDirectory: (repoRoot: string) => string
}) => {
  const locks = new Map<string, Promise<unknown>>()
  /** Every mutation of one store runs in order, so two rebases never race to move the same bookmark. */
  const serialized = <Value>(repoRoot: string, operation: () => Promise<Value>): Promise<Value> => {
    const next = (locks.get(repoRoot) ?? Promise.resolve()).then(operation, operation)
    locks.set(
      repoRoot,
      next.catch(() => undefined),
    )
    return next
  }

  const jj = async (args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> => {
    const result = await options.executor({ args, cwd, ...(signal === undefined ? {} : { signal }) })
    if (result.exitCode !== 0) throw new ThreadError('jj-failed', `jj ${args.join(' ').slice(0, 120)}: ${result.stderr.trim().slice(0, 400)}`)
    return result.stdout
  }

  const revisions = async (revset: string, cwd: string, observe = false): Promise<readonly ThreadRevision[]> =>
    parseRevisions(await jj([...(observe ? ['--ignore-working-copy'] : []), 'log', '--no-graph', '-r', revset, '-T', REVISION_TEMPLATE], cwd))

  const locate = async (path: string): Promise<ThreadLocation> => {
    const result = await options.executor({ args: ['--ignore-working-copy', 'root'], cwd: path })
    if (result.exitCode !== 0) throw new ThreadError('not-a-repository', `${path} is not inside a jj repository.`)
    const workspaceRoot = result.stdout.trim()
    const repoRoot = storeRootOf(workspaceRoot) ?? workspaceRoot
    const isThread = workspaceRoot !== repoRoot && dirname(workspaceRoot) === options.threadsDirectory(repoRoot)
    return { repoRoot, workspaceRoot, threadName: isThread ? basename(workspaceRoot) : undefined }
  }

  const requireThread = async (path: string): Promise<ThreadLocation & { readonly threadName: string }> => {
    const location = await locate(path)
    if (location.threadName === undefined) throw new ThreadError('not-a-thread', `${path} is not a thread workspace.`)
    return { ...location, threadName: location.threadName }
  }

  const workingCopyCommitId = async (path: string): Promise<string> => {
    const commitId = (await jj(['log', '--no-graph', '-r', '@', '-T', 'commit_id'], path)).trim()
    if (commitId.length === 0) throw new ThreadError('jj-failed', 'Could not resolve the current working-copy revision.')
    return commitId
  }

  const unlandedRevset = (name: string): string => `(::${name}@ ~ ::${options.bookmark()}) ~ empty()`
  const timestampFile = (repoRoot: string): string => join(options.threadsDirectory(repoRoot), '.dshfiles-rebase-timestamps.json')
  const readRebaseMetadata = async (repoRoot: string): Promise<Readonly<Record<string, RebaseMetadataEntry>>> => {
    try {
      const parsed = JsonText.decode(rebaseMetadataSchema, await readFile(timestampFile(repoRoot), 'utf8'))
      if (parsed?.success !== true) return {}
      return Object.fromEntries(
        Object.entries(parsed.data)
          .filter(([name]) => name.startsWith('thread-'))
          .map(([name, value]) => [name, typeof value === 'number' ? { at: value } : value]),
      )
    } catch {
      return {}
    }
  }
  const writeRebaseMetadata = async (repoRoot: string, name: string, tipChangeId: string | undefined): Promise<number> => {
    const at = Date.now()
    const directory = options.threadsDirectory(repoRoot)
    await mkdir(directory, { recursive: true })
    const path = timestampFile(repoRoot)
    const temporaryPath = `${path}.${randomBytes(4).toString('hex')}.tmp`
    const metadataForThread: RebaseMetadataEntry = { at }
    if (tipChangeId !== undefined) metadataForThread.tipChangeId = tipChangeId
    const metadata = { ...(await readRebaseMetadata(repoRoot)), [name]: metadataForThread }
    await writeFile(temporaryPath, JSON.stringify(metadata), 'utf8')
    await rename(temporaryPath, path)
    return at
  }
  const withRebaseMetadata = (status: ThreadStatus, metadata: RebaseMetadataEntry | undefined): ThreadStatus => {
    if (metadata === undefined) return status
    const statusWithTimestamp = { ...status, rebasedAt: metadata.at }
    if (metadata.tipChangeId === undefined) return statusWithTimestamp
    return { ...statusWithTimestamp, rebasedTipChangeId: metadata.tipChangeId }
  }

  const list = async (repoRoot: string): Promise<readonly ThreadStatus[]> => {
    const directory = options.threadsDirectory(repoRoot)
    const names = (await jj(['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"'], repoRoot)).split('\n').filter(name => name.length > 0)
    const rebaseMetadata = await readRebaseMetadata(repoRoot)
    const threads: ThreadStatus[] = []
    for (const name of names) {
      const path = join(directory, name)
      const present = existsSync(join(path, '.jj'))
      if (!present && !name.startsWith('thread-')) continue
      const status = {
        name,
        path,
        repoRoot,
        missing: !present,
        unlanded: await revisions(unlandedRevset(name), repoRoot, true),
        behind: (await revisions(`${name}@ ~ ${options.bookmark()}::`, repoRoot, true)).length > 0,
      }
      threads.push(withRebaseMetadata(status, rebaseMetadata[name]))
    }
    return threads
  }

  const status = async (repoRoot: string, name: string): Promise<ThreadStatus> => {
    const path = join(options.threadsDirectory(repoRoot), name)
    const bookmark = options.bookmark()
    const [unlanded, behind, rebaseMetadata] = await Promise.all([
      revisions(`(::@ ~ ::${bookmark}) ~ empty()`, path, true),
      revisions(`@ ~ ${bookmark}::`, path, true),
      readRebaseMetadata(repoRoot),
    ])
    const threadStatus = { name, path, repoRoot, missing: !existsSync(join(path, '.jj')), unlanded, behind: behind.length > 0 }
    return withRebaseMetadata(threadStatus, rebaseMetadata[name])
  }

  const provision = (repoRoot: string, base?: string, requestedName?: string): Promise<{ readonly name: string; readonly path: string }> =>
    serialized(repoRoot, async () => {
      const name = requestedName ?? `thread-${randomBytes(3).toString('hex')}`
      const directory = options.threadsDirectory(repoRoot)
      const path = join(directory, name)
      await mkdir(directory, { recursive: true })
      // Plain `workspace add`: with --ignore-working-copy jj registers the workspace but never checks its files out.
      await jj(['workspace', 'add', path, '--name', name, '-r', base ?? options.bookmark()], repoRoot)
      return { name, path }
    })

  const landAt = (thread: ThreadLocation & { readonly threadName: string }, signal?: AbortSignal): Promise<LandOutcome> =>
    serialized(thread.repoRoot, async () => {
      const cwd = thread.workspaceRoot
      const bookmark = options.bookmark()
      const leftovers = await revisions(`((${bookmark}..@) & empty()) ~ @ ~ merges() ~ working_copies()`, cwd)
      if (leftovers.length > 0) await jj(['abandon', ...leftovers.map(revision => revision.commitId)], cwd, signal)
      const work = await revisions(`(${bookmark}..@) ~ empty()`, cwd)
      if (work.length === 0) {
        await jj(['rebase', '-b', '@', '-d', bookmark], cwd, signal)
        return { status: 'nothing-to-land' }
      }
      const undescribed = work.filter(revision => PLACEHOLDER_DESCRIPTIONS.has(revision.description.toLowerCase()))
      if (undescribed.length > 0) return { status: 'needs-description', revisions: undescribed }

      for (let attempt = 1; ; attempt++) {
        await jj(['rebase', '-b', '@', '-d', bookmark], cwd, signal)
        const [rebased, emptyWorkingCopies] = await Promise.all([revisions(`(${bookmark}..@) ~ empty()`, cwd, true), revisions('@ & empty()', cwd, true)])
        const conflicted = rebased.filter(revision => revision.conflict)
        if (conflicted.length > 0) {
          const files = new Set<string>()
          for (const revision of conflicted) {
            const listed = await options.executor({ args: ['resolve', '--list', '-r', revision.commitId], cwd })
            for (const line of listed.stdout.split('\n')) {
              const file = line.trim().split(/\s{2,}/)[0]
              if (file !== undefined && file.length > 0) files.add(file)
            }
          }
          return { status: 'conflicted', revisions: conflicted, files: [...files].slice(0, MAX_CONFLICT_FILES) }
        }
        const workingCopyEmpty = emptyWorkingCopies.length > 0
        const target = workingCopyEmpty ? '@-' : '@'
        // A bookmark only moves forward; if another writer advanced it meanwhile, rebase again onto the new tip.
        const moved = await options.executor({ args: ['bookmark', 'set', bookmark, '-r', target], cwd })
        if (moved.exitCode === 0) {
          if (!workingCopyEmpty) await jj(['new', bookmark], cwd, signal)
          const head = rebased[0]
          await writeRebaseMetadata(thread.repoRoot, thread.threadName, head?.changeId).catch(() => undefined)
          return { status: 'landed', revisions: rebased, head }
        }
        if (attempt >= LAND_ATTEMPTS) throw new ThreadError('jj-failed', `Could not move ${bookmark}: ${moved.stderr.trim().slice(0, 400)}`)
      }
    })

  const land = async (path: string, signal?: AbortSignal): Promise<LandOutcome> => landAt(await requireThread(path), signal)

  const discard = (input: { readonly repoRoot: string; readonly name: string; readonly force: boolean }): Promise<DiscardOutcome> =>
    serialized(input.repoRoot, async () => {
      const { repoRoot, name: threadName } = input
      if (threadName.includes('/') || threadName.startsWith('.')) throw new ThreadError('unsafe-path', `Refusing to discard workspace ${threadName}.`)
      const directory = options.threadsDirectory(repoRoot)
      const workspaceRoot = join(directory, threadName)
      // Snapshot first so edits still on disk count as work.
      if (existsSync(join(workspaceRoot, '.jj'))) await jj(['status'], workspaceRoot)
      const work = await revisions(unlandedRevset(threadName), repoRoot, true)
      if (work.length > 0 && !input.force) return { status: 'has-work', revisions: work }
      const owned = await revisions(`(::${threadName}@ ~ ::${options.bookmark()}) ~ ::(working_copies() ~ ${threadName}@)`, repoRoot, true)
      await jj(['--ignore-working-copy', 'workspace', 'forget', threadName], repoRoot)
      if (owned.length > 0) await jj(['--ignore-working-copy', 'abandon', ...owned.map(revision => revision.commitId)], repoRoot)
      await rm(workspaceRoot, { recursive: true, force: true })
      return { status: 'discarded' }
    })

  /** Local bookmarks, and the nearest one the workspace at `path` builds on. */
  const bookmarks = async (path: string): Promise<{ readonly current: string | null; readonly names: readonly string[] }> => {
    const names = (await jj(['--ignore-working-copy', 'bookmark', 'list', '-T', 'if(remote, "", name ++ "\\n")'], path))
      .split('\n')
      .filter(name => name.length > 0)
    const nearest = await jj(
      ['--ignore-working-copy', 'log', '--no-graph', '-r', 'heads(::@ & bookmarks())', '-T', 'local_bookmarks.map(|b| b.name()).join("\\n") ++ "\\n"'],
      path,
    )
    const preferred = options.bookmark()
    const candidates = nearest.split('\n').filter(name => name.length > 0)
    return { current: candidates.includes(preferred) ? preferred : (candidates[0] ?? null), names: [...new Set(names)] }
  }

  const revisionGraph = async (path: string): Promise<string> => {
    const thread = await requireThread(path)
    const operationId = (await jj(['--ignore-working-copy', 'op', 'log', '--limit', '1', '--no-graph', '-T', 'id'], thread.workspaceRoot)).trim()
    if (operationId.length === 0) throw new ThreadError('jj-failed', 'Could not read the current jj operation.')

    const readAtOperation = (args: readonly string[]): Promise<string> =>
      jj(['--ignore-working-copy', '--at-operation', operationId, ...args], thread.workspaceRoot)
    const workspaceNames = (await readAtOperation(['workspace', 'list', '-T', 'name ++ "\\n"'])).split('\n')
    const hasDefaultWorkspace = workspaceNames.includes('default')
    const commitIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
    const defaultCommitId = hasDefaultWorkspace
      ? commitIdSchema.safeParse((await readAtOperation(['log', '--no-graph', '-r', 'default@', '-T', 'commit_id.short(64)'])).trim())
      : undefined
    if (defaultCommitId !== undefined && !defaultCommitId.success) {
      throw new ThreadError('jj-failed', 'Could not resolve the default workspace revision.')
    }
    const defaultWorkspaceLabel = defaultCommitId === undefined ? '""' : `if(commit_id.short(64) == "${defaultCommitId.data}", "default@", "")`
    const bookmark = options.bookmark()
    const bookmarkLiteral = JSON.stringify(bookmark)
    const threadRevisionLimit = 16
    const threadRevisionLines = (
      await readAtOperation(['log', '--no-graph', '--limit', String(threadRevisionLimit), '-r', `::@ ~ ::${bookmark}`, '-T', 'commit_id ++ "\\n"'])
    )
      .split('\n')
      .filter(line => line.length > 0)
    const threadRevisionIds = z.array(commitIdSchema).max(threadRevisionLimit).safeParse(threadRevisionLines)
    if (!threadRevisionIds.success) throw new ThreadError('jj-failed', 'Could not read thread revision IDs for the graph.')
    const revset = ['@', ...threadRevisionIds.data, bookmark, `present(${bookmark}@origin)`, ...(hasDefaultWorkspace ? ['default@'] : [])].join(' | ')
    const template = [
      'change_id.short(8)',
      '" "',
      `local_bookmarks.filter(|bookmark| bookmark.name() == ${bookmarkLiteral}).map(|bookmark| bookmark.name()).join(",")`,
      '" "',
      `remote_bookmarks.filter(|bookmark| bookmark.name() == ${bookmarkLiteral} && bookmark.remote() == "origin").map(|bookmark| bookmark.name() ++ "@" ++ bookmark.remote()).join(",")`,
      '" "',
      defaultWorkspaceLabel,
      '" "',
      'description.first_line().substr(0, 64)',
      '"\\n"',
    ].join(' ++ ')
    return (await readAtOperation(['log', '--no-pager', '--color=never', '--limit', '20', '-r', revset, '-T', template])).trimEnd()
  }

  return { locate, list, status, provision, land, landAt, discard, bookmarks, workingCopyCommitId, revisionGraph }
}

export type Threads = ReturnType<typeof createThreads>

export const defaultThreadsDirectory = (repoRoot: string): string => `${repoRoot}-threads`

/**
 * `dshx checkout sync` from the dshx this plugin builds with: the one routine that brings the checkout running DSH
 * onto the bookmark after rebasing, and that agents run after moving the bookmark by hand. Throws when dshx is missing.
 */
export const checkoutSyncArgv = (input: { readonly repoRoot: string; readonly workspace: string; readonly bookmark: string }): readonly string[] => [
  process.execPath,
  join(dirname(createRequire(import.meta.url).resolve('@dshfiles/dshx')), 'cli', 'bin.js'),
  'checkout',
  'sync',
  '--workspace',
  input.workspace,
  '--bookmark',
  input.bookmark,
  '--cwd',
  input.repoRoot,
  '--json',
]
