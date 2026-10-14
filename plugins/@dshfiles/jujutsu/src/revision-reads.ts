import { PluginApiError } from '@dshfiles/dshx/api'
import { z } from 'zod'
import type { FileStat, ReadFailure, RevisionDetails } from './api.js'
import { fileStatusLetter, isCommitId, parseJsonLines, parsePatchStats } from './core.js'
import { FILE_STATS_TEMPLATE } from './jj-templates.js'

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
    const rows = parseJsonLines(completeOutput, value => fileStatsRowSchema.parse(value))
    let truncated = result.truncated
    const revisions = rows.map(row => {
      if (row.files.length > 2000) truncated = true
      const conflicts = new Set(row.conflicts)
      return {
        commitId: row.commitId,
        files: row.files.slice(0, 2000).map(file => ({
          path: file.path,
          status: fileStatusLetter(file.status),
          additions: file.additions,
          deletions: file.deletions,
          conflict: conflicts.has(file.path),
        })),
      }
    })
    return { revisions, truncated }
  }

  static async details(run: JjRun, commitId: string): Promise<RevisionDetails> {
    if (!isCommitId(commitId)) throw new Error('Invalid revision id.')
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
    const files = parsePatchStats(patch.stdout, paths, patch.truncated).map(file => ({
      ...file,
      status: statByPath.get(file.path)?.status ?? fileStatusLetter('modified'),
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

  /** Host messages are written for users and never carry stderr; anything else falls back to a generic message. */
  static failure(error: unknown, fallback: string): ReadFailure {
    const message = error instanceof Error && SAFE_FAILURE_MESSAGE.test(error.message) ? error.message.slice(0, 500) : fallback
    return { failure: { message } }
  }

  /** The same user-written messages, thrown so the Client reads them; anything else stays a generic, Host-logged failure. */
  static publicError(error: unknown): unknown {
    return error instanceof Error && SAFE_FAILURE_MESSAGE.test(error.message) ? new PluginApiError(error.message, { cause: error }) : error
  }
}
