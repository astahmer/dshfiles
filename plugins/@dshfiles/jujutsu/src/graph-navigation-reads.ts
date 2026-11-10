import { Effect, Schema } from 'effect'
import { revisionSchema, type GraphNavigation, type RevisionRelationship } from './api.js'
import { JujutsuOutputModel } from './core.js'
import { InvalidJjOutput, OutputLimitExceeded, RevisionNotFound } from './errors.js'
import type { JjRun } from './jujutsu-commands.js'
import { REVISION_TEMPLATE } from './jj-templates.js'

const commitIdSchema = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/))
const operationIdSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{128}$/))
const LIMIT = 500

const decodeCommitId = (value: string) => Schema.decodeUnknownEffect(commitIdSchema)(value).pipe(Effect.mapError(cause => new InvalidJjOutput({ cause })))

/** Every read of one navigation answer runs at the same operation, so its parts agree with each other. */
const pinned = Effect.fnUntraced(function* (run: JjRun) {
  const result = yield* run(['--ignore-working-copy', 'op', 'log', '--limit', '1', '--no-graph', '--template', 'id'])
  if (result.truncated) return yield* new OutputLimitExceeded({ subject: 'operation' })
  const operationId = yield* Schema.decodeUnknownEffect(operationIdSchema)(result.stdout.trim()).pipe(Effect.mapError(cause => new InvalidJjOutput({ cause })))
  const read: JjRun = (args, options) => run(['--ignore-working-copy', '--at-operation', operationId, ...args], options)
  const revisions = Effect.fnUntraced(function* (revset: string) {
    const output = yield* read(['log', '--no-graph', '--limit', String(LIMIT + 1), '-r', revset, '-T', REVISION_TEMPLATE])
    if (output.truncated) return yield* new OutputLimitExceeded({ subject: 'revision-graph' })
    const rows = yield* Effect.fromResult(JujutsuOutputModel.parseJsonLines(output.stdout, revisionSchema))
    return { revisions: rows.slice(0, LIMIT), truncated: rows.length > LIMIT }
  })
  const ids = Effect.fnUntraced(function* (revset: string) {
    const output = yield* read(['log', '--no-graph', '--limit', String(LIMIT + 1), '-r', revset, '-T', 'commit_id ++ "\\n"'])
    if (output.truncated) return yield* new OutputLimitExceeded({ subject: 'revision-ids' })
    const values = output.stdout.trim() === '' ? [] : yield* Effect.forEach(output.stdout.trim().split('\n'), decodeCommitId)
    return { ids: values.slice(0, LIMIT), truncated: values.length > LIMIT }
  })
  const count = Effect.fnUntraced(function* (revset: string) {
    const output = yield* read(['log', '--no-graph', '-r', revset, '-T', '"x"'], { outputLimit: 1_000_000 })
    if (output.truncated || !/^x*$/.test(output.stdout)) return yield* new OutputLimitExceeded({ subject: 'revision-count' })
    return output.stdout.length
  })
  return { operationId, revisions, ids, count }
})

/** The `main` landmarks name the project's main branch (`main` unless jj-integration says otherwise). */
const landmarkDefinitions = (bookmark: string) =>
  [
    { kind: 'current', label: 'Current', revset: '@' },
    { kind: 'main-origin', label: `${bookmark}@origin`, revset: `remote_bookmarks(exact:${JSON.stringify(bookmark)}, exact:"origin")` },
    { kind: 'main', label: bookmark, revset: `bookmarks(exact:${JSON.stringify(bookmark)})` },
    { kind: 'default', label: 'Default', revset: 'present(default@)' },
  ] satisfies { kind: GraphNavigation['landmarks'][number]['kind']; label: string; revset: string }[]

const readGraphNavigation = Effect.fnUntraced(function* (run: JjRun, bookmark = 'main') {
  const snapshot = yield* pinned(run)
  const definitions = landmarkDefinitions(bookmark)
  const landmarks = yield* Effect.forEach(
    definitions,
    definition =>
      Effect.gen(function* () {
        const result = yield* snapshot.revisions(definition.revset)
        if (result.truncated) return yield* new OutputLimitExceeded({ subject: 'bookmarks' })
        const landmark: GraphNavigation['landmarks'][number] = {
          kind: definition.kind,
          label: definition.label,
          status: result.revisions.length === 0 ? 'missing' : result.revisions.length === 1 ? 'resolved' : 'ambiguous',
          revisions: result.revisions,
        }
        return landmark
      }),
    // Each landmark is one jj process over its own revset and none depends on another's output.
    { concurrency: definitions.length },
  )
  const navigation: GraphNavigation = { operationId: snapshot.operationId, landmarks }
  return navigation
})

