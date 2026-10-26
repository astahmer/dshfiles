import { PluginApiError } from '@dshfiles/dshx/api'
import { z } from 'zod'
import type { FileStat, ReadFailure, RevisionDetails } from './api.js'
import { JujutsuMutationModel, JujutsuOutputModel } from './core.js'
import { EDIT_TIME_TEMPLATE, FILE_STATS_TEMPLATE } from './jj-templates.js'

export interface JjRunResult {
  readonly stdout: string
  readonly truncated: boolean
}

export type JjRun = (args: readonly string[], options?: { readonly outputLimit?: number }) => Promise<JjRunResult>

const fileStatsRowSchema = z.object({
  commitId: z.string().regex(/^[a-f0-9]{40,64}$/),
  files: z
    .array(
      z.object({
        path: z.string().max(2048),
        status: z.string().max(32),
        additions: z.number().int().min(0),
        deletions: z.number().int().min(0),
      }),
    )
    .max(20_000),
  conflicts: z.array(z.string().max(2048)).max(20_000).default([]),
})

const editTimeRowSchema = z.object({
  commitId: z.string().regex(/^[a-f0-9]{40,64}$/),
  changeId: z.string().regex(/^[a-f0-9]{20,64}$/),
  edited: z.boolean(),
  time: z.string().max(64),
})

/** A commit's edit time never changes, so it is kept by repository and commit id for the life of the Host. */
const editTimeCache = new Map<string, string | null>()
const EDIT_TIME_CACHE_LIMIT = 50_000
/** A just-rewritten commit usually resolves from its newest entries or a cached predecessor; the full log is the last resort. */
const EDIT_TIME_EVOLOG_LIMITS = [2, 32, undefined] as const
const EDIT_TIME_CONCURRENCY = 4

const SAFE_FAILURE_MESSAGE =
  /^(Choose |Invalid |Registered |Selected |Split |Jujutsu |Repository |Revision |Changed |Remote |Bookmark |Preview |Workspace |Descriptions )/

/**
 * Reads that never snapshot the working copy. A commit id names immutable content, so reading it with
 * `--ignore-working-copy` stays correct while other jj processes snapshot and rewrite `@` concurrently.
 */
export class RevisionReads {
  static readonly ignoreWorkingCopy = '--ignore-working-copy'

  static async paths(run: JjRun, revision: string): Promise<string[]> {
    const result = await run([RevisionReads.ignoreWorkingCopy, 'diff', '--revisions', revision, '--name-only'], { outputLimit: 256_000 })
    if (result.truncated) throw new Error('Changed file list exceeded the bounded output limit.')
    return result.stdout
      .split(/\r?\n/)
      .filter(path => path.length > 0)
      .slice(0, 1000)
  }

  static async fileStats(
    run: JjRun,
    commitIds: readonly string[],
  ): Promise<{ readonly revisions: { readonly commitId: string; readonly files: FileStat[] }[]; readonly truncated: boolean }> {
    const result = await run([RevisionReads.ignoreWorkingCopy, 'log', '--no-graph', '--revisions', commitIds.join('|'), '--template', FILE_STATS_TEMPLATE], {
      outputLimit: 1_000_000,
    })
    const completeOutput = result.truncated ? result.stdout.slice(0, result.stdout.lastIndexOf('\n') + 1) : result.stdout
    const rows = JujutsuOutputModel.parseJsonLines(completeOutput, value => fileStatsRowSchema.parse(value))
    let truncated = result.truncated
    const revisions = rows.map(row => {
      if (row.files.length > 2000) truncated = true
      const conflicts = new Set(row.conflicts)
      return {
        commitId: row.commitId,
        files: row.files.slice(0, 2000).map(file => ({
          path: file.path,
          status: JujutsuOutputModel.fileStatusLetter(file.status),
          additions: file.additions,
          deletions: file.deletions,
          conflict: conflicts.has(file.path),
        })),
      }
    })
    return { revisions, truncated }
  }

  /**
   * A full commit id, a unique hex prefix or a change id → the full commit id.
   * `jj log` resolves prefixes and change ids; a prefix matching two revisions
   * errors rather than guessing, which is the same rule the CLI applies.
   */
  static async resolveCommitId(run: JjRun, reference: string): Promise<string> {
    if (JujutsuMutationModel.isCommitId(reference)) return reference
    let stdout: string
    try {
      const resolved = await run([RevisionReads.ignoreWorkingCopy, 'log', '--no-graph', '--revisions', reference, '--limit', '2', '--template', 'commit_id'], {
        outputLimit: 1_000,
      })
      stdout = resolved.stdout
    } catch (error) {
      if (error instanceof Error && /cancelled|timed out/.test(error.message)) throw error
      // jj exits non-zero for both "no such revision" and an ambiguous prefix; neither is a repo failure.
      throw new Error(`"${reference}" does not name exactly one revision. Use a longer commit id prefix, or the full id from jj log.`)
    }
    const ids = [
      ...new Set(
        stdout
          .split('\n')
          .map(line => line.trim())
          .filter(line => JujutsuMutationModel.isCommitId(line)),
      ),
    ]
    if (ids.length === 1 && ids[0] !== undefined) return ids[0]
    if (ids.length === 0) throw new Error(`No revision matches "${reference}". Check the id against jj log and try again.`)
    throw new Error(`"${reference}" matches more than one revision (${ids.map(id => id.slice(0, 12)).join(', ')}). Use a longer prefix.`)
  }

