import { createHash } from 'node:crypto'
import { Context, Effect, Layer, Schema } from 'effect'
import { GRAPH_PAGE_BYTE_BUDGET, GRAPH_PAGE_SIZE, REVISION_PAGE_SIZE, revisionSchema, type JujutsuState, type Revision } from './api.js'
import { JujutsuOutputModel } from './core.js'
import { OutputLimitExceeded } from './errors.js'
import { GraphNavigationReads } from './graph-navigation-reads.js'
import { GraphPage } from './graph-page.js'
import { matchesRevisionSearch } from './graph.js'
import { EVOLUTION_TEMPLATE, OPERATION_TEMPLATE, REVISION_TEMPLATE } from './jj-templates.js'
import { ReferenceGraphModel } from './reference-graph.js'
import { Repositories } from './repositories.js'
import { RepositoryIdentity, type RegisteredRepo } from './repository-identity.js'
import { makeEditTimeCache, RevisionReads } from './revision-reads.js'

const MAX_WORKSPACE_HEAD_CANDIDATES = 32
const EVOLUTION_LIMIT = 100
const OPERATION_LIMIT = 1000

const commitIdSchema = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/))

/** One `jj evolog` row from EVOLUTION_TEMPLATE. */
const evolutionRowSchema = Schema.Struct({ commitId: commitIdSchema, predecessors: Schema.Array(commitIdSchema) })

/** One `jj operation log` row from OPERATION_TEMPLATE. */
const operationRowSchema = Schema.Struct({ description: Schema.String, attributes: Schema.String, time: Schema.String })

const remoteNamePattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/

const ignoreWorkingCopy = RevisionReads.ignoreWorkingCopy

/** The panel's view of a repository plus what a prepared action is bound to: its identity and a state fingerprint. */
export interface Snapshot {
  readonly state: JujutsuState
  readonly identity: string
  readonly fingerprint: string
}

const withEvolved = (revisions: readonly Revision[], evolved: ReadonlySet<string>): Revision[] =>
  revisions.map(revision => ({ ...revision, evolved: evolved.has(revision.commitId) }))

const make = Effect.gen(function* () {
  const repositories = yield* Repositories
  const identity = yield* RepositoryIdentity
  const editTimeCache = makeEditTimeCache()

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

  /** Which of these revisions rewrote an earlier version; a failed or partial evolution read marks none and says so. */
  const evolvedCommitIds = (repo: RegisteredRepo, revisions: readonly Revision[]) =>
    Effect.gen(function* () {
      if (revisions.length === 0) return { commitIds: new Set<string>(), truncated: false }
      const result = yield* repositories.run(repo)(
        [
          ignoreWorkingCopy,
          'evolog',
          '--no-graph',
          '--revisions',
          revisions.map(revision => revision.commitId).join('|'),
          '--limit',
          String(EVOLUTION_LIMIT),
          '--template',
          EVOLUTION_TEMPLATE,
        ],
        { outputLimit: 512_000 },
      )
      const rows = yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(result), evolutionRowSchema))
      return {
        commitIds: new Set(rows.filter(row => row.predecessors.length > 0).map(row => row.commitId)),
        truncated: result.truncated || rows.length >= EVOLUTION_LIMIT,
      }
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

  const readLastPush = (repo: RegisteredRepo) =>
    Effect.gen(function* () {
      const result = yield* repositories.run(repo)(
        ['--at-operation=@', '--ignore-working-copy', 'operation', 'log', '--no-graph', '--limit', String(OPERATION_LIMIT), '--template', OPERATION_TEMPLATE],
        { outputLimit: 512_000 },
      )
      const operations = yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(JujutsuOutputModel.completeLines(result), operationRowSchema))
      const push = operations.find(row => JujutsuOutputModel.isRecordedJjGitPush(row.attributes))
      return {
        at: push?.time ?? null,
        description: push === undefined ? null : 'Recorded JJ git push command invocation',
        historyTruncated: result.truncated || operations.length >= OPERATION_LIMIT,
      }
    }).pipe(Effect.orElseSucceed(() => ({ at: null, description: null, historyTruncated: true })))

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
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ revisions: graphRevisions, changedPaths, status: state.status, remoteConfig: remotes.configFingerprint }))
      .digest('hex')
    const current: Snapshot = { state, identity: repo.identity, fingerprint }
    return current
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

  const load = Effect.fn('jujutsu repository load')(function* (input: { readonly repoId: string; readonly limit: number }) {
    return (yield* snapshot(yield* repositories.resolve(input.repoId), input.limit)).state
  })

  const graphNavigation = Effect.fn('jujutsu graph navigation')(function* (repoId: string) {
    return yield* GraphNavigationReads.readGraphNavigation(repositories.run(yield* repositories.resolve(repoId)))
  })

  const relationship = Effect.fn('jujutsu revision relationship')(function* (input: {
    readonly repoId: string
    readonly commitId: string
    readonly targetCommitId: string
  }) {
    const repo = yield* repositories.resolve(input.repoId)
    return yield* GraphNavigationReads.readRevisionRelationship({ run: repositories.run(repo), commitId: input.commitId, targetCommitId: input.targetCommitId })
  })

  const slice = Effect.fn('jujutsu graph slice')(function* (input: {
    readonly repoId: string
    readonly commitId: string
    readonly mode: 'history' | 'exclusive'
  }) {
    const repo = yield* repositories.resolve(input.repoId)
    return yield* GraphNavigationReads.readGraphSlice({ run: repositories.run(repo), commitId: input.commitId, mode: input.mode })
  })

  const referenceGraph = Effect.fn('jujutsu reference graph')(function* (input: { readonly repoId: string; readonly reference: string }) {
    const repo = yield* repositories.resolve(input.repoId)
    return yield* ReferenceGraphModel.read({ run: repositories.run(repo), reference: input.reference })
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
    return yield* RevisionReads.details(repositories.run(yield* repositories.resolve(input.repoId)), input.commitId)
  })

  const fileStats = Effect.fn('jujutsu revision files')(function* (input: { readonly repoId: string; readonly commitIds: readonly string[] }) {
    return yield* RevisionReads.fileStats(repositories.run(yield* repositories.resolve(input.repoId)), [...new Set(input.commitIds)])
  })

  const editTimes = Effect.fn('jujutsu edit times')(function* (input: { readonly repoId: string; readonly commitIds: readonly string[] }) {
    const repo = yield* repositories.resolve(input.repoId)
    return yield* RevisionReads.editTimes(repositories.run(repo), { repositoryRoot: repo.root, commitIds: input.commitIds, cache: editTimeCache })
  })

  const workingDiff = Effect.fn('jujutsu working diff')(function* (repoId: string) {
    const patch = yield* repositories.run(yield* repositories.resolve(repoId))(['diff', '--revisions', '@', '--git'])
    return { patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout, truncated: patch.truncated }
  })

  return {
    snapshot,
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
