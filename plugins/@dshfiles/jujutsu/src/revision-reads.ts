import { Clock, Effect, Option, Schema } from 'effect'
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
  predecessors: Schema.Array(Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/))),
  time: Schema.String.check(Schema.isMaxLength(64)),
})

const EDIT_TIME_CACHE_LIMIT = 50_000
/** A just-rewritten commit usually resolves from its newest entries or a cached predecessor; the full log is the last resort. */
const EDIT_TIME_EVOLOG_LIMITS = [2, 32, undefined] as const
const EDIT_TIME_CONCURRENCY = 4
const EDIT_TIME_OUTPUT_LIMIT = 2_000_000

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

/** What a caller may name a revision by: a 1–64 hex commit id prefix or a 1–32 letter (k–z) change id prefix. */
const REVISION_REFERENCE = /^(?:[a-f0-9]{1,64}|[k-z]{1,32})$/u
const MULTIPLE_CANDIDATES = 5

/** jj's own words for a prefix that matches several ids; any other non-zero exit is "no such revision". */
const isAmbiguousPrefix = (cause: unknown): boolean => {
  const stderr = typeof cause === 'object' && cause !== null && 'stderr' in cause && typeof cause.stderr === 'string' ? cause.stderr : ''
  return /prefix .* is ambiguous/iu.test(stderr)
}

/**
 * A full commit id, a unique hex prefix or a change id prefix → the full commit id. The reference is read through
 * `commit_id()` or `change_id()` (the alphabets do not overlap), so a bookmark or tag that happens to look like a
 * prefix never shadows it. A prefix of several commits is refused as ambiguous, a change with divergent copies lists
 * them, and an unknown one says so: none of them guesses.
 */
