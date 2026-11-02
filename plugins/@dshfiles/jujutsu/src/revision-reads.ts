import { Effect, Option, Schema } from 'effect'
import type { FileStat, RevisionDetails } from './api.js'
import { JujutsuMutationModel, JujutsuOutputModel } from './core.js'
import { OutputLimitExceeded, RevisionNotFound } from './errors.js'
import type { JjRun } from './jujutsu-commands.js'
import { EDIT_TIME_TEMPLATE, FILE_STATS_TEMPLATE } from './jj-templates.js'

const fileStatsRowSchema = Schema.Struct({
  commitId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/)),
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String.check(Schema.isMaxLength(2048)),
      status: Schema.String.check(Schema.isMaxLength(32)),
      additions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      deletions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    }),
  ).check(Schema.isMaxLength(20_000)),
  conflicts: Schema.Array(Schema.String.check(Schema.isMaxLength(2048)))
    .check(Schema.isMaxLength(20_000))
    .pipe(Schema.withDecodingDefaultType(Effect.succeed([]))),
})

const editTimeRowSchema = Schema.Struct({
  commitId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/)),
  changeId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{20,64}$/)),
  edited: Schema.Boolean,
  time: Schema.String.check(Schema.isMaxLength(64)),
})

const EDIT_TIME_CACHE_LIMIT = 50_000
/** A just-rewritten commit usually resolves from its newest entries or a cached predecessor; the full log is the last resort. */
const EDIT_TIME_EVOLOG_LIMITS = [2, 32, undefined] as const
const EDIT_TIME_CONCURRENCY = 4

const ignoreWorkingCopy = '--ignore-working-copy'

/** A commit's edit time never changes, so it is kept by repository and commit id for the life of the Host. */
export interface EditTimeCache {
  readonly get: (key: string) => Option.Option<string | null>
  readonly set: (key: string, editedAt: string | null) => void
}

export const makeEditTimeCache = (): EditTimeCache => {
  const entries = new Map<string, string | null>()
  return {
    get: key => (entries.has(key) ? Option.some(entries.get(key) ?? null) : Option.none()),
    set: (key, editedAt) => {
      if (entries.size >= EDIT_TIME_CACHE_LIMIT) entries.delete(entries.keys().next().value ?? '')
      entries.set(key, editedAt)
    },
  }
}

const paths = Effect.fnUntraced(function* (run: JjRun, revision: string) {
  const result = yield* run([ignoreWorkingCopy, 'diff', '--revisions', revision, '--name-only'], { outputLimit: 256_000 })
  if (result.truncated) return yield* new OutputLimitExceeded({ subject: 'changed-files' })
  return result.stdout
    .split(/\r?\n/)
    .filter(path => path.length > 0)
    .slice(0, 1000)
})

const fileStats = Effect.fnUntraced(function* (run: JjRun, commitIds: readonly string[]) {
  const result = yield* run([ignoreWorkingCopy, 'log', '--no-graph', '--revisions', commitIds.join('|'), '--template', FILE_STATS_TEMPLATE], {
    outputLimit: 1_000_000,
  })
  const rows = yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(result), fileStatsRowSchema))
  const revisions: { readonly commitId: string; readonly files: FileStat[] }[] = rows.map(row => {
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
  return { revisions, truncated: result.truncated || rows.some(row => row.files.length > 2000) }
})

/**
 * A full commit id, a unique hex prefix or a change id → the full commit id. `jj log` resolves prefixes and change
 * ids; a prefix matching two revisions errors rather than guessing, which is the same rule the CLI applies.
 */
const resolveCommitId = Effect.fnUntraced(function* (run: JjRun, reference: string) {
  if (JujutsuMutationModel.isCommitId(reference)) return reference
  const resolved = yield* run([ignoreWorkingCopy, 'log', '--no-graph', '--revisions', reference, '--limit', '2', '--template', 'commit_id'], {
    outputLimit: 1_000,
  }).pipe(
    // jj exits non-zero for both "no such revision" and an ambiguous prefix; neither is a repository failure.
    Effect.catchTag('JujutsuCommandFailed', cause => Effect.fail(new RevisionNotFound({ reason: 'ambiguous', reference, candidates: [], cause }))),
  )
  const ids = [
    ...new Set(
      resolved.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => JujutsuMutationModel.isCommitId(line)),
    ),
  ]
  const [only] = ids
  if (ids.length === 1 && only !== undefined) return only
  if (ids.length === 0) return yield* new RevisionNotFound({ reason: 'no-match', reference, candidates: [] })
  return yield* new RevisionNotFound({ reason: 'multiple', reference, candidates: ids.map(id => id.slice(0, 12)) })
})

