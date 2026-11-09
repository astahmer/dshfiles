import { createHash } from 'node:crypto'
import { Cache, Context, Duration, Effect, Layer, Schema } from 'effect'
import { GRAPH_PAGE_BYTE_BUDGET, GRAPH_PAGE_SIZE, REVISION_PAGE_SIZE, revisionSchema, type JujutsuState, type Revision } from './api.js'
import { JujutsuOutputModel, type TargetState } from './core.js'
import { OutputLimitExceeded } from './errors.js'
import { GraphNavigationReads } from './graph-navigation-reads.js'
import { GraphPage } from './graph-page.js'
import { matchesRevisionSearch } from './graph.js'
import { EVOLUTION_TEMPLATE, OPERATION_ID_TEMPLATE, REVISION_TEMPLATE, TARGET_TEMPLATE } from './jj-templates.js'
import { ReferenceGraphModel } from './reference-graph.js'
import { Repositories } from './repositories.js'
import { RepositoryIdentity, type RegisteredRepo } from './repository-identity.js'
import { makeEditTimeCache, makeRevisionDetailCache, RevisionReads } from './revision-reads.js'

const MAX_WORKSPACE_HEAD_CANDIDATES = 32
const EVOLUTION_LIMIT = 100
const OPERATION_LIMIT = 1000
/** Operations read first once a push scan is known: a new head usually adds a handful, so the full scan is rare. */
const OPERATION_INCREMENT = 64
/** Commits whose evolved flag is remembered per Host; one flag is a few bytes. */
const EVOLVED_CACHE_LIMIT = 20_000
const MAX_DISPLAY_LOADS = 64

const commitIdSchema = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/))

/** One `jj evolog` row from EVOLUTION_TEMPLATE. */
const evolutionRowSchema = Schema.Struct({ commitId: commitIdSchema, predecessors: Schema.Array(commitIdSchema) })

/** One `jj operation log` row from OPERATION_TEMPLATE. */
const operationRowSchema = Schema.Struct({ id: Schema.String, description: Schema.String, attributes: Schema.String, time: Schema.String })

interface LastPush {
  readonly at: string | null
  readonly description: string | null
  readonly historyTruncated: boolean
}

/** The newest operation a last-push scan saw, and what it found from there back. */
interface PushScan {
  readonly headId: string
  readonly push: LastPush
}

const remoteNamePattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/

const ignoreWorkingCopy = RevisionReads.ignoreWorkingCopy

/** The panel's view of a repository and the identity it was read under. */
export interface Snapshot {
  readonly state: JujutsuState
  readonly identity: string
}