const resolveCommitId = Effect.fnUntraced(function* (run: JjRun, reference: string) {
  if (JujutsuMutationModel.isCommitId(reference)) return reference
  if (!REVISION_REFERENCE.test(reference)) return yield* new RevisionNotFound({ reason: 'reference', reference, candidates: [] })
  const revset = /^[a-f0-9]+$/u.test(reference) ? `commit_id(${reference})` : `change_id(${reference})`
  const resolved = yield* run(
    [ignoreWorkingCopy, 'log', '--no-graph', '--revisions', revset, '--limit', String(MULTIPLE_CANDIDATES + 1), '--template', 'commit_id ++ "\\n"'],
    { outputLimit: 8_000 },
  ).pipe(
    Effect.catchTag('JujutsuCommandFailed', failed =>
      Effect.fail(new RevisionNotFound({ reason: isAmbiguousPrefix(failed.cause) ? 'ambiguous' : 'no-match', reference, candidates: [], cause: failed })),
    ),
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
  return yield* new RevisionNotFound({ reason: 'multiple', reference, candidates: ids.slice(0, MULTIPLE_CANDIDATES).map(id => id.slice(0, 12)) })
})

/** Resolve several references at once, each at most once; full ids cost no jj process. */
const resolveCommitIds = Effect.fnUntraced(function* (run: JjRun, references: readonly string[]) {
  const unique = [...new Set(references)]
  const resolved = yield* Effect.forEach(unique, reference => resolveCommitId(run, reference), { concurrency: 4 })
  const byReference = new Map(unique.map((reference, index) => [reference, resolved[index] ?? reference]))
  return references.map(reference => byReference.get(reference) ?? reference)
})

/** The part of a revision's details that a commit id fixes for good: its files, stats and patch against its parents. */
type RevisionContent = Omit<RevisionDetails, 'evolution'>

const DETAIL_CACHE_BYTES = 24 * 1024 * 1024
const DETAIL_CACHE_ENTRIES = 64
/** Evolution gains entries when an operation rewrites the revision, so it is only reused briefly (simultaneous selections). */
const EVOLUTION_FRESHNESS_MS = 5_000
const EVOLUTION_CACHE_ENTRIES = 64
/** Content reads after validation: paths, patch, file stats and evolution; four jj processes at most per detail. */
const DETAIL_READ_CONCURRENCY = 4

const contentBytes = (content: RevisionContent): number =>
  content.patch.length * 2 + content.files.reduce((sum, file) => sum + file.path.length * 2 + 96, 0) + 128

/**
 * Byte-capped LRU of immutable revision content, keyed by repository identity and commit id, plus a short-lived
 * evolution entry per commit. Only complete successes are stored; a failed read leaves nothing behind.
 */
export interface RevisionDetailCache {
  readonly content: (key: string) => RevisionContent | undefined
  readonly rememberContent: (key: string, content: RevisionContent) => void
  readonly evolution: (key: string, now: number) => string | undefined
  readonly rememberEvolution: (key: string, evolution: string, now: number) => void
  readonly stats: () => { readonly entries: number; readonly bytes: number }
}

export const makeRevisionDetailCache = (limits: { readonly bytes?: number; readonly entries?: number } = {}): RevisionDetailCache => {
  const maxBytes = limits.bytes ?? DETAIL_CACHE_BYTES
  const maxEntries = limits.entries ?? DETAIL_CACHE_ENTRIES
  const contents = new Map<string, { readonly content: RevisionContent; readonly bytes: number }>()
  const evolutions = new Map<string, { readonly text: string; readonly at: number }>()
  let bytes = 0
  const evict = () => {
    while (contents.size > maxEntries || bytes > maxBytes) {
      const oldest = contents.keys().next()
      if (oldest.done === true) return
      bytes -= contents.get(oldest.value)?.bytes ?? 0
      contents.delete(oldest.value)
    }
  }
  return {
    content: key => {
      const entry = contents.get(key)
      if (entry === undefined) return undefined
      contents.delete(key)
      contents.set(key, entry)
      return entry.content
    },
    rememberContent: (key, content) => {
      const size = contentBytes(content)
      if (size > maxBytes / 4) return
      bytes -= contents.get(key)?.bytes ?? 0
      contents.delete(key)
      contents.set(key, { content, bytes: size })
      bytes += size
      evict()
    },
    evolution: (key, now) => {
      const entry = evolutions.get(key)
      if (entry === undefined) return undefined
      if (now - entry.at > EVOLUTION_FRESHNESS_MS) {
        evolutions.delete(key)
        return undefined
      }
      return entry.text
    },
    rememberEvolution: (key, text, now) => {
      evolutions.delete(key)
      evolutions.set(key, { text, at: now })
      if (evolutions.size > EVOLUTION_CACHE_ENTRIES) evolutions.delete(evolutions.keys().next().value ?? '')
    },
    stats: () => ({ entries: contents.size, bytes }),
  }
}

const readContent = Effect.fnUntraced(function* (run: JjRun, commitId: string) {
  const [changedPaths, patch, stats] = yield* Effect.all(
    [paths(run, commitId), run([ignoreWorkingCopy, 'diff', '--revisions', commitId, '--git']), fileStats(run, [commitId])],
    { concurrency: DETAIL_READ_CONCURRENCY },
  )
  const statByPath = new Map(stats.revisions[0]?.files.map(file => [file.path, file]) ?? [])
  const files = JujutsuOutputModel.parsePatchStats(patch.stdout, changedPaths, patch.truncated).map(file => ({
    ...file,
    status: statByPath.get(file.path)?.status ?? JujutsuOutputModel.fileStatusLetter('modified'),
    conflict: statByPath.get(file.path)?.conflict ?? false,
  }))
  const content: RevisionContent = {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout,
    truncated: patch.truncated,
  }
  return content
})

const readEvolution = Effect.fnUntraced(function* (run: JjRun, commitId: string) {
  const evolution = yield* run([ignoreWorkingCopy, 'evolog', '--no-graph', '--revisions', commitId, '--limit', '30'], { outputLimit: 118_000 })
  return evolution.truncated ? evolution.stdout + '\n[evolution output truncated]' : evolution.stdout
})

/**
 * One revision's details. After the commit is proven visible, its content (paths, patch, file stats) and evolution
 * are read concurrently, so the critical path is the slowest read instead of their sum. Content is immutable for a
 * commit id and may come from `cache`; evolution can gain successors and is reused only for a few seconds.
 */
const details = Effect.fnUntraced(function* (
  run: JjRun,
  reference: string,
  options: { readonly cache?: RevisionDetailCache | undefined; readonly cacheKey?: string | undefined } = {},
) {
  const commitId = yield* resolveCommitId(run, reference)
  yield* run([ignoreWorkingCopy, 'log', '--no-graph', '--revisions', commitId, '--limit', '1', '--template', 'commit_id'], { outputLimit: 1_000 }).pipe(
    Effect.catchTag('JujutsuCommandFailed', cause => Effect.fail(new RevisionNotFound({ reason: 'unavailable', reference: commitId, candidates: [], cause }))),
  )
  const key = options.cacheKey === undefined ? undefined : options.cacheKey + '\0' + commitId
  const now = yield* Clock.currentTimeMillis
  const cachedContent = key === undefined ? undefined : options.cache?.content(key)
  const cachedEvolution = key === undefined ? undefined : options.cache?.evolution(key, now)
  const [content, evolution] = yield* Effect.all(
    [
      cachedContent === undefined ? readContent(run, commitId) : Effect.succeed(cachedContent),
      cachedEvolution === undefined ? readEvolution(run, commitId) : Effect.succeed(cachedEvolution),
    ],
    { concurrency: 2 },
  )
  if (key !== undefined && options.cache !== undefined) {
    if (cachedContent === undefined) options.cache.rememberContent(key, content)
    if (cachedEvolution === undefined) options.cache.rememberEvolution(key, evolution, yield* Clock.currentTimeMillis)
  }
  const revisionDetails: RevisionDetails = { ...content, evolution }
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
  type EditTimeRow = typeof editTimeRowSchema.Type
  /** Walk one change's versions newest first: the first edit wins, and a cached version answers for the rest. */
  type Walked = { readonly decided: true; readonly editedAt: string | null } | { readonly decided: false; readonly visited: readonly string[] }
  const walk = (versions: readonly EditTimeRow[]): Walked => {
    const visited: string[] = []
    for (const version of versions) {
      const known = input.cache.get(cacheKey(version.commitId))
      if (Option.isSome(known)) return { decided: true, editedAt: remember(visited, known.value) }
      visited.push(version.commitId)
      if (version.edited) return { decided: true, editedAt: remember(visited, version.time) }
    }
    return { decided: false, visited }
  }
  /**
   * Every uncached commit from one `jj evolog` over their revset: a jj process costs about as much as the walk itself,
   * so one process per commit made a 100-revision page take seconds. Nothing is decided when the read fails or is
   * truncated, and each commit then takes the per-commit path.
   */
  const batched = Effect.fnUntraced(function* (commitIds: readonly string[]) {
    if (commitIds.length < 2) return
    const result = yield* run([ignoreWorkingCopy, 'evolog', '--no-graph', '--revisions', commitIds.join('|'), '--template', EDIT_TIME_TEMPLATE], {
      outputLimit: EDIT_TIME_OUTPUT_LIMIT,
    }).pipe(Effect.option)
    if (Option.isNone(result) || result.value.truncated) return
    const entries = JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(result.value), editTimeRowSchema)
    if (entries._tag === 'Failure') return
    const byCommit = new Map(entries.success.map(entry => [entry.commitId, entry]))
    /**
     * The versions of one commit, newest first, by its own predecessor links: one log interleaves every requested
     * commit, and divergent copies share a change id. `complete` when the chain reaches the change's first version;
     * any other end (a predecessor from another change, a missing row) leaves the commit to the per-commit read.
     */
    const chainOf = (commitId: string) => {
      const versions: EditTimeRow[] = []
      let current = byCommit.get(commitId)
      while (current !== undefined) {
        versions.push(current)
        // A version with several predecessors is a squash, which `edited` already reports.
        if (current.edited) return { versions, complete: true }
        const [only, ...others] = current.predecessors
        if (only === undefined) return { versions, complete: true }
        const previous = byCommit.get(only)
        if (others.length > 0 || previous?.changeId !== current.changeId) return { versions, complete: false }
        current = previous
      }
      return { versions, complete: false }
    }
    for (const commitId of commitIds) {
      if (Option.isSome(input.cache.get(cacheKey(commitId)))) continue
      const chain = chainOf(commitId)
      const walked = walk(chain.versions)
      if (!walked.decided && chain.complete) remember(walked.visited, null)
    }
  })
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
        { outputLimit: EDIT_TIME_OUTPUT_LIMIT },
      )
      const entries = yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(result), editTimeRowSchema))
      const changeId = entries[0]?.changeId
      // Squashed-in revisions bring their own history into the log; only this change's versions count.
      const walked = walk(entries.filter(entry => entry.changeId === changeId))
      if (walked.decided) return walked.editedAt
      if (!result.truncated && (limit === undefined || entries.length < limit)) return remember(walked.visited, null)
    }
    return null
  })
  const commitIds = [...new Set(input.commitIds)]
  yield* batched(commitIds.filter(commitId => Option.isNone(input.cache.get(cacheKey(commitId)))))
  return yield* Effect.forEach(commitIds, commitId => Effect.map(resolve(commitId), editedAt => ({ commitId, editedAt })), {
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
  static readonly resolveCommitIds = resolveCommitIds
  static readonly details = details
  static readonly editTimes = editTimes
}