  static async details(run: JjRun, reference: string): Promise<RevisionDetails> {
    const commitId = await RevisionReads.resolveCommitId(run, reference)
    try {
      await run([RevisionReads.ignoreWorkingCopy, 'log', '--no-graph', '--revisions', commitId, '--limit', '1', '--template', 'commit_id'], {
        outputLimit: 1_000,
      })
    } catch (error) {
      if (error instanceof Error && /cancelled|timed out/.test(error.message)) throw error
      throw new Error('Revision ' + commitId.slice(0, 12) + ' is no longer available. Refresh and try again.')
    }
    const paths = await RevisionReads.paths(run, commitId)
    const patch = await run([RevisionReads.ignoreWorkingCopy, 'diff', '--revisions', commitId, '--git'])
    const evolution = await run([RevisionReads.ignoreWorkingCopy, 'evolog', '--no-graph', '--revisions', commitId, '--limit', '30'], { outputLimit: 118_000 })
    const stats = await RevisionReads.fileStats(run, [commitId])
    const statByPath = new Map(stats.revisions[0]?.files.map(file => [file.path, file]) ?? [])
    const files = JujutsuOutputModel.parsePatchStats(patch.stdout, paths, patch.truncated).map(file => ({
      ...file,
      status: statByPath.get(file.path)?.status ?? JujutsuOutputModel.fileStatusLetter('modified'),
      conflict: statByPath.get(file.path)?.conflict ?? false,
    }))
    return {
      files,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout,
      truncated: patch.truncated,
      evolution: evolution.truncated ? evolution.stdout + '\n[evolution output truncated]' : evolution.stdout,
    }
  }

  /** When each commit's own content last changed: the newest evolution entry that edited it, or null when none did. */
  static async editTimes(
    run: JjRun,
    input: { readonly repositoryRoot: string; readonly commitIds: readonly string[] },
  ): Promise<{ readonly commitId: string; readonly editedAt: string | null }[]> {
    const cacheKey = (commitId: string): string => input.repositoryRoot + '\0' + commitId
    const remember = (commitIds: readonly string[], editedAt: string | null): string | null => {
      for (const commitId of commitIds) {
        if (editTimeCache.size >= EDIT_TIME_CACHE_LIMIT) editTimeCache.delete(editTimeCache.keys().next().value ?? '')
        editTimeCache.set(cacheKey(commitId), editedAt)
      }
      return editedAt
    }
    const resolve = async (commitId: string): Promise<string | null> => {
      const cached = editTimeCache.get(cacheKey(commitId))
      if (cached !== undefined) return cached
      for (const limit of EDIT_TIME_EVOLOG_LIMITS) {
        const result = await run(
          [
            RevisionReads.ignoreWorkingCopy,
            'evolog',
            '--no-graph',
            '--revisions',
            commitId,
            ...(limit === undefined ? [] : ['--limit', String(limit)]),
            '--template',
            EDIT_TIME_TEMPLATE,
          ],
          { outputLimit: 2_000_000 },
        )
        const completeOutput = result.truncated ? result.stdout.slice(0, result.stdout.lastIndexOf('\n') + 1) : result.stdout
        const entries = JujutsuOutputModel.parseJsonLines(completeOutput, value => editTimeRowSchema.parse(value))
        const changeId = entries[0]?.changeId
        // Squashed-in revisions bring their own history into the log; only this change's versions count.
        const versions = entries.filter(entry => entry.changeId === changeId)
        const visited: string[] = []
        for (const version of versions) {
          const known = editTimeCache.get(cacheKey(version.commitId))
          if (known !== undefined) return remember(visited, known)
          visited.push(version.commitId)
          if (version.edited) return remember(visited, version.time)
        }
        const complete = !result.truncated && (limit === undefined || entries.length < limit)
        if (complete) return remember(visited, null)
      }
      return null
    }
    const commitIds = [...new Set(input.commitIds)]
    const editTimes: { readonly commitId: string; readonly editedAt: string | null }[] = []
    for (let start = 0; start < commitIds.length; start += EDIT_TIME_CONCURRENCY) {
      const batch = commitIds.slice(start, start + EDIT_TIME_CONCURRENCY)
      editTimes.push(...(await Promise.all(batch.map(async commitId => ({ commitId, editedAt: await resolve(commitId) })))))
    }
    return editTimes
  }

  /** Host messages are written for users and never carry stderr; anything else falls back to a generic message. */
  static failure(error: unknown, fallback: string): ReadFailure {
    const message = error instanceof Error && SAFE_FAILURE_MESSAGE.test(error.message) ? error.message.slice(0, 500) : fallback
    return { failure: { message } }
  }

  /** The same user-written messages, thrown so the Client reads them; anything else stays a generic, Host-logged failure. */
  static publicError(error: unknown): Error {
    if (error instanceof Error && SAFE_FAILURE_MESSAGE.test(error.message)) return new PluginApiError(error.message, { cause: error })
    return new Error('Jujutsu request failed.', { cause: error })
  }
}
