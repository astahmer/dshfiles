import { Effect, Schema } from 'effect'
import { revisionSchema, type Revision } from './api.js'
import { JujutsuOutputModel } from './core.js'
import { InvalidJjOutput, OutputLimitExceeded, RevisionNotFound } from './errors.js'
import type { JjRun } from './jujutsu-commands.js'
import { REVISION_TEMPLATE } from './jj-templates.js'

const commitIdSchema = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/))
const ROW_LIMIT = 20
const NEIGHBOURHOOD = 4
/** Revisions between the listed rows: enough to join two listed rows across an elided stretch, never a whole history. */
const CONNECTION_LIMIT = 400

export interface ReferenceGraph {
  /** The reference exactly as the reader saw it in chat. */
  readonly label: string
  readonly commitId: string | null
  readonly changeId: string | null
  /** First-line description used as the chat link label; empty for undescribed revisions. */
  readonly description: string
  readonly graph: string
  /** The listed rows, newest first, as the panel's graph lays them out. */
  readonly listedCommitIds: string[]
  /** The listed rows plus the elided revisions joining them, so a link through hidden history stays one lane. */
  readonly revisions: Revision[]
  readonly defaultCommitId: string | null
}

/**
 * `jj:` tokens reach the Host as text a reader wrote, so a reference is only ever a symbol: the quoting keeps a
 * bookmark name with `.` or `+` in it a name rather than revset syntax, and the schema refuses anything else.
 */
const referenceSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/^(?:[A-Za-z0-9][A-Za-z0-9._/+:-]*|[k-z]{8,64}|[0-9a-f]{7,64})$/u),
)

/** The reference itself, its neighbourhood, and the landmarks a reader compares against. */
const revset = (input: { readonly reference: string; readonly hasDefaultWorkspace: boolean }): string =>
  [
    `(${input.reference})`,
    `ancestors(${input.reference}, ${String(NEIGHBOURHOOD)})`,
    `descendants(${input.reference}, ${String(NEIGHBOURHOOD)})`,
    '@',
    'present(main)',
    'present(main@origin)',
    ...(input.hasDefaultWorkspace ? ['default@'] : []),
  ].join(' | ')

/**
 * One row per revision: the referenced revision is marked `>`, the working copy `@`, every bookmark is named, and the
 * default workspace's revision carries `default@` the way the thread-workspace preview names it.
 */
const template = (input: { readonly commitId: string; readonly defaultCommitId: string | undefined }): string =>
  [
    'change_id.short(8)',
    '" "',
    `if(commit_id.short(64) == ${JSON.stringify(input.commitId)}, ">", " ")`,
    `if(current_working_copy, "@", " ")`,
    'local_bookmarks.map(|bookmark| bookmark.name()).join(",")',
    '" "',
    'remote_bookmarks.map(|bookmark| bookmark.name() ++ "@" ++ bookmark.remote()).join(",")',
    '" "',
    input.defaultCommitId === undefined ? '""' : `if(commit_id.short(64) == ${JSON.stringify(input.defaultCommitId)}, "default@", "")`,
    '" "',
    'description.first_line().substr(0, 60)',
    '"\\n"',
  ].join(' ++ ')

const rows = (output: string): readonly string[] =>
  output
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)

const isCommitId = Schema.is(commitIdSchema)

const readReferenceGraph = Effect.fnUntraced(function* (input: { readonly run: JjRun; readonly reference: string }) {
  const reference = JSON.stringify(
    yield* Schema.decodeUnknownEffect(referenceSchema)(input.reference).pipe(Effect.mapError(cause => new InvalidJjOutput({ cause }))),
  )
  const read = Effect.fnUntraced(function* (args: readonly string[]) {
    const result = yield* input.run(['--ignore-working-copy', '--no-pager', '--color=never', ...args])
    if (result.truncated) return yield* new OutputLimitExceeded({ subject: 'reference-graph' })
    return result.stdout
  })
  const resolved = (yield* read([
    'log',
    '--no-graph',
    '--limit',
    '1',
    '-r',
    reference,
    '-T',
    'separate("\\n", commit_id, change_id.short(), description.first_line().substr(0, 255))',
  ]))
    .trimEnd()
    .split('\n')
  const commitId = resolved.at(0)
  const changeId = resolved.at(1)
  const description = resolved.slice(2).join('\n')
  if (commitId === undefined || changeId === undefined || !isCommitId(commitId)) {
    return yield* new RevisionNotFound({ reason: 'reference', reference: input.reference, candidates: [] })
  }
  const hasDefaultWorkspace = rows(yield* read(['workspace', 'list', '-T', 'name ++ "\\n"'])).includes('default')
  const defaultCommitId = hasDefaultWorkspace ? rows(yield* read(['log', '--no-graph', '--limit', '1', '-r', 'default@', '-T', 'commit_id'])).at(0) : undefined
  const graph = yield* read([
    'log',
    '--limit',
    String(ROW_LIMIT),
    '-r',
    revset({ reference, hasDefaultWorkspace }),
    '-T',
    template({ commitId, defaultCommitId }),
  ])
  const listedCommitIds = rows(
    yield* read(['log', '--no-graph', '--limit', String(ROW_LIMIT), '-r', revset({ reference, hasDefaultWorkspace }), '-T', 'commit_id ++ "\\n"']),
  ).filter(isCommitId)
  const revisions =
    listedCommitIds.length === 0
      ? []
      : (yield* Effect.fromResult(
          JujutsuOutputModel.parseJsonLines(
            yield* read(['log', '--no-graph', '--limit', String(CONNECTION_LIMIT), '-r', `connected(${listedCommitIds.join(' | ')})`, '-T', REVISION_TEMPLATE]),
            revisionSchema,
          ),
        )).map(revision => ({ ...revision, description: revision.description.split('\n')[0] ?? '' }))
  const graphAround: ReferenceGraph = {
    label: input.reference,
    commitId,
    changeId,
    description,
    graph: graph.trimEnd(),
    listedCommitIds,
    revisions,
    defaultCommitId: defaultCommitId ?? null,
  }
  return graphAround
})

export class ReferenceGraphModel {
  static readonly revset = revset
  static readonly template = template
  static readonly read = readReferenceGraph
}