/** What one prepared action names; `targetState` reads exactly this, at preview and again at confirmation. */
export interface MutationTarget {
  readonly commitIds: readonly string[]
  readonly bookmark?: string | undefined
  readonly remote?: boolean | undefined
  readonly workspace?: string | undefined
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

const withEvolved = (revisions: readonly Revision[], evolved: ReadonlySet<string>): Revision[] =>
  revisions.map(revision => ({ ...revision, evolved: evolved.has(revision.commitId) }))

const make = Effect.gen(function* () {
  const repositories = yield* Repositories
  const identity = yield* RepositoryIdentity
  const editTimeCache = makeEditTimeCache()
  /**
   * Whether a commit rewrote an earlier version is fixed when the commit is created: new successors never add
   * predecessors to it. Keyed by repository identity and commit id, so a replaced repository never answers.
   */
  const evolvedFlags = new Map<string, boolean>()
  const rememberEvolved = (key: string, evolved: boolean) => {
    evolvedFlags.delete(key)
    evolvedFlags.set(key, evolved)
    if (evolvedFlags.size > EVOLVED_CACHE_LIMIT) evolvedFlags.delete(evolvedFlags.keys().next().value ?? '')
  }
  const pushScans = new Map<string, PushScan>()
  const detailCache = makeRevisionDetailCache()

  const revisionsByIds = Effect.fnUntraced(function* (repo: RegisteredRepo, commitIds: readonly string[]) {
    const result = yield* repositories.run(repo)([
      ignoreWorkingCopy,
      'log',
      '--no-graph',
      '--revisions',
      GraphPage.commitIdsRevset(commitIds),
      '--template',
      REVISION_TEMPLATE,
    ])
    if (result.truncated) return yield* new OutputLimitExceeded({ subject: 'revision-lookup' })
    return yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(result.stdout, revisionSchema))
  })

  /**
   * Which of these revisions rewrote an earlier version; a failed or partial evolution read marks none and says so.
   * Flags already read for a commit are reused, so an unchanged page costs no jj process.
   */
  const evolvedCommitIds = (repo: RegisteredRepo, revisions: readonly Revision[]) =>
    Effect.gen(function* () {
      const keyOf = (commitId: string) => repo.identity + '\0' + repo.root + '\0' + commitId
      const commitIds = new Set<string>()
      const unknown: string[] = []
      for (const revision of revisions) {
        const known = evolvedFlags.get(keyOf(revision.commitId))
        if (known === undefined) unknown.push(revision.commitId)
        else if (known) commitIds.add(revision.commitId)
      }
      if (unknown.length === 0) return { commitIds, truncated: false }
      const result = yield* repositories.run(repo)(
        [ignoreWorkingCopy, 'evolog', '--no-graph', '--revisions', unknown.join('|'), '--limit', String(EVOLUTION_LIMIT), '--template', EVOLUTION_TEMPLATE],
        { outputLimit: 512_000 },
      )
      const rows = yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(result), evolutionRowSchema))
      const truncated = result.truncated || rows.length >= EVOLUTION_LIMIT
      const rowsById = new Map(rows.map(row => [row.commitId, row]))
      for (const commitId of unknown) {
        const row = rowsById.get(commitId)
        if (row === undefined) continue
        if (row.predecessors.length > 0) commitIds.add(commitId)
        // A commit's own entry is complete even when the log was cut later; only commits it reached are remembered.
        rememberEvolved(keyOf(commitId), row.predecessors.length > 0)
      }
      return { commitIds, truncated }
    }).pipe(Effect.orElseSucceed(() => ({ commitIds: new Set<string>(), truncated: true })))

  const readRevisions = Effect.fnUntraced(function* (repo: RegisteredRepo, limit: number) {
    const result = yield* repositories.run(repo)([
      ignoreWorkingCopy,
      'log',
      '--no-graph',
      '--limit',
      String(limit + 1),
      '--revisions',
      'all()',
      '--template',
      REVISION_TEMPLATE,
    ])
    if (result.truncated) return yield* new OutputLimitExceeded({ subject: 'revision-graph' })
    const revisions = yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(result.stdout, revisionSchema))
    return { revisions: revisions.slice(0, limit), hasMore: revisions.length > limit }
  })

  const readRemotes = (repo: RegisteredRepo) =>
    repositories
      .run(repo)([ignoreWorkingCopy, 'git', 'remote', 'list'], { outputLimit: 32_000 })
      .pipe(
        Effect.map(result => {
          if (result.truncated) return { names: [], configFingerprint: 'truncated' }
          const names = result.stdout.split(/\r?\n/).flatMap(line => {
            const name = line.trim().split(/\s+/, 1)[0]
            return name !== undefined && remoteNamePattern.test(name) ? [name] : []
          })
          // Keep remote URLs out of API responses while binding previews to their exact configuration.
          return { names: [...new Set(names)].slice(0, 64), configFingerprint: createHash('sha256').update(result.stdout).digest('hex') }
        }),
        Effect.orElseSucceed(() => ({ names: [], configFingerprint: 'unavailable' })),
      )

  const operationLog = (repo: RegisteredRepo, limit: number) =>
    Effect.gen(function* () {
      // `--ignore-working-copy op log` first makes it a view read, answered again at the same operation head.
      const result = yield* repositories.run(repo)(
        [ignoreWorkingCopy, 'op', 'log', '--at-operation=@', '--no-graph', '--limit', String(limit), '--template', OPERATION_ID_TEMPLATE],
        { outputLimit: 512_000 },
      )
      const operations = yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(result), operationRowSchema))
      return { operations, truncated: result.truncated || operations.length >= limit }
    })

  const pushIn = (operations: readonly (typeof operationRowSchema.Type)[], historyTruncated: boolean): LastPush => {
    const push = operations.find(row => JujutsuOutputModel.isRecordedJjGitPush(row.attributes))
    return { at: push?.time ?? null, description: push === undefined ? null : 'Recorded JJ git push command invocation', historyTruncated }
  }

  /**
   * The newest recorded `jj git push`. Once a scan is known, a new head reads only its newest operations: when they
   * reach the previous head, the previous answer stands for everything older; otherwise the full scan runs again.
   */
  const readLastPush = (repo: RegisteredRepo) =>
    Effect.gen(function* () {
      const scanKey = repo.identity + '\0' + repo.root
      const previous = pushScans.get(scanKey)
      const remember = (headId: string | undefined, push: LastPush): LastPush => {
        if (headId !== undefined) pushScans.set(scanKey, { headId, push })
        if (pushScans.size > MAX_DISPLAY_LOADS) pushScans.delete(pushScans.keys().next().value ?? '')
        return push
      }
      if (previous !== undefined) {
        const recent = yield* operationLog(repo, OPERATION_INCREMENT)
        const headId = recent.operations[0]?.id
        const known = recent.operations.findIndex(row => row.id === previous.headId)
        if (known >= 0) {
          const newer = pushIn(recent.operations.slice(0, known), false)
          return remember(headId, newer.at !== null ? { ...newer, historyTruncated: previous.push.historyTruncated } : previous.push)
        }
        if (!recent.truncated) return remember(headId, pushIn(recent.operations, false))
      }
      const full = yield* operationLog(repo, OPERATION_LIMIT)
      return remember(full.operations[0]?.id, pushIn(full.operations, full.truncated))
    }).pipe(Effect.orElseSucceed((): LastPush => ({ at: null, description: null, historyTruncated: true })))

  const snapshot = Effect.fn('jujutsu repository snapshot')(function* (repo: RegisteredRepo, limit: number) {
    // `status` is the only working-copy snapshot; every later read ignores the working copy so it sees that same `@`.
    const status = yield* repositories.run(repo)(['status'], { outputLimit: 78_000 })
    const [revisionPage, changedPaths, remotes, lastPush] = yield* Effect.all(
      [readRevisions(repo, limit), RevisionReads.paths(repositories.run(repo), '@'), readRemotes(repo), readLastPush(repo)],
      { concurrency: 'unbounded' },
    )
    const evolution = yield* evolvedCommitIds(repo, revisionPage.revisions)
    const graphRevisions = withEvolved(revisionPage.revisions, evolution.commitIds)
    yield* identity.verify(repo)
    const state: JujutsuState = {
      root: repo.root,
      revisions: graphRevisions,
      graphHasMore: revisionPage.hasMore,
      status: status.truncated ? status.stdout + '\n[status output truncated]' : status.stdout,
      changedPaths,
      remoteNames: remotes.names,
      lastPushAt: lastPush.at,
      lastPushDescription: lastPush.description,
      lastPushHistoryTruncated: lastPush.historyTruncated,
      evolutionHistoryTruncated: evolution.truncated,
    }
    const current: Snapshot = { state, identity: repo.identity }
    return current
  })

  /**
   * The state of exactly what an action names, never the whole repository: each named revision's visibility,
   * mutability, working-copy role, parents, bookmarks and first line; the commits its bookmark points at; the remote
   * configuration; the workspace's folder. Reads ignore the working copy, so the caller snapshots `@` first.
   */
  const targetState = Effect.fn('jujutsu mutation target state')(function* (repo: RegisteredRepo, target: MutationTarget) {
    const run = repositories.run(repo)
    const lines = (result: { readonly stdout: string; readonly truncated: boolean }) =>
      result.truncated
        ? 'truncated'
        : result.stdout
            .split('\n')
            .filter(line => line.length > 0)
            .sort()
            .join('\n')
    const commitIds = [...new Set(target.commitIds)].sort()
    const [revisions, bookmark, remote, workspace] = yield* Effect.all(
      [
        commitIds.length === 0
          ? Effect.succeed('')
          : run([ignoreWorkingCopy, 'log', '--no-graph', '--revisions', GraphPage.commitIdsRevset(commitIds), '--template', TARGET_TEMPLATE], {
              outputLimit: 256_000,
            }).pipe(
              Effect.map(lines),
              Effect.catchTag('JujutsuCommandFailed', () => Effect.succeed('unavailable')),
            ),
        target.bookmark === undefined
          ? Effect.succeed('')
          : run([ignoreWorkingCopy, 'log', '--no-graph', '--revisions', `bookmarks(exact:"${target.bookmark}")`, '--template', 'commit_id ++ "\\n"'], {
              outputLimit: 64_000,
            }).pipe(
              Effect.map(lines),
              Effect.catchTag('JujutsuCommandFailed', () => Effect.succeed('unavailable')),
            ),
        target.remote === true ? readRemotes(repo).pipe(Effect.map(remotes => remotes.configFingerprint)) : Effect.succeed(''),
        target.workspace === undefined
          ? Effect.succeed('')
          : repositories.workspaces(repo).pipe(
              Effect.map(workspaces => JSON.stringify(workspaces.find(workspace => workspace.name === target.workspace) ?? null)),
              Effect.catchTag('JujutsuCommandFailed', () => Effect.succeed('unavailable')),
            ),
      ],
      { concurrency: 'unbounded' },
    )
    const state: TargetState = { revisions: digest(revisions), bookmark: digest(bookmark), remote: digest(remote), workspace: digest(workspace) }
    return state
  })

  /** `revisions` plus the evolution flags of the ones looked up by id, for revisions an action names off the first page. */
  const withRevisions = Effect.fnUntraced(function* (repo: RegisteredRepo, revisions: readonly Revision[], commitIds: readonly string[]) {
    if (commitIds.length === 0) return revisions
    const loaded = yield* revisionsByIds(repo, commitIds)
    const evolution = yield* evolvedCommitIds(repo, loaded)
    return [...revisions, ...withEvolved(loaded, evolution.commitIds)]
  })

  const graphPage = Effect.fn('jujutsu graph page')(function* (input: {
    readonly repoId: string
    readonly query: string
    readonly excludeCommitIds: readonly string[]
  }) {
    const repo = yield* repositories.resolve(input.repoId)
    const candidateCount = GRAPH_PAGE_SIZE + MAX_WORKSPACE_HEAD_CANDIDATES + 1
    const scanLimit = input.excludeCommitIds.length + candidateCount
    const listing = yield* repositories.run(repo)(
      [ignoreWorkingCopy, 'log', '--no-graph', '--limit', String(scanLimit), '--revisions', GraphPage.revset(input.query), '--template', 'commit_id ++ "\\n"'],
      { outputLimit: scanLimit * 64 + 1024 },
    )
    if (listing.truncated) return yield* new OutputLimitExceeded({ subject: 'revision-graph' })
    const candidates = GraphPage.nextCandidates({
      listedCommitIds: listing.stdout.split('\n').filter(line => line.length > 0),
      excludeCommitIds: input.excludeCommitIds,
      size: candidateCount,
      scanLimit,
    })
    if (candidates.commitIds.length === 0) return { revisions: [], hasMore: false }
    // Very long descriptions can overflow one jj read of every candidate; a short read still returns a page.
    const read = yield* revisionsByIds(repo, candidates.commitIds).pipe(
      Effect.catchTag('OutputLimitExceeded', () => revisionsByIds(repo, candidates.commitIds.slice(0, REVISION_PAGE_SIZE + MAX_WORKSPACE_HEAD_CANDIDATES + 1))),
      Effect.catchTag('OutputLimitExceeded', () => Effect.fail(new OutputLimitExceeded({ subject: 'revision-graph' }))),
    )
    const revisions = read.filter(revision => matchesRevisionSearch(revision, input.query))
    const page = GraphPage.withinByteBudget(revisions.slice(0, GRAPH_PAGE_SIZE), GRAPH_PAGE_BYTE_BUDGET)
    const evolution = yield* evolvedCommitIds(repo, page)
    return {
      revisions: withEvolved(page, evolution.commitIds),
      hasMore: page.length > 0 && (revisions.length > page.length || read.length < candidates.commitIds.length || candidates.listingTruncated),
    }
  })

  /**
   * Display loads of one repository and page size share one in-flight snapshot: panels, tools and polls that ask
   * together pay one `status` and one set of reads. Nothing is kept once it settles, and a caller that leaves does not
   * stop the others. Previews never use this path: `prepare` and `confirm` take their own fresh snapshot.
   */
  const displayLoads = yield* Cache.makeWith(
    (key: string) => {
      const [repoId = '', limit = ''] = key.split('\0')
      return Effect.flatMap(repositories.resolve(repoId), repo => snapshot(repo, Number(limit)))
    },
    { capacity: MAX_DISPLAY_LOADS, timeToLive: () => Duration.zero },
  )

  const load = Effect.fn('jujutsu repository load')(function* (input: { readonly repoId: string; readonly limit: number }) {
    return (yield* Cache.get(displayLoads, input.repoId + '\0' + String(input.limit))).state
  })

  const graphNavigation = Effect.fn('jujutsu graph navigation')(function* (repoId: string, bookmark?: string) {
    return yield* GraphNavigationReads.readGraphNavigation(repositories.run(yield* repositories.resolve(repoId)), bookmark)
  })

  const relationship = Effect.fn('jujutsu revision relationship')(function* (input: {
    readonly repoId: string
    readonly commitId: string
    readonly targetCommitId: string
  }) {
    const repo = yield* repositories.resolve(input.repoId)
    const run = repositories.run(repo)
    const [commitId = input.commitId, targetCommitId = input.targetCommitId] = yield* RevisionReads.resolveCommitIds(run, [
      input.commitId,
      input.targetCommitId,
    ])
    return yield* GraphNavigationReads.readRevisionRelationship({ run, commitId, targetCommitId })
  })

  const slice = Effect.fn('jujutsu graph slice')(function* (input: {
    readonly repoId: string
    readonly commitId: string
    readonly mode: 'history' | 'exclusive'
  }) {
    const repo = yield* repositories.resolve(input.repoId)
    const run = repositories.run(repo)
    return yield* GraphNavigationReads.readGraphSlice({ run, commitId: yield* RevisionReads.resolveCommitId(run, input.commitId), mode: input.mode })
  })

  const referenceGraph = Effect.fn('jujutsu reference graph')(function* (input: {
    readonly repoId: string
    readonly reference: string
    readonly bookmark?: string | undefined
  }) {
    const repo = yield* repositories.resolve(input.repoId)
    return yield* ReferenceGraphModel.read({ run: repositories.run(repo), reference: input.reference, bookmark: input.bookmark })
  })

  /**
   * Titles for every chat reference one render pass shows, in one Host request. Each repository path is tried in order
   * (the thread's project, then its working directory); a reference resolved in one path is not read again.
   */
  const referenceTitles = Effect.fn('jujutsu reference titles')(function* (input: {
    readonly paths: readonly string[]
    readonly references: readonly { readonly value: string; readonly kind: 'revision' | 'bookmark' }[]
  }) {
    const keyOf = (reference: { readonly value: string; readonly kind: string }): string => `${reference.kind}\u0000${reference.value}`
    const pending = new Map(input.references.map(reference => [keyOf(reference), reference]))
    const found = new Map<string, { readonly title: string; readonly root: string }>()
    for (const path of new Set(input.paths)) {
      if (pending.size === 0) break
      const repo = yield* repositories.register(path).pipe(Effect.option)
      if (repo._tag === 'None') continue
      const run = repositories.run(repo.value)
      const reads = yield* Effect.forEach(
        [...pending.values()],
        reference => ReferenceGraphModel.readTitle({ run, reference: reference.value }).pipe(Effect.map(title => ({ reference, title }))),
        { concurrency: 4 },
      )
      for (const { reference, title } of reads) {
        if (title === undefined) continue
        found.set(keyOf(reference), { title: title.description.length === 0 ? reference.value : title.description, root: repo.value.root })
        pending.delete(keyOf(reference))
      }
    }
    return {
      titles: input.references.map(reference => {
        const match = found.get(keyOf(reference))
        return { value: reference.value, kind: reference.kind, title: match?.title ?? null, root: match?.root ?? null }
      }),
    }
  })

  const details = Effect.fn('jujutsu revision details')(function* (input: { readonly repoId: string; readonly commitId: string }) {
    const repo = yield* repositories.resolve(input.repoId)
    // A replaced repository at the same path has another identity, so its commits never answer from this one's cache.
    return yield* RevisionReads.details(repositories.run(repo), input.commitId, { cache: detailCache, cacheKey: repo.identity + '\0' + repo.root })
  })

  const fileStats = Effect.fn('jujutsu revision files')(function* (input: { readonly repoId: string; readonly commitIds: readonly string[] }) {
    const run = repositories.run(yield* repositories.resolve(input.repoId))
    return yield* RevisionReads.fileStats(run, [...new Set(yield* RevisionReads.resolveCommitIds(run, input.commitIds))])
  })

  const editTimes = Effect.fn('jujutsu edit times')(function* (input: { readonly repoId: string; readonly commitIds: readonly string[] }) {
    const repo = yield* repositories.resolve(input.repoId)
    const run = repositories.run(repo)
    return yield* RevisionReads.editTimes(run, {
      repositoryRoot: repo.root,
      commitIds: yield* RevisionReads.resolveCommitIds(run, input.commitIds),
      cache: editTimeCache,
    })
  })

  const workingDiff = Effect.fn('jujutsu working diff')(function* (repoId: string) {
    const patch = yield* repositories.run(yield* repositories.resolve(repoId))(['diff', '--revisions', '@', '--git'])
    return { patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout, truncated: patch.truncated }
  })

  return {
    snapshot,
    targetState,
    withRevisions,
    paths: (repo: RegisteredRepo, revision: string) => RevisionReads.paths(repositories.run(repo), revision),
    load,
    graphPage,
    graphNavigation,
    relationship,
    slice,
    referenceGraph,
    referenceTitles,
    details,
    fileStats,
    editTimes,
    workingDiff,
  }
})

/** Every revision read of the panel against a registered repository; reads after `status` never snapshot `@`. */
export class RevisionReader extends Context.Service<RevisionReader>()('@dshfiles/jujutsu/RevisionReader', { make }) {
  static readonly layer = Layer.effect(RevisionReader, RevisionReader.make)
}
