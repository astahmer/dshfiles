import type { Context } from '@deepseek-ai/cordis'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { composerContextApi, type ComposerBase } from './composer-context-api.js'
import { RevisionReads } from './revision-reads.js'
import {
  COMPOSER_BOOKMARKS_TEMPLATE,
  COMPOSER_FILE_TEMPLATE,
  COMPOSER_HEAD_TEMPLATE,
  COMPOSER_LOCAL_BOOKMARK_LIST_TEMPLATE,
  COMPOSER_WORKSPACE_TEMPLATE,
  ComposerContextModel,
} from './composer-context-core.js'
import { JujutsuOutputModel, JujutsuPathModel } from './core.js'

type RunJj = (
  ctx: Context,
  cwd: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
  options: { readonly outputLimit: number },
) => Promise<{ readonly stdout: string; readonly truncated: boolean }>

const headSchema = z.object({
  changeId: z.string().max(64),
  commitId: z.string().max(64),
  bookmarks: z.array(z.string().max(256)).max(32),
  empty: z.boolean(),
  conflict: z.boolean(),
  description: z.string().max(20_000),
})

const fileRowSchema = z.object({ path: z.string().max(2048), status: z.string().max(32) })
const baseRevisionIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
const baseRevisionIdsSchema = z.array(baseRevisionIdSchema).max(2)
const nameListSchema = z.array(z.string().max(256)).max(64)
const MAX_FILES = 500

/** A Session's cwd keeps its workspace root, so the composer resolves it once instead of spawning jj on every read. */
const WORKSPACE_ROOT_TTL_MS = 60_000
const workspaceRoots = new Map<string, { readonly root: string; readonly at: number }>()

/** Canonical workspace root for a Session cwd, or null when the directory is not inside a JJ workspace. */
const workspaceRoot = async (ctx: Context, run: RunJj, cwd: string, signal: AbortSignal | undefined): Promise<string | null> => {
  let canonical: string
  try {
    canonical = await realpath(JujutsuPathModel.validatedRepositoryPath(cwd))
  } catch {
    return null
  }
  const known = workspaceRoots.get(canonical)
  if (known !== undefined && Date.now() - known.at < WORKSPACE_ROOT_TTL_MS) {
    // A forgotten workspace takes its directory with it; resolving the root again proves it still exists.
    const root = await realpath(known.root).catch(() => null)
    if (root !== null) return root
    workspaceRoots.delete(canonical)
  }
  try {
    const result = await run(ctx, canonical, ['workspace', 'root'], signal, { outputLimit: 8_000 })
    const root = result.stdout.trim()
    if (result.truncated || root.length === 0 || root.includes('\n') || !isAbsolute(root)) return null
    const resolved = await realpath(root)
    workspaceRoots.set(canonical, { root: resolved, at: Date.now() })
    if (workspaceRoots.size > 256) for (const [path, entry] of workspaceRoots) if (Date.now() - entry.at > WORKSPACE_ROOT_TTL_MS) workspaceRoots.delete(path)
    return resolved
  } catch {
    if (signal?.aborted === true) throw new Error('Jujutsu request was cancelled.')
    return null
  }
}

const baseLabel = (base: ComposerBase, targetBookmarks: readonly string[]): string => {
  if (base.kind === 'bookmark') return base.name
  if (base.kind === 'trunk') return targetBookmarks[0] ?? 'trunk()'
  return '@-'
}

/** The composer bar re-reads its JJ context on every render burst; one read per argument set serves them all. */
const COMPOSER_READ_TTL_MS = 2_000

/**
 * The store's operation heads as seen from a workspace root, or null when unreadable. A `--ignore-working-copy` read
 * depends only on them, so it is reused until an operation lands instead of for two seconds: each jj spawn loads the
 * repository view first, 80–340 ms on a store with dozens of workspaces.
 */
const operationHeads = (root: string): string | null => {
  try {
    const marker = join(root, '.jj', 'repo')
    const store = statSync(marker).isDirectory() ? marker : resolve(dirname(marker), readFileSync(marker, 'utf8').trim())
    return readdirSync(join(store, 'op_heads', 'heads'))
      .sort()
      .join(',')
  } catch {
    return null
  }
}

/** Read-only JJ context for the composer: one snapshotting read, then parallel reads that skip the working copy. */
/** Memoized JJ reads: in-flight reads are shared, snapshotting reads last two seconds, view reads one operation head. */
export const composerReads = (directRun: RunJj): RunJj => {
  const readResults = new Map<string, { readonly value: Awaited<ReturnType<RunJj>>; readonly at: number }>()
  const readsInFlight = new Map<string, Promise<Awaited<ReturnType<RunJj>>>>()
  return (ctx, cwd, args, signal, options) => {
    const heads = args[0] === '--ignore-working-copy' ? operationHeads(cwd) : null
    const key = `${cwd}\u0000${heads ?? ''}\u0000${args.join('\u0000')}\u0000${String(options.outputLimit)}`
    const cached = readResults.get(key)
    if (cached !== undefined && (heads !== null || Date.now() - cached.at < COMPOSER_READ_TTL_MS)) return Promise.resolve(cached.value)
    const inFlight = readsInFlight.get(key)
    if (inFlight !== undefined) return inFlight
    const read = directRun(ctx, cwd, args, signal, options).then(value => {
      readResults.set(key, { value, at: Date.now() })
      if (readResults.size > 256) readResults.delete(readResults.keys().next().value ?? key)
      return value
    })
    readsInFlight.set(key, read)
    return read.finally(() => {
      if (readsInFlight.get(key) === read) readsInFlight.delete(key)
    })
  }
}