const details = Effect.fnUntraced(function* (run: JjRun, reference: string) {
  const commitId = yield* resolveCommitId(run, reference)
  yield* run([ignoreWorkingCopy, 'log', '--no-graph', '--revisions', commitId, '--limit', '1', '--template', 'commit_id'], { outputLimit: 1_000 }).pipe(
    Effect.catchTag('JujutsuCommandFailed', cause => Effect.fail(new RevisionNotFound({ reason: 'unavailable', reference: commitId, candidates: [], cause }))),
  )
  const changedPaths = yield* paths(run, commitId)
  const patch = yield* run([ignoreWorkingCopy, 'diff', '--revisions', commitId, '--git'])
  const evolution = yield* run([ignoreWorkingCopy, 'evolog', '--no-graph', '--revisions', commitId, '--limit', '30'], { outputLimit: 118_000 })
  const stats = yield* fileStats(run, [commitId])
  const statByPath = new Map(stats.revisions[0]?.files.map(file => [file.path, file]) ?? [])
  const files = JujutsuOutputModel.parsePatchStats(patch.stdout, changedPaths, patch.truncated).map(file => ({
    ...file,
    status: statByPath.get(file.path)?.status ?? JujutsuOutputModel.fileStatusLetter('modified'),
    conflict: statByPath.get(file.path)?.conflict ?? false,
  }))
  const revisionDetails: RevisionDetails = {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout,
    truncated: patch.truncated,
    evolution: evolution.truncated ? evolution.stdout + '\n[evolution output truncated]' : evolution.stdout,
  }
  return revisionDetails
})

/** When each commit's own content last changed: the newest evolution entry that edited it, or null when none did. */
const editTimes = Effect.fnUntraced(function* (
  run: JjRun,
  input: { readonly repositoryRoot: string; readonly commitIds: readonly string[]; readonly cache: EditTimeCache },
) {
  const cacheKey = (commitId: string): string => input.repositoryRoot + '\0' + commitId
  const remember = (commitIds: readonly string[], editedAt: string | null): string | null => {
    for (const commitId of commitIds) input.cache.set(cacheKey(commitId), editedAt)
    return editedAt
  }
  const resolve = Effect.fnUntraced(function* (commitId: string) {
    const cached = input.cache.get(cacheKey(commitId))
    if (Option.isSome(cached)) return cached.value
    for (const limit of EDIT_TIME_EVOLOG_LIMITS) {
      const result = yield* run(
        [
          ignoreWorkingCopy,
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
      const entries = yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(result), editTimeRowSchema))
      const changeId = entries[0]?.changeId
      // Squashed-in revisions bring their own history into the log; only this change's versions count.
      const versions = entries.filter(entry => entry.changeId === changeId)
      const visited: string[] = []
      for (const version of versions) {
        const known = input.cache.get(cacheKey(version.commitId))
        if (Option.isSome(known)) return remember(visited, known.value)
        visited.push(version.commitId)
        if (version.edited) return remember(visited, version.time)
      }
      if (!result.truncated && (limit === undefined || entries.length < limit)) return remember(visited, null)
    }
    return null
  })
  return yield* Effect.forEach([...new Set(input.commitIds)], commitId => Effect.map(resolve(commitId), editedAt => ({ commitId, editedAt })), {
    concurrency: EDIT_TIME_CONCURRENCY,
  })
})

/**
 * Reads that never snapshot the working copy. A commit id names immutable content, so reading it with
 * `--ignore-working-copy` stays correct while other jj processes snapshot and rewrite `@` concurrently.
 */
export class RevisionReads {
  static readonly ignoreWorkingCopy = ignoreWorkingCopy
  static readonly paths = paths
  static readonly fileStats = fileStats
  static readonly resolveCommitId = resolveCommitId
  static readonly details = details
  static readonly editTimes = editTimes
}