const relationshipFromCounts = (input: {
  readonly selected: string
  readonly target: string
  readonly selectedOnlyCount: number
  readonly targetOnlyCount: number
  readonly hasCommonAncestor: boolean
}): RevisionRelationship['relation'] => {
  if (input.selected === input.target) return 'same'
  if (input.selectedOnlyCount === 0) return 'ancestor'
  if (input.targetOnlyCount === 0) return 'descendant'
  if (!input.hasCommonAncestor) return 'no-common-ancestor'
  return 'diverged'
}

const readRevisionRelationship = Effect.fnUntraced(function* (input: { readonly run: JjRun; readonly commitId: string; readonly targetCommitId: string }) {
  const selected = yield* decodeCommitId(input.commitId)
  const target = yield* decodeCommitId(input.targetCommitId)
  const snapshot = yield* pinned(input.run)
  const endpoints = yield* snapshot.ids(`${selected} | ${target}`)
  if (!endpoints.ids.includes(selected) || !endpoints.ids.includes(target)) {
    return yield* new RevisionNotFound({ reason: 'not-at-operation', reference: selected, candidates: [] })
  }
  const common = `heads(::${selected} & ::${target})`
  const connection = `(${common}):: & (::${selected} | ::${target})`
  const difference = `::${selected} ~ ::${target}`
  // Every read below names its own revset and none consumes another's output; four at a time keeps the spawn peak
  // bounded while the caller waits for the slowest read instead of their sum.
  const [selectedOnlyCount, targetOnlyCount, ancestors, connectionIds, differenceIds, rows, endpointRows] = yield* Effect.all(
    [
      snapshot.count(`::${selected} ~ ::${target}`),
      snapshot.count(`::${target} ~ ::${selected}`),
      snapshot.ids(common),
      snapshot.ids(connection),
      snapshot.ids(difference),
      snapshot.revisions(`${selected} | ${target} | (${connection}) | (${difference})`),
      snapshot.revisions(`${selected} | ${target}`),
    ],
    { concurrency: 4 },
  )
  const endpointIds = new Set(endpointRows.revisions.map(revision => revision.commitId))
  const combined = [...endpointRows.revisions, ...rows.revisions.filter(revision => !endpointIds.has(revision.commitId))]
  const relationship: RevisionRelationship = {
    operationId: snapshot.operationId,
    commitId: selected,
    targetCommitId: target,
    relation: relationshipFromCounts({ selected, target, selectedOnlyCount, targetOnlyCount, hasCommonAncestor: ancestors.ids.length > 0 }),
    selectedOnlyCount,
    targetOnlyCount,
    commonAncestorIds: ancestors.ids,
    commonAncestorsTruncated: ancestors.truncated,
    connectionIds: connectionIds.ids,
    differenceIds: differenceIds.ids,
    revisions: combined.slice(0, LIMIT),
    truncated: ancestors.truncated || connectionIds.truncated || differenceIds.truncated || rows.truncated || combined.length > LIMIT,
  }
  return relationship
})

const readGraphSlice = Effect.fnUntraced(function* (input: { readonly run: JjRun; readonly commitId: string; readonly mode: 'history' | 'exclusive' }) {
  const selected = yield* decodeCommitId(input.commitId)
  const snapshot = yield* pinned(input.run)
  const roots = `(heads(all()) | bookmarks() | remote_bookmarks() | working_copies()) ~ ${selected}`
  const result = yield* snapshot.revisions(input.mode === 'history' ? `::${selected}` : `::${selected} ~ ::(${roots})`)
  return { operationId: snapshot.operationId, ...result }
})

export class GraphNavigationReads {
  static readonly readGraphNavigation = readGraphNavigation
  static readonly readRevisionRelationship = readRevisionRelationship
  static readonly readGraphSlice = readGraphSlice
}