export const composerContextHost = (directRun: RunJj) => {
  const run = composerReads(directRun)
  return composerContextApi.host({
    context: async ({ input, ctx, signal }) => {
      const root = await workspaceRoot(ctx, run, input.cwd, signal)
      if (root === null) return { repository: null }
      const headResult = await run(ctx, root, ['log', '--no-graph', '--revisions', '@', '--template', COMPOSER_HEAD_TEMPLATE], signal, { outputLimit: 64_000 })
      const head = JujutsuOutputModel.parseJsonLines(headResult.stdout, value => headSchema.parse(value))[0]
      if (head === undefined) return { repository: null }
      const read = (args: readonly string[], outputLimit: number) => run(ctx, root, ['--ignore-working-copy', ...args], signal, { outputLimit })
      const range = ComposerContextModel.composerDiffRange(input.base)
      const [nearest, baseTarget, baseRevision, stat, files, localBookmarks, workspaces] = await Promise.all([
        read(['log', '--no-graph', '--revisions', 'heads(::@- & bookmarks())', '--limit', '2', '--template', COMPOSER_BOOKMARKS_TEMPLATE], 16_000),
        read(
          ['log', '--no-graph', '--revisions', ComposerContextModel.composerBaseTarget(input.base), '--limit', '1', '--template', COMPOSER_BOOKMARKS_TEMPLATE],
          16_000,
        ).catch(() => null),
        read(
          ['log', '--no-graph', '--revisions', ComposerContextModel.composerBaseTarget(input.base), '--limit', '2', '--template', 'commit_id ++ "\\n"'],
          256,
        ).catch(() => null),
        read(['diff', ...range, '--stat'], 256_000).catch(() => null),
        read(['diff', ...range, '--template', COMPOSER_FILE_TEMPLATE], 512_000).catch(() => null),
        read(['bookmark', 'list', '--template', COMPOSER_LOCAL_BOOKMARK_LIST_TEMPLATE], 32_000).catch(() => null),
        read(['workspace', 'list', '--template', COMPOSER_WORKSPACE_TEMPLATE], 16_000).catch(() => null),
      ])
      const completeLines = (result: { readonly stdout: string; readonly truncated: boolean }): string =>
        result.truncated ? result.stdout.slice(0, result.stdout.lastIndexOf('\n') + 1) : result.stdout
      const nearestBookmarks = JujutsuOutputModel.parseJsonLines(completeLines(nearest), value => nameListSchema.parse(value)).flat()
      const targetBookmarks = baseTarget === null ? [] : JujutsuOutputModel.parseJsonLines(completeLines(baseTarget), value => nameListSchema.parse(value))
      const baseRevisionIds =
        baseRevision === null || baseRevision.truncated || baseRevision.stdout.trim().length === 0
          ? []
          : baseRevisionIdsSchema.parse(baseRevision.stdout.trim().split('\n'))
      const resolvedBaseCommitId = baseRevisionIds.length === 1 ? baseRevisionIds[0] : undefined
      const readRevisionCount = async (revset: string): Promise<number | null> => {
        try {
          const result = await read(['log', '--no-graph', '--revisions', revset, '--template', '"x"'], 1_000_000)
          return ComposerContextModel.parseRevisionCount(result.stdout, result.truncated)
        } catch {
          return null
        }
      }
      const revisionCounts =
        resolvedBaseCommitId === undefined
          ? null
          : await (async () => {
              const revsets = ComposerContextModel.revisionCountRevsets(resolvedBaseCommitId)
              const [ahead, behind] = await Promise.all([readRevisionCount(revsets.ahead), readRevisionCount(revsets.behind)])
              return ahead === null || behind === null ? null : { ahead, behind }
            })()
      const fileRows = files === null ? [] : JujutsuOutputModel.parseJsonLines(completeLines(files), value => fileRowSchema.parse(value))
      const bookmarkNames =
        localBookmarks === null ? [] : JujutsuOutputModel.parseJsonLines(completeLines(localBookmarks), value => z.string().max(256).parse(value))
      const workspaceNames = workspaces === null ? [] : JujutsuOutputModel.parseJsonLines(completeLines(workspaces), value => z.string().max(128).parse(value))
      return {
        repository: {
          root,
          // Two workspaces sharing one @ commit both match; the first is the usual single match.
          workspace: workspaceNames[0] ?? null,
          changeId: head.changeId,
          commitId: head.commitId,
          description: head.description.slice(0, 500),
          empty: head.empty,
          conflict: head.conflict,
          bookmarks: head.bookmarks,
          nearestBookmarks: [...new Set(nearestBookmarks)].slice(0, 32),
          base: { label: baseLabel(input.base, targetBookmarks[0] ?? []), found: resolvedBaseCommitId !== undefined },
          revisionCounts,
          totals: stat === null || stat.truncated ? null : ComposerContextModel.parseStatTotals(stat.stdout),
          files: fileRows.slice(0, MAX_FILES).map(row => ({ path: row.path, status: JujutsuOutputModel.fileStatusLetter(row.status) })),
          filesTruncated: files === null || files.truncated || fileRows.length > MAX_FILES,
          localBookmarks: bookmarkNames.slice(0, 200),
        },
      }
    },
    diff: async ({ input, ctx, signal }) => {
      try {
        const root = await workspaceRoot(ctx, run, input.cwd, signal)
        if (root === null) throw new Error('Jujutsu could not find a workspace for this Session.')
        const patch = await run(ctx, root, ['diff', ...ComposerContextModel.composerDiffRange(input.base), '--git'], signal, { outputLimit: 1_160_000 })
        return {
          patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout,
          truncated: patch.truncated,
          files: ComposerContextModel.parsePatchFileStats(patch.stdout).slice(0, 2000),
        }
      } catch (error) {
        throw RevisionReads.publicError(error)
      }
    },
  })
}
