import { createHash } from 'node:crypto'

import { Clock, Context, Effect, Layer, Ref, Schema, SchemaGetter } from 'effect'

import { MemoryStoreFailed, ProjectRekeyAmbiguous, type MemoryInactive } from './errors.ts'
import { MemoryDb } from './memory-db.ts'

export type ThreadDigest = {
  readonly id: string
  readonly project: string
  readonly parent: string | null
  readonly title: string
  /** One sentence for the start block. */
  readonly decision: string
  readonly digest: string
  /** `trail`: built from the thread's own record; `model`: a cheap model wrote it. */
  readonly source: 'trail' | 'model'
  readonly lastSeq: number
  readonly updatedAt: number
}

export type StoredThread = ThreadDigest & {
  readonly digestedAt: number
  readonly duplicateOf: string | null
  readonly uses: number
  readonly lastUsedAt: number | null
}

/** Claude Code's memory types: who the user is, feedback on the agent's work, project context, external pointers. */
export type NoteCategory = 'user' | 'feedback' | 'project' | 'reference'

export type NoteOrigin = 'user-requested' | 'agent' | 'panel'

export type NoteInput = {
  readonly project: string
  readonly text: string
  readonly category: NoteCategory
  /** `repo` (this project), `global` (every project) or `path:<subpath>`. */
  readonly scope: string
  readonly confidence: 'stated' | 'inferred'
  readonly sourceThread: string | null
  /** The user message (event seq) in `sourceThread` the note came from, when known. */
  readonly sourceSeq: number | null
  /** `user-requested`: the user asked to remember it; `agent`: the agent chose to note it; `panel`: written in the Memory panel. */
  readonly origin: NoteOrigin
}

export type Note = NoteInput & {
  readonly id: number
  /** When this text was written; `firstCreatedAt` is when the first version of the note was. */
  readonly createdAt: number
  readonly firstCreatedAt: number
  readonly supersedes: number | null
  readonly uses: number
}

/** A note row as the panel shows it, including superseded and forgotten history. */
export type NoteRecord = Note & {
  readonly valid: boolean
  readonly supersededBy: number | null
  readonly forgottenAt: number | null
  readonly archivedAt: number | null
  readonly reason: string | null
}

export type DailyUsage = {
  day: string
  searches: number
  searchFound: number
  searchEmpty: number
  reads: number
  readFound: number
  readMissing: number
  notes: number
  /** Tool calls whose results a reply cited. */
  cited: number
  citations: number
  agentCorrected: number
  userCorrected: number
  /** Thread digests written that day, duplicates included. */
  digests: number
  /** Model requests that carried a non-empty start block. */
  blockRequests: number
}

/** Stored notes by lifecycle state, for the notes header and analytics. */
export type NoteStatusCounts = { readonly active: number; readonly superseded: number; readonly forgotten: number; readonly archived: number }

export type IndexedMessage = { readonly seq: number; readonly role: 'user' | 'assistant'; readonly text: string; readonly at: number }

export type SearchHit =
  | { readonly kind: 'thread'; readonly id: string; readonly project: string; readonly score: number; readonly updatedAt: number }
  | { readonly kind: 'note'; readonly id: number; readonly project: string; readonly score: number; readonly updatedAt: number }
  | {
      readonly kind: 'message'
      readonly thread: string
      readonly seq: number
      readonly role: string
      readonly project: string
      readonly score: number
      readonly updatedAt: number
      /** The message's first `excerptChars` characters; null for rows indexed before excerpts were kept. */
      readonly excerpt: string | null
    }

export type Ranker = 'bm25' | 'vector' | 'hybrid'

export type SearchRequest = {
  readonly query: string
  /** Projects to search; empty means every project. */
  readonly projects: readonly string[]
  /** The caller's project, which ranks highest; defaults to the first of `projects`. */
  readonly ownProject?: string | undefined
  readonly limit: number
  readonly ranker?: Ranker | undefined
  /** With `vector` or `hybrid`: the query embedded by the same model as the stored vectors. */
  readonly queryVector?: Float32Array | undefined
  readonly embeddingModel?: string | undefined
}

export type UsageCounts = {
  readonly tools: readonly { readonly tool: string; readonly calls: number; readonly withResults: number; readonly empty: number; readonly used: number }[]
  readonly counters: Readonly<Record<string, number>>
  readonly threads: number
  readonly notes: number
  readonly indexedMessages: number
}

export type CostRow = {
  readonly day: string
  readonly kind: 'digest' | 'jev'
  readonly provider: string
  readonly model: string
  readonly calls: number
  readonly input: number
  readonly cacheRead: number
  readonly output: number
}

export type CitationRecord = {
  readonly id: number
  readonly at: number
  readonly thread: string
  readonly threadTitle: string | null
  readonly ref: string
  readonly target: string | null
  readonly project: string | null
  readonly rating: 'up' | 'down' | null
  readonly agentCorrected: boolean
  readonly userCorrected: boolean
}

export type Effectiveness = {
  readonly block: { readonly threads: number; readonly meanBytes: number; readonly maxBytes: number; readonly requests: number }
  readonly citations: { readonly total: number; readonly agentCorrected: number; readonly userCorrected: number; readonly up: number; readonly down: number }
}

export type RowsMoved = { notes: number; threads: number; messages: number; embeddings: number; docsWords: number; docsIds: number }

export type RekeyResult = {
  readonly projects: number
  readonly moved: RowsMoved
  readonly conflicts: readonly { readonly kind: 'note' | 'thread'; readonly target: string; readonly collisions: number }[]
}

export type MissingEmbedding = { readonly kind: 'thread' | 'note'; readonly ref: string; readonly project: string; readonly text: string }

export type NoteFilter = {
  readonly project?: string | undefined
  readonly scope?: string | undefined
  readonly category?: NoteCategory | undefined
  readonly query?: string | undefined
  readonly thread?: string | undefined
  readonly includeInvalid?: boolean | undefined
  readonly includeArchived?: boolean | undefined
  readonly beforeId?: number | undefined
  readonly limit: number
}

export type NoteUpdate = {
  readonly id: number
  readonly text: string
  readonly reason: string
  readonly sourceThread: string | null
  readonly sourceSeq: number | null
  readonly origin: NoteOrigin
  readonly category?: NoteCategory | undefined
  readonly scope?: string | undefined
  readonly confidence?: 'stated' | 'inferred' | undefined
}

type StoreError = MemoryInactive | MemoryStoreFailed

const stopWords = new Set(
  'a an and are as at be by can could did do does for from had has have how i if in into is it its me my no not of on or our should so that the their them then there these they this to us was we were what when where which who why will with would you your'.split(
    ' ',
  ),
)

const dayMs = 86_400_000
const digestHalfLifeDays = 60
const noteHalfLifeDays = 240
const categoryBoost = { feedback: 1.3, project: 1.2, user: 1.15, reference: 1 } satisfies Record<NoteCategory, number>
const noteCategories: readonly NoteCategory[] = ['user', 'feedback', 'project', 'reference']
const citationRatings: readonly ('up' | 'down')[] = ['up', 'down']

/** Characters of a message kept with its index row, enough for a search snippet without reading the Session log. */
const excerptChars = 2_000

const toCategory = (value: string | null | undefined): NoteCategory => noteCategories.find(category => category === value) ?? 'project'

const hashOf = (text: string): string => createHash('sha256').update(text.trim().replace(/\s+/g, ' ').toLowerCase()).digest('hex').slice(0, 32)

const cosine = (left: Float32Array, right: Float32Array): number => {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm)
}

const queryTerms = (query: string): readonly string[] => [
  ...new Set((query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._:/-]*[\p{L}\p{N}]|[\p{L}\p{N}]{2,}/gu) ?? []).filter(term => !stopWords.has(term))),
]

/** Words as an FTS5 OR expression for the porter table: BM25 ranks rows matching more of them first. */
const wordQuery = (terms: readonly string[]): string | undefined => {
  const words = terms.flatMap(term => term.split(/[._:/-]+/)).filter(word => word.length > 1 && !stopWords.has(word))
  if (words.length === 0) return undefined
  return [...new Set(words)]
    .slice(0, 24)
    .map(word => `"${word}"`)
    .join(' OR ')
}

/** Identifier-looking terms (digits or separators, or long words) as substrings for the trigram table. */
const identifierQuery = (terms: readonly string[]): string | undefined => {
  const identifiers = terms.filter(term => term.length >= 3 && (/[\d._:/-]/.test(term) || term.length >= 8))
  if (identifiers.length === 0) return undefined
  return identifiers
    .slice(0, 12)
    .map(term => `"${term.replaceAll('"', '')}"`)
    .join(' OR ')
}

const ThreadRow = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  parent: Schema.NullOr(Schema.String),
  title: Schema.String,
  decision: Schema.String,
  digest: Schema.String,
  source: Schema.String,
  last_seq: Schema.Number,
  updated_at: Schema.Number,
  digested_at: Schema.Number,
  duplicate_of: Schema.NullOr(Schema.String),
  uses: Schema.Number,
  last_used_at: Schema.NullOr(Schema.Number),
})

const NoteRow = Schema.Struct({
  id: Schema.Number,
  project: Schema.String,
  scope: Schema.String,
  category: Schema.String,
  confidence: Schema.String,
  text: Schema.String,
  hash: Schema.String,
  source_thread: Schema.NullOr(Schema.String),
  source_seq: Schema.NullOr(Schema.Number),
  origin: Schema.String,
  first_created_at: Schema.Number,
  created_at: Schema.Number,
  valid: Schema.Number,
  supersedes: Schema.NullOr(Schema.Number),
  superseded_by: Schema.NullOr(Schema.Number),
  forgotten_at: Schema.NullOr(Schema.Number),
  reason: Schema.NullOr(Schema.String),
  uses: Schema.Number,
  archived_at: Schema.NullOr(Schema.Number),
})

const Nullable = <S extends Schema.Top>(schema: S) => Schema.optionalKey(Schema.NullOr(schema))

const decodeThreads = Schema.decodeUnknownEffect(Schema.Array(ThreadRow))
const decodeNotes = Schema.decodeUnknownEffect(Schema.Array(NoteRow))
const decodeIds = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.Number })))
const decodeTextIds = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.String })))
const decodeHashes = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ digest_hash: Schema.String })))
const decodeThroughSeq = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ through_seq: Schema.Number })))
const decodeRowids = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ rowid: Schema.Number })))
const decodeTexts = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ text: Schema.String })))
const decodeProjects = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ project: Schema.String })))
const decodeCount = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ n: Schema.NullOr(Schema.Number) })))
const decodeCategories = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.Number, category: Schema.String })))
const decodeOldThreads = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.String, project: Schema.String })))
const decodeMissing = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ ref: Schema.Union([Schema.String, Schema.Number]), project: Schema.String, text: Schema.String })),
)
const decodeDocHits = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ kind: Schema.String, ref: Schema.String, project: Schema.String, updated_at: Schema.Number })),
)
const decodeMessageHits = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      thread: Schema.String,
      seq: Schema.Number,
      role: Schema.String,
      project: Schema.String,
      at: Schema.Number,
      excerpt: Schema.NullOr(Schema.String),
    }),
  ),
)
const decodeVectorHits = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      ref: Schema.String,
      project: Schema.String,
      vector: Schema.Uint8Array,
      updated_at: Schema.Number,
      thread: Schema.NullOr(Schema.String),
      seq: Schema.NullOr(Schema.Number),
      role: Schema.NullOr(Schema.String),
      excerpt: Schema.NullOr(Schema.String),
    }),
  ),
)
const decodeCosts = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      day: Schema.String,
      kind: Schema.String,
      provider: Schema.String,
      model: Schema.String,
      calls: Schema.Number,
      input: Schema.Number,
      cache_read: Schema.Number,
      output: Schema.Number,
    }),
  ),
)
const decodeCitations = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      at: Schema.Number,
      thread: Schema.String,
      ref: Schema.String,
      rating: Schema.NullOr(Schema.String),
      agent_corrected: Schema.Number,
      user_corrected: Schema.Number,
      target: Schema.NullOr(Schema.String),
      project: Schema.NullOr(Schema.String),
      thread_title: Schema.NullOr(Schema.String),
    }),
  ),
)
const decodeBlockStats = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ n: Schema.Number, mean: Schema.NullOr(Schema.Number), max: Schema.NullOr(Schema.Number) })),
)
const decodeCitationStats = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      n: Schema.Number,
      agent: Schema.NullOr(Schema.Number),
      user: Schema.NullOr(Schema.Number),
      up: Schema.NullOr(Schema.Number),
      down: Schema.NullOr(Schema.Number),
    }),
  ),
)
const decodeToolCalls = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.Number, tokens: Schema.String })))
const decodeCollisions = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ collisions: Schema.Number })))
const decodeProjectTotals = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ project: Schema.String, threads: Schema.Number, notes: Schema.Number })))
const decodeToolDays = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      day: Schema.String,
      tool: Schema.String,
      calls: Schema.Number,
      found: Nullable(Schema.Number),
      empty: Nullable(Schema.Number),
      used: Nullable(Schema.Number),
    }),
  ),
)
const decodeCitationDays = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ day: Schema.String, n: Schema.Number, agent: Nullable(Schema.Number), user: Nullable(Schema.Number) })),
)
const decodeDayCounts = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ day: Schema.String, n: Schema.Number })))
const decodeStatusCounts = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      active: Schema.NullOr(Schema.Number),
      archived: Schema.NullOr(Schema.Number),
      superseded: Schema.NullOr(Schema.Number),
      forgotten: Schema.NullOr(Schema.Number),
    }),
  ),
)
const decodeToolTotals = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ tool: Schema.String, calls: Schema.Number, with_results: Schema.NullOr(Schema.Number), used: Schema.NullOr(Schema.Number) })),
)
const decodeCounters = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.Number })))
const decodeChanges = Schema.decodeUnknownEffect(
  Schema.Struct({
    changes: Schema.Union([Schema.Number, Schema.BigInt]).pipe(
      Schema.decodeTo(Schema.Number, { decode: SchemaGetter.transform(Number), encode: SchemaGetter.transform(value => value) }),
    ),
  }),
)

const threadOf = (row: typeof ThreadRow.Type): StoredThread => ({
  id: row.id,
  project: row.project,
  parent: row.parent,
  title: row.title,
  decision: row.decision,
  digest: row.digest,
  source: row.source === 'model' ? 'model' : 'trail',
  lastSeq: row.last_seq,
  updatedAt: row.updated_at,
  digestedAt: row.digested_at,
  duplicateOf: row.duplicate_of,
  uses: row.uses,
  lastUsedAt: row.last_used_at,
})

const noteOf = (row: typeof NoteRow.Type): Note => ({
  id: row.id,
  project: row.project,
  scope: row.scope,
  category: toCategory(row.category),
  confidence: row.confidence === 'inferred' ? 'inferred' : 'stated',
  text: row.text,
  sourceThread: row.source_thread,
  sourceSeq: row.source_seq,
  origin: row.origin === 'user-requested' || row.origin === 'panel' ? row.origin : 'agent',
  firstCreatedAt: row.first_created_at || row.created_at,
  createdAt: row.created_at,
  supersedes: row.supersedes,
  uses: row.uses,
})

const noteRecordOf = (row: typeof NoteRow.Type): NoteRecord => ({
  ...noteOf(row),
  valid: row.valid === 1,
  supersededBy: row.superseded_by,
  forgottenAt: row.forgotten_at,
  archivedAt: row.archived_at,
  reason: row.reason,
})

const noRowsMoved = (): RowsMoved => ({ notes: 0, threads: 0, messages: 0, embeddings: 0, docsWords: 0, docsIds: 0 })

const emptyDay = (day: string): DailyUsage => ({
  day,
  searches: 0,
  searchFound: 0,
  searchEmpty: 0,
  reads: 0,
  readFound: 0,
  readMissing: 0,
  notes: 0,
  cited: 0,
  citations: 0,
  agentCorrected: 0,
  userCorrected: 0,
  digests: 0,
  blockRequests: 0,
})

/** Store failures keep their cause; own-file corruption and SQL errors reach the caller as one actionable error. */
const storeFailure = <A, R>(effect: Effect.Effect<A, StoreError | Schema.SchemaError | { readonly _tag: 'SqlError' }, R>) =>
  Effect.catchTags(effect, {
    SqlError: cause => Effect.fail(new MemoryStoreFailed({ cause })),
    SchemaError: cause => Effect.fail(new MemoryStoreFailed({ cause })),
  })

/**
 * The plugin's only persistent state: thread digests, notes, a contentless index of message text (the text itself
 * stays in DSH's session log and is read back on demand), frozen start blocks, optional embeddings and usage counters.
 */
export class MemoryRepo extends Context.Service<
  MemoryRepo,
  {
    readonly version: Effect.Effect<number>
    readonly putThread: (digest: ThreadDigest) => Effect.Effect<'new' | 'updated' | 'unchanged' | 'duplicate', StoreError>
    readonly thread: (id: string) => Effect.Effect<StoredThread | undefined, StoreError>
    readonly blockThreads: (input: {
      readonly projects?: readonly string[]
      readonly excludeProjects?: readonly string[]
      readonly limit: number
      readonly staleDays: number
    }) => Effect.Effect<readonly StoredThread[], StoreError>
    readonly addNote: (input: NoteInput) => Effect.Effect<{ readonly note: Note; readonly duplicate: boolean }, StoreError>
    readonly note: (id: number) => Effect.Effect<Note | undefined, StoreError>
    readonly updateNote: (input: NoteUpdate) => Effect.Effect<Note | undefined, StoreError>
    readonly forgetNote: (input: { readonly id: number; readonly reason: string }) => Effect.Effect<boolean, StoreError>
    readonly archiveNote: (id: number) => Effect.Effect<boolean, StoreError>
    readonly restoreNote: (id: number) => Effect.Effect<boolean, StoreError>
    readonly blockNotes: (input: {
      readonly project: string
      readonly limit: number
      readonly scopes?: readonly string[]
    }) => Effect.Effect<readonly Note[], StoreError>
    readonly indexMessages: (input: {
      readonly thread: string
      readonly project: string
      readonly messages: readonly IndexedMessage[]
      readonly throughSeq: number
    }) => Effect.Effect<number, StoreError>
    readonly backfillExcerpts: (input: {
      readonly thread: string
      readonly messages: readonly { readonly seq: number; readonly text: string }[]
    }) => Effect.Effect<void, StoreError>
    readonly indexedThrough: (thread: string) => Effect.Effect<number, StoreError>
    readonly putEmbedding: (input: {
      readonly kind: 'thread' | 'note' | 'message'
      readonly ref: string
      readonly project: string
      readonly model: string
      readonly vector: Float32Array
    }) => Effect.Effect<void, StoreError>
    readonly missingEmbeddings: (input: { readonly model: string; readonly limit: number }) => Effect.Effect<readonly MissingEmbedding[], StoreError>
    readonly search: (request: SearchRequest) => Effect.Effect<readonly SearchHit[], StoreError>
    readonly recordUse: (
      item: { readonly kind: 'thread'; readonly id: string } | { readonly kind: 'note'; readonly id: number },
      citingThread: string,
    ) => Effect.Effect<void, StoreError>
    readonly recordCost: (input: {
      readonly kind: 'digest' | 'jev'
      readonly provider: string
      readonly model: string
      readonly input: number
      readonly cacheRead: number
      readonly output: number
    }) => Effect.Effect<void, StoreError>
    readonly bump: (name: string, by?: number) => Effect.Effect<void, StoreError>
    readonly bumpDaily: (name: string, by?: number) => Effect.Effect<void, StoreError>
    readonly costsByDay: (days: number) => Effect.Effect<readonly CostRow[], StoreError>
    readonly flagCitations: (input: { readonly thread: string; readonly by: 'agent' | 'user'; readonly sinceMs: number }) => Effect.Effect<number, StoreError>
    readonly rateCitation: (input: { readonly id: number; readonly rating: 'up' | 'down' | null }) => Effect.Effect<boolean, StoreError>
    readonly recentCitations: (request: {
      readonly limit: number
      readonly thread?: string | undefined
      readonly ref?: string | undefined
    }) => Effect.Effect<readonly CitationRecord[], StoreError>
    readonly effectiveness: Effect.Effect<Effectiveness, StoreError>
    readonly frozenBlock: (threadId: string) => Effect.Effect<string | undefined, StoreError>
    readonly freezeBlock: (threadId: string, text: string) => Effect.Effect<string, StoreError>
    readonly recordToolCall: (input: {
      readonly thread: string
      readonly tool: string
      readonly results: number
      readonly ids: readonly string[]
    }) => Effect.Effect<void, StoreError>
    readonly markCited: (input: { readonly thread: string; readonly cited: readonly string[]; readonly sinceMs: number }) => Effect.Effect<number, StoreError>
    readonly listNotes: (filter: NoteFilter) => Effect.Effect<readonly NoteRecord[], StoreError>
    readonly noteHistory: (id: number) => Effect.Effect<readonly NoteRecord[], StoreError>
    readonly listThreads: (filter: { readonly project?: string | undefined; readonly limit: number }) => Effect.Effect<readonly StoredThread[], StoreError>
    readonly projectPaths: Effect.Effect<readonly string[], StoreError>
    readonly rekeyProjects: (input: {
      readonly mappings: readonly { readonly from: string; readonly to: string }[]
    }) => Effect.Effect<RekeyResult, StoreError | ProjectRekeyAmbiguous>
    readonly projects: Effect.Effect<readonly { readonly project: string; readonly threads: number; readonly notes: number }[], StoreError>
    readonly usageByDay: (days: number) => Effect.Effect<readonly DailyUsage[], StoreError>
    readonly noteStatusCounts: (project?: string | undefined) => Effect.Effect<NoteStatusCounts, StoreError>
    readonly topNotes: (limit: number) => Effect.Effect<readonly NoteRecord[], StoreError>
    readonly usage: Effect.Effect<UsageCounts, StoreError>
    readonly prune: (retentionDays: number) => Effect.Effect<{ readonly threads: number; readonly messages: number }, StoreError>
  }
>()('@dshfiles/memory/MemoryRepo') {
  static readonly layer = Layer.effect(
    MemoryRepo,
    Effect.gen(function* () {
      const db = yield* MemoryDb
      const version = yield* Ref.make(0)

      const rows = <A>(decode: (input: unknown) => Effect.Effect<A, Schema.SchemaError>, text: string, params: ReadonlyArray<unknown> = []) =>
        Effect.flatMap(db.sql, sql => Effect.flatMap(sql.unsafe(text, params), decode))
      const first = <A>(decode: (input: unknown) => Effect.Effect<readonly A[], Schema.SchemaError>, text: string, params: ReadonlyArray<unknown> = []) =>
        Effect.map(rows(decode, text, params), found => found[0])
      const exec = (text: string, params: ReadonlyArray<unknown> = []) => Effect.flatMap(db.sql, sql => Effect.asVoid(sql.unsafe(text, params)))
      /** Rows an update or delete touched, from the driver's change counter (FTS tables refuse `returning`). */
      const changes = (text: string, params: ReadonlyArray<unknown> = []) =>
        Effect.flatMap(db.sql, sql => Effect.flatMap(sql.unsafe(text, params).raw, decodeChanges)).pipe(Effect.map(result => result.changes))
      const transaction = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.flatMap(db.sql, sql => sql.withTransaction(effect))
      const changed = Ref.update(version, current => current + 1)

      const bump = Effect.fnUntraced(function* (name: string, by = 1) {
        yield* exec('insert into counters (name, value) values (?, ?) on conflict (name) do update set value = value + excluded.value', [name, by])
      }, storeFailure)

      const indexDoc = (kind: 'thread' | 'note', ref: string, project: string, text: string) =>
        Effect.andThen(
          exec('insert into docs_words (text, kind, ref, project) values (?, ?, ?, ?)', [text, kind, ref, project]),
          exec('insert into docs_ids (text, kind, ref, project) values (?, ?, ?, ?)', [text, kind, ref, project]),
        )

      const removeDoc = (kind: 'thread' | 'note', ref: string) =>
        Effect.all([
          exec('delete from docs_words where kind = ? and ref = ?', [kind, ref]),
          exec('delete from docs_ids where kind = ? and ref = ?', [kind, ref]),
          exec('delete from embeddings where kind = ? and ref = ?', [kind, ref]),
        ])

      const putThread = Effect.fn('memory repo put thread')(function* (digest: ThreadDigest) {
        const now = yield* Clock.currentTimeMillis
        return yield* transaction(
          Effect.gen(function* () {
            const hash = hashOf(digest.digest)
            const existing = yield* first(decodeHashes, 'select digest_hash from threads where id = ?', [digest.id])
            if (existing?.digest_hash === hash) return 'unchanged' as const
            const twin = yield* first(
              decodeTextIds,
              'select id from threads where project = ? and digest_hash = ? and id != ? and duplicate_of is null limit 1',
              [digest.project, hash, digest.id],
            )
            const duplicateOf = twin?.id ?? null
            yield* exec(
              `insert into threads (id, project, parent, title, decision, digest, digest_hash, source, last_seq, updated_at, digested_at, duplicate_of)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 on conflict (id) do update set project = excluded.project, parent = excluded.parent, title = excluded.title, decision = excluded.decision,
                   digest = excluded.digest, digest_hash = excluded.digest_hash, source = excluded.source, last_seq = excluded.last_seq,
                   updated_at = excluded.updated_at, digested_at = excluded.digested_at, duplicate_of = excluded.duplicate_of`,
              [
                digest.id,
                digest.project,
                digest.parent,
                digest.title,
                digest.decision,
                digest.digest,
                hash,
                digest.source,
                digest.lastSeq,
                digest.updatedAt,
                now,
                duplicateOf,
              ],
            )
            yield* removeDoc('thread', digest.id)
            if (duplicateOf === null) yield* indexDoc('thread', digest.id, digest.project, `${digest.title}\n${digest.digest}`)
            yield* bump(duplicateOf === null ? `digests.${digest.source}` : 'digests.duplicate')
            yield* changed
            if (duplicateOf !== null) return 'duplicate' as const
            return existing === undefined ? ('new' as const) : ('updated' as const)
          }),
        )
      }, storeFailure)

      const noteRow = (id: number) => first(decodeNotes, 'select * from notes where id = ? and valid = 1 and archived_at is null', [id])

      const note = Effect.fn('memory repo note')(function* (id: number) {
        const row = yield* noteRow(id)
        return row === undefined ? undefined : noteOf(row)
      }, storeFailure)

      const insertNote = (input: NoteInput, supersedes: Note | null) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis
          const firstCreatedAt = supersedes?.firstCreatedAt ?? at
          const inserted = yield* first(
            decodeIds,
            `insert into notes (project, scope, category, confidence, text, hash, source_thread, source_seq, origin, created_at, first_created_at, supersedes, uses)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`,
            [
              input.project,
              input.scope,
              input.category,
              input.confidence,
              input.text,
              hashOf(input.text),
              input.sourceThread,
              input.sourceSeq,
              input.origin,
              at,
              firstCreatedAt,
              supersedes?.id ?? null,
              supersedes?.uses ?? 0,
            ],
          )
          const id = inserted?.id ?? 0
          yield* indexDoc('note', String(id), input.project, `${input.category}: ${input.text}`)
          const created: Note = { ...input, id, createdAt: at, firstCreatedAt, supersedes: supersedes?.id ?? null, uses: supersedes?.uses ?? 0 }
          return created
        })

      const activeTwin = (project: string, text: string) =>
        first(decodeNotes, 'select * from notes where project = ? and hash = ? and valid = 1 and archived_at is null', [project, hashOf(text)])

      /** A note whose text already exists as a valid note of the project is not stored twice; the existing one is returned. */
      const addNote = Effect.fn('memory repo add note')(function* (input: NoteInput) {
        return yield* transaction(
          Effect.gen(function* () {
            const twin = yield* activeTwin(input.project, input.text)
            if (twin !== undefined) return { note: noteOf(twin), duplicate: true }
            const created = yield* insertNote(input, null)
            yield* bump('notes.added')
            yield* changed
            return { note: created, duplicate: false }
          }),
        )
      }, storeFailure)

      /** Writes the new text as a new row that supersedes the old one; the old row stays as invalid history. */
      const updateNote = Effect.fn('memory repo update note')(function* (input: NoteUpdate) {
        return yield* transaction(
          Effect.gen(function* () {
            const currentRow = yield* noteRow(input.id)
            if (currentRow === undefined) return undefined
            const current = noteOf(currentRow)
            yield* exec('update notes set valid = 0, reason = ? where id = ?', [input.reason, input.id])
            yield* removeDoc('note', String(input.id))
            const twin = yield* activeTwin(current.project, input.text)
            const replacement =
              twin === undefined
                ? yield* insertNote(
                    {
                      project: current.project,
                      text: input.text,
                      category: input.category ?? current.category,
                      scope: input.scope ?? current.scope,
                      confidence: input.confidence ?? current.confidence,
                      sourceThread: input.sourceThread ?? current.sourceThread,
                      sourceSeq: input.sourceThread === null ? current.sourceSeq : input.sourceSeq,
                      origin: input.origin,
                    },
                    current,
                  )
                : noteOf(twin)
            yield* exec('update notes set superseded_by = ? where id = ?', [replacement.id, input.id])
            yield* bump('notes.updated')
            yield* changed
            return replacement
          }),
        )
      }, storeFailure)

      /** Hides the note from memory; the row and the reason stay for audit. */
      const forgetNote = Effect.fn('memory repo forget note')(function* (input: { readonly id: number; readonly reason: string }) {
        const now = yield* Clock.currentTimeMillis
        return yield* transaction(
          Effect.gen(function* () {
            if ((yield* noteRow(input.id)) === undefined) return false
            yield* exec('update notes set valid = 0, forgotten_at = ?, reason = ? where id = ?', [now, input.reason, input.id])
            yield* removeDoc('note', String(input.id))
            yield* bump('notes.forgotten')
            yield* changed
            return true
          }),
        )
      }, storeFailure)

      const archiveNote = Effect.fn('memory repo archive note')(function* (id: number) {
        const now = yield* Clock.currentTimeMillis
        return yield* transaction(
          Effect.gen(function* () {
            if ((yield* noteRow(id)) === undefined) return false
            if ((yield* changes('update notes set archived_at = ? where id = ? and archived_at is null', [now, id])) === 0) return false
            yield* removeDoc('note', String(id))
            yield* changed
            return true
          }),
        )
      }, storeFailure)

      const restoreNote = Effect.fn('memory repo restore note')(function* (id: number) {
        return yield* transaction(
          Effect.gen(function* () {
            const row = yield* first(decodeNotes, 'select * from notes where id = ? and valid = 1 and archived_at is not null', [id])
            if (row === undefined) return false
            const duplicate = yield* first(decodeIds, 'select id from notes where project = ? and hash = ? and valid = 1 and archived_at is null and id != ?', [
              row.project,
              row.hash,
              id,
            ])
            if (duplicate !== undefined) return false
            yield* exec('update notes set archived_at = null where id = ?', [id])
            const restored = noteOf(row)
            yield* indexDoc('note', String(id), restored.project, `${restored.category}: ${restored.text}`)
            yield* changed
            return true
          }),
        )
      }, storeFailure)

      const throughOf = (thread: string) =>
        Effect.map(first(decodeThroughSeq, 'select through_seq from indexed_threads where thread = ?', [thread]), row => row?.through_seq ?? -1)

      /** Appends message text to the contentless indexes only; returns how many rows were new. */
      const indexMessages = Effect.fn('memory repo index messages')(function* (input: {
        readonly thread: string
        readonly project: string
        readonly messages: readonly IndexedMessage[]
        /** The thread's last event, so a thread with nothing to index is still marked as read. */
        readonly throughSeq: number
      }) {
        yield* Effect.annotateCurrentSpan('dshx.memory.messages', input.messages.length)
        return yield* transaction(
          Effect.gen(function* () {
            const through = yield* throughOf(input.thread)
            let added = 0
            let last = through
            for (const message of input.messages) {
              if (message.seq <= through || message.text.trim().length === 0) continue
              const inserted = yield* first(
                decodeRowids,
                'insert or ignore into messages (thread, seq, project, role, at, excerpt) values (?, ?, ?, ?, ?, ?) returning rowid',
                [input.thread, message.seq, input.project, message.role, message.at, message.text.slice(0, excerptChars)],
              )
              if (inserted === undefined) continue
              yield* exec('insert into messages_words (rowid, text) values (?, ?)', [inserted.rowid, message.text])
              yield* exec('insert into messages_ids (rowid, text) values (?, ?)', [inserted.rowid, message.text])
              added++
              last = Math.max(last, message.seq)
            }
            last = Math.max(last, input.throughSeq)
            if (last > through)
              yield* exec(
                'insert into indexed_threads (thread, through_seq) values (?, ?) on conflict (thread) do update set through_seq = excluded.through_seq',
                [input.thread, last],
              )
            return added
          }),
        )
      }, storeFailure)

      /** Fill the excerpt of rows indexed before excerpts were kept, from one read of their Session log. */
      const backfillExcerpts = Effect.fn('memory repo backfill excerpts')(function* (input: {
        readonly thread: string
        readonly messages: readonly { readonly seq: number; readonly text: string }[]
      }) {
        yield* transaction(
          Effect.forEach(
            input.messages,
            message =>
              exec('update messages set excerpt = ? where thread = ? and seq = ? and excerpt is null', [
                message.text.slice(0, excerptChars),
                input.thread,
                message.seq,
              ]),
            { discard: true },
          ),
        )
      }, storeFailure)

      const indexedThrough = Effect.fnUntraced(function* (thread: string) {
        return yield* throughOf(thread)
      }, storeFailure)

      /** A full session id, or the short form the block shows (the first eight characters of the uuid). */
      const thread = Effect.fnUntraced(function* (id: string) {
        const row = yield* first(decodeThreads, 'select * from threads where id = ? or id like ? order by updated_at desc limit 1', [
          id,
          `session-${id.replace(/^session-/, '')}%`,
        ])
        return row === undefined ? undefined : threadOf(row)
      }, storeFailure)

      /**
       * Start-block candidates: distinct top-level digests ranked by how often memory tools returned them, then recency.
       * Entries that were never used and are older than `staleDays` drop out of the block (they stay searchable).
       */
      const blockThreads = Effect.fn('memory repo block threads')(function* (input: {
        readonly projects?: readonly string[]
        readonly excludeProjects?: readonly string[]
        readonly limit: number
        readonly staleDays: number
      }) {
        const clauses = ['duplicate_of is null', 'parent is null']
        const params: (string | number)[] = []
        if (input.projects !== undefined) {
          clauses.push(`project in (${input.projects.map(() => '?').join(', ') || "''"})`)
          params.push(...input.projects)
        }
        if (input.excludeProjects !== undefined && input.excludeProjects.length > 0) {
          clauses.push(`project not in (${input.excludeProjects.map(() => '?').join(', ')})`)
          params.push(...input.excludeProjects)
        }
        if (input.staleDays > 0) {
          clauses.push('(updated_at >= ? or coalesce(last_used_at, 0) >= ?)')
          const cutoff = (yield* Clock.currentTimeMillis) - input.staleDays * dayMs
          params.push(cutoff, cutoff)
        }
        const found = yield* rows(decodeThreads, `select * from threads where ${clauses.join(' and ')} order by uses desc, updated_at desc limit ?`, [
          ...params,
          input.limit,
        ])
        return found.map(threadOf)
      }, storeFailure)

      /**
       * Notes the start block may show: the project's repo and path-scoped notes, global notes everywhere, and the extra
       * scopes an agent owns. Any other scope stays out of every block (it is still searchable), which is what makes an
       * agent's scope its own without a second table.
       */
      const blockNotes = Effect.fn('memory repo block notes')(function* (input: {
        readonly project: string
        readonly limit: number
        readonly scopes?: readonly string[]
      }) {
        const extra = input.scopes ?? []
        const scoped = extra.length === 0 ? '' : ` or scope in (${extra.map(() => '?').join(', ')})`
        const found = yield* rows(
          decodeNotes,
          `select * from notes where valid = 1 and archived_at is null
             and ((project = ? and (scope = 'repo' or scope = 'global' or scope like 'path:%')) or scope = 'global'${scoped})
             order by uses desc, case category when 'feedback' then 0 when 'project' then 1 when 'user' then 2 else 3 end, created_at desc limit ?`,
          [input.project, ...extra, input.limit],
        )
        return found.map(noteOf)
      }, storeFailure)

      const putEmbedding = Effect.fn('memory repo put embedding')(function* (input: {
        readonly kind: 'thread' | 'note' | 'message'
        readonly ref: string
        readonly project: string
        readonly model: string
        readonly vector: Float32Array
      }) {
        yield* exec(
          'insert into embeddings (kind, ref, model, project, updated_at, vector) values (?, ?, ?, ?, ?, ?) on conflict (kind, ref, model) do update set vector = excluded.vector, updated_at = excluded.updated_at',
          [
            input.kind,
            input.ref,
            input.model,
            input.project,
            yield* Clock.currentTimeMillis,
            new Uint8Array(input.vector.buffer, input.vector.byteOffset, input.vector.byteLength),
          ],
        )
      }, storeFailure)

      /** Digests and valid notes that have no vector for `model` yet, oldest first. */
      const missingEmbeddings = Effect.fn('memory repo missing embeddings')(function* (input: { readonly model: string; readonly limit: number }) {
        const threads = yield* rows(
          decodeMissing,
          `select t.id ref, t.project, t.title || char(10) || t.digest text from threads t
             left join embeddings e on e.kind = 'thread' and e.ref = t.id and e.model = ?
             where t.duplicate_of is null and e.ref is null order by t.updated_at limit ?`,
          [input.model, input.limit],
        )
        const notes = yield* rows(
          decodeMissing,
          `select n.id ref, n.project, n.text from notes n
             left join embeddings e on e.kind = 'note' and e.ref = cast(n.id as text) and e.model = ?
             where n.valid = 1 and n.archived_at is null and e.ref is null order by n.created_at limit ?`,
          [input.model, input.limit],
        )
        return [
          ...threads.map((row): MissingEmbedding => ({ kind: 'thread', ref: String(row.ref), project: row.project, text: row.text })),
          ...notes.map((row): MissingEmbedding => ({ kind: 'note', ref: String(row.ref), project: row.project, text: row.text })),
        ]
      }, storeFailure)

      const search = Effect.fn('memory repo search')(function* (request: SearchRequest) {
        const ranker = request.ranker ?? 'bm25'
        const projectFilter = request.projects.length === 0 ? undefined : new Set(request.projects)
        const allowed = (project: string): boolean => projectFilter === undefined || projectFilter.has(project)
        // The project predicate belongs in SQL: a global limit lets out-of-project candidates consume the budget, which
        // suppresses in-scope recall entirely once another project's corpus outranks it. `json_each` keeps one cached
        // statement text for any number of projects. The JS filter stays as the authorization gate either way.
        const scoped = (column: string): { readonly sql: string; readonly parameters: readonly string[] } =>
          request.projects.length === 0
            ? { sql: '', parameters: [] }
            : { sql: ` and ${column} in (select value from json_each(?))`, parameters: [JSON.stringify(request.projects)] }
        const depth = Math.max(50, request.limit * 5)
        const lists: SearchHit[][] = []
        const terms = queryTerms(request.query)
        const matches = (pairs: readonly (readonly [string, string | undefined])[]) =>
          pairs.flatMap(([table, match]) => (match === undefined ? [] : [{ table, match }]))
        if (ranker !== 'vector') {
          const docScope = scoped('d.project')
          const docLists = yield* Effect.forEach(
            matches([
              ['docs_words', wordQuery(terms)],
              ['docs_ids', identifierQuery(terms)],
            ]),
            ({ table, match }) =>
              Effect.map(
                rows(
                  decodeDocHits,
                  `select d.kind, d.ref, d.project, coalesce(t.updated_at, n.created_at, 0) updated_at from ${table} d
                     left join threads t on d.kind = 'thread' and t.id = d.ref
                     left join notes n on d.kind = 'note' and n.id = cast(d.ref as integer)
                     where ${table} match ?${docScope.sql} order by bm25(${table}) limit ?`,
                  [match, ...docScope.parameters, depth * 4],
                ),
                found =>
                  found
                    .filter(row => allowed(row.project))
                    .slice(0, depth)
                    .map((row): SearchHit => {
                      const base = { project: row.project, score: 0, updatedAt: row.updated_at }
                      return row.kind === 'note' ? { kind: 'note', id: Number(row.ref), ...base } : { kind: 'thread', id: row.ref, ...base }
                    }),
              ),
          )
          const messageScope = scoped('m.project')
          const messageLists = yield* Effect.forEach(
            matches([
              ['messages_words', wordQuery(terms)],
              ['messages_ids', identifierQuery(terms)],
            ]),
            ({ table, match }) =>
              Effect.map(
                rows(
                  decodeMessageHits,
                  `select m.thread, m.seq, m.role, m.project, m.at, m.excerpt from ${table} f join messages m on m.rowid = f.rowid
                     where ${table} match ?${messageScope.sql} order by bm25(${table}) limit ?`,
                  [match, ...messageScope.parameters, depth * 4],
                ),
                found =>
                  found
                    .filter(row => allowed(row.project))
                    .slice(0, depth)
                    .map((row): SearchHit => ({
                      kind: 'message',
                      thread: row.thread,
                      seq: row.seq,
                      role: row.role,
                      project: row.project,
                      score: 0,
                      updatedAt: row.at,
                      excerpt: row.excerpt,
                    })),
              ),
          )
          lists.push(...docLists, ...messageLists)
        }
        if (ranker !== 'bm25' && request.queryVector !== undefined && request.embeddingModel !== undefined) {
          const queryVector = request.queryVector
          // Scoring every project's vectors is the expensive half; the predicate keeps the work to the requested projects.
          const scope = scoped('e.project')
          const found = yield* rows(
            decodeVectorHits,
            `select e.kind, e.ref, e.project, e.vector, e.updated_at, m.thread, m.seq, m.role, m.excerpt from embeddings e
               left join messages m on e.kind = 'message' and m.rowid = cast(e.ref as integer) where e.model = ?${scope.sql}`,
            [request.embeddingModel, ...scope.parameters],
          )
          lists.push(
            found
              .filter(row => allowed(row.project))
              .map(row => {
                const blob = row.vector
                const vector = new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength))
                return { row, similarity: cosine(queryVector, vector) }
              })
              .sort((left, right) => right.similarity - left.similarity)
              .slice(0, depth)
              .map(({ row }): SearchHit => {
                const base = { project: row.project, score: 0, updatedAt: row.updated_at }
                if (row.kind === 'note') return { kind: 'note', id: Number(row.ref), ...base }
                if (row.kind === 'message')
                  return { kind: 'message', thread: row.thread ?? '', seq: row.seq ?? 0, role: row.role ?? '', excerpt: row.excerpt, ...base }
                return { kind: 'thread', id: row.ref, ...base }
              }),
          )
        }
        const keyOf = (hit: SearchHit): string => (hit.kind === 'message' ? `m:${hit.thread}:${hit.seq}` : `${hit.kind}:${hit.id}`)
        const fused = new Map<string, { hit: SearchHit; score: number }>()
        for (const list of lists) {
          list.forEach((hit, rank) => {
            const entry = fused.get(keyOf(hit)) ?? { hit, score: 0 }
            entry.score += 1 / (60 + rank)
            fused.set(keyOf(hit), entry)
          })
        }
        const ownProject = request.ownProject ?? request.projects[0]
        const reference = yield* Clock.currentTimeMillis
        const noteIds = [...fused.values()].flatMap(entry => (entry.hit.kind === 'note' ? [entry.hit.id] : []))
        const categories = new Map(
          noteIds.length === 0
            ? []
            : (yield* rows(decodeCategories, 'select id, category from notes where id in (select value from json_each(?))', [JSON.stringify(noteIds)])).map(
                row => [row.id, toCategory(row.category)] as const,
              ),
        )
        for (const entry of fused.values()) {
          const ageDays = Math.max(0, (reference - entry.hit.updatedAt) / dayMs)
          const halfLife = entry.hit.kind === 'note' ? noteHalfLifeDays : digestHalfLifeDays
          // Reciprocal rank fusion × recency decay (never below half, so old exact hits stay findable) × project and note-category boosts.
          entry.score *= 0.5 + 0.5 * 0.5 ** (ageDays / halfLife)
          if (entry.hit.project === ownProject) entry.score *= 1.5
          if (entry.hit.kind === 'note') entry.score *= categoryBoost[categories.get(entry.hit.id) ?? 'project']
        }
        return [...fused.values()]
          .sort((left, right) => right.score - left.score)
          .slice(0, request.limit)
          .map(entry => ({ ...entry.hit, score: entry.score }))
      }, storeFailure)

      /** Counts a citation of a thread or note: cited items rank higher in later start blocks. */
      const recordUse = Effect.fnUntraced(function* (
        item: { readonly kind: 'thread'; readonly id: string } | { readonly kind: 'note'; readonly id: number },
        citingThread: string,
      ) {
        const now = yield* Clock.currentTimeMillis
        yield* exec(`update ${item.kind === 'thread' ? 'threads' : 'notes'} set uses = uses + 1, last_used_at = ? where id = ?`, [now, item.id])
        yield* exec('insert into citations (at, thread, ref) values (?, ?, ?)', [now, citingThread, `${item.kind === 'thread' ? 't' : 'n'}:${item.id}`])
      }, storeFailure)

      /** One model or classifier call memory made on its own behalf; priced later from the token counts. */
      const recordCost = Effect.fnUntraced(function* (input: {
        readonly kind: 'digest' | 'jev'
        readonly provider: string
        readonly model: string
        readonly input: number
        readonly cacheRead: number
        readonly output: number
      }) {
        yield* exec('insert into costs (at, kind, provider, model, input, cache_read, output) values (?, ?, ?, ?, ?, ?, ?)', [
          yield* Clock.currentTimeMillis,
          input.kind,
          input.provider,
          input.model,
          input.input,
          input.cacheRead,
          input.output,
        ])
      }, storeFailure)

      const bumpDaily = Effect.fnUntraced(function* (name: string, by = 1) {
        yield* exec(
          "insert into daily (day, name, value) values (date(? / 1000, 'unixepoch'), ?, ?) on conflict (day, name) do update set value = value + excluded.value",
          [yield* Clock.currentTimeMillis, name, by],
        )
      }, storeFailure)

      /** Token totals per UTC day, kind and route, newest first. */
      const costsByDay = Effect.fn('memory repo costs by day')(function* (days: number) {
        const found = yield* rows(
          decodeCosts,
          `select date(at / 1000, 'unixepoch') day, kind, provider, model, count(*) calls, sum(input) input, sum(cache_read) cache_read, sum(output) output
             from costs where at >= ? group by day, kind, provider, model order by day desc`,
          [(yield* Clock.currentTimeMillis) - days * dayMs],
        )
        return found.map((row): CostRow => ({
          day: row.day,
          kind: row.kind === 'jev' ? 'jev' : 'digest',
          provider: row.provider,
          model: row.model,
          calls: row.calls,
          input: row.input,
          cacheRead: row.cache_read,
          output: row.output,
        }))
      }, storeFailure)

      /**
       * Heuristic correctness signals on a thread's citations of the last `sinceMs`: the agent revised what it said from
       * memory, or the user corrected the answer that cited it.
       */
      const flagCitations = Effect.fnUntraced(function* (input: { readonly thread: string; readonly by: 'agent' | 'user'; readonly sinceMs: number }) {
        return yield* changes(`update citations set ${input.by === 'agent' ? 'agent_corrected' : 'user_corrected'} = 1 where thread = ? and at >= ?`, [
          input.thread,
          (yield* Clock.currentTimeMillis) - input.sinceMs,
        ])
      }, storeFailure)

      const rateCitation = Effect.fn('memory repo rate citation')(function* (input: { readonly id: number; readonly rating: 'up' | 'down' | null }) {
        return (yield* changes('update citations set rating = ? where id = ?', [input.rating, input.id])) > 0
      }, storeFailure)

      /** Recent citations with what they pointed at and where, for the panel's rating list and analytics events. */
      const recentCitations = Effect.fn('memory repo recent citations')(function* (request: {
        readonly limit: number
        readonly thread?: string | undefined
        readonly ref?: string | undefined
      }) {
        const clauses: string[] = []
        const params: (string | number)[] = []
        if (request.thread !== undefined) {
          clauses.push('c.thread = ?')
          params.push(request.thread)
        }
        if (request.ref !== undefined) {
          clauses.push('c.ref = ?')
          params.push(request.ref)
        }
        const found = yield* rows(
          decodeCitations,
          `select c.*, coalesce(t.title, n.text) target, coalesce(t.project, n.project) project, citing.title thread_title from citations c
             left join threads t on c.ref = 't:' || t.id
             left join notes n on c.ref = 'n:' || n.id
             left join threads citing on citing.id = c.thread
             ${clauses.length === 0 ? '' : `where ${clauses.join(' and ')}`}
             order by c.at desc limit ?`,
          [...params, request.limit],
        )
        return found.map((row): CitationRecord => ({
          id: row.id,
          at: row.at,
          thread: row.thread,
          threadTitle: row.thread_title,
          ref: row.ref,
          target: row.target,
          project: row.project,
          rating: citationRatings.find(rating => rating === row.rating) ?? null,
          agentCorrected: row.agent_corrected === 1,
          userCorrected: row.user_corrected === 1,
        }))
      }, storeFailure)

      const dailyTotal = (name: string) => Effect.map(first(decodeCount, 'select sum(value) n from daily where name = ?', [name]), row => row?.n ?? 0)

      /** Whether the start block and cited memory hold up: totals for the panel. */
      const effectiveness = Effect.gen(function* () {
        const blocks = yield* first(decodeBlockStats, "select count(*) n, avg(length(text)) mean, max(length(text)) max from thread_blocks where text != ''")
        const citations = yield* first(
          decodeCitationStats,
          "select count(*) n, sum(agent_corrected) agent, sum(user_corrected) user, sum(rating = 'up') up, sum(rating = 'down') down from citations",
        )
        const result: Effectiveness = {
          block: {
            threads: blocks?.n ?? 0,
            meanBytes: Math.round(blocks?.mean ?? 0),
            maxBytes: blocks?.max ?? 0,
            requests: yield* dailyTotal('block.requests'),
          },
          citations: {
            total: citations?.n ?? 0,
            agentCorrected: citations?.agent ?? 0,
            userCorrected: citations?.user ?? 0,
            up: citations?.up ?? 0,
            down: citations?.down ?? 0,
          },
        }
        return result
      }).pipe(storeFailure, Effect.withSpan('memory repo effectiveness'))

      const frozenText = (threadId: string) => Effect.map(first(decodeTexts, 'select text from thread_blocks where thread = ?', [threadId]), row => row?.text)

      const frozenBlock = Effect.fnUntraced(function* (threadId: string) {
        return yield* frozenText(threadId)
      }, storeFailure)

      const freezeBlock = Effect.fn('memory repo freeze block')(function* (threadId: string, text: string) {
        const inserted = yield* first(decodeTexts, 'insert or ignore into thread_blocks (thread, text, created_at) values (?, ?, ?) returning text', [
          threadId,
          text,
          yield* Clock.currentTimeMillis,
        ])
        if (inserted !== undefined) yield* bump('blocks.served')
        return (yield* frozenText(threadId)) ?? text
      }, storeFailure)

      /** `ids` are the memory ids the call returned (`t:<short>`, `n:<id>`), matched later against citations. */
      const recordToolCall = Effect.fnUntraced(function* (input: {
        readonly thread: string
        readonly tool: string
        readonly results: number
        readonly ids: readonly string[]
      }) {
        yield* exec('insert into tool_calls (at, thread, tool, results, tokens) values (?, ?, ?, ?, ?)', [
          yield* Clock.currentTimeMillis,
          input.thread,
          input.tool,
          input.results,
          input.ids.slice(0, 40).join('\n'),
        ])
      }, storeFailure)

      /** A `memory: <id>` citation in the assistant's reply marks the thread's recent tool calls that returned that id as used. */
      const markCited = Effect.fnUntraced(function* (input: { readonly thread: string; readonly cited: readonly string[]; readonly sinceMs: number }) {
        const cited = new Set(input.cited.map(id => id.toLowerCase()))
        const calls = yield* rows(decodeToolCalls, 'select id, tokens from tool_calls where thread = ? and used = 0 and results > 0 and at >= ?', [
          input.thread,
          (yield* Clock.currentTimeMillis) - input.sinceMs,
        ])
        const used = calls.filter(call => call.tokens.split('\n').some(id => cited.has(id.toLowerCase())))
        yield* Effect.forEach(used, call => exec('update tool_calls set used = 1 where id = ?', [call.id]), { discard: true })
        return used.length
      }, storeFailure)

      /** Notes for the panel, newest first; invalid (superseded or forgotten) rows only when asked for. */
      const listNotes = Effect.fn('memory repo list notes')(function* (filter: NoteFilter) {
        const clauses: string[] = []
        const params: (string | number)[] = []
        if (filter.includeInvalid !== true) clauses.push('valid = 1')
        if (filter.includeArchived !== true) clauses.push('archived_at is null')
        for (const [column, value] of [
          ['project', filter.project],
          ['scope', filter.scope],
          ['category', filter.category],
          ['source_thread', filter.thread],
        ] as const) {
          if (value === undefined) continue
          clauses.push(`${column} = ?`)
          params.push(value)
        }
        if (filter.beforeId !== undefined) {
          clauses.push('id < ?')
          params.push(filter.beforeId)
        }
        if (filter.query !== undefined && filter.query.trim().length > 0) {
          clauses.push('text like ?')
          params.push(`%${filter.query.trim().replaceAll('%', '')}%`)
        }
        const found = yield* rows(
          decodeNotes,
          `select * from notes ${clauses.length === 0 ? '' : `where ${clauses.join(' and ')}`} order by created_at desc, id desc limit ?`,
          [...params, filter.limit],
        )
        return found.map(noteRecordOf)
      }, storeFailure)

      const noteById = (id: number) =>
        Effect.map(first(decodeNotes, 'select * from notes where id = ?', [id]), row => (row === undefined ? undefined : noteRecordOf(row)))

      /** The note's whole supersede chain, oldest first. */
      const noteHistory = Effect.fn('memory repo note history')(function* (id: number) {
        let oldest = yield* noteById(id)
        for (let guard = 0; oldest !== undefined && oldest.supersedes !== null && guard < 100; guard++) oldest = (yield* noteById(oldest.supersedes)) ?? oldest
        const chain: NoteRecord[] = []
        for (let current = oldest, guard = 0; current !== undefined && guard < 100; guard++) {
          chain.push(current)
          current = current.supersededBy === null ? undefined : yield* noteById(current.supersededBy)
        }
        return chain
      }, storeFailure)

      const listThreads = Effect.fn('memory repo list threads')(function* (filter: { readonly project?: string | undefined; readonly limit: number }) {
        const found = yield* rows(
          decodeThreads,
          `select * from threads where duplicate_of is null ${filter.project === undefined ? '' : 'and project = ?'} order by updated_at desc limit ?`,
          [...(filter.project === undefined ? [] : [filter.project]), filter.limit],
        )
        return found.map(threadOf)
      }, storeFailure)

      const projectPaths = rows(
        decodeProjects,
        `select project from notes
           union select project from threads
           union select project from messages
           union select project from embeddings
           union select project from docs_words
           union select project from docs_ids
           order by project`,
      ).pipe(
        Effect.map(found => found.map(row => row.project)),
        storeFailure,
        Effect.withSpan('memory repo project paths'),
      )

      const collisions = (text: string, params: readonly string[]) => Effect.map(first(decodeCollisions, text, params), row => row?.collisions ?? 0)

      const rekeyStored = Effect.fn('memory repo rekey projects')(function* (mappings: readonly { readonly from: string; readonly to: string }[]) {
        if (mappings.length === 0) return { projects: 0, moved: noRowsMoved(), conflicts: [] }
        return yield* transaction(
          Effect.gen(function* () {
            const sourcesByTarget = new Map<string, Set<string>>()
            for (const mapping of mappings) {
              const sources = sourcesByTarget.get(mapping.to) ?? new Set<string>()
              sources.add(mapping.from)
              sourcesByTarget.set(mapping.to, sources)
            }
            const conflictsByTarget = yield* Effect.forEach([...sourcesByTarget], ([target, sources]) =>
              Effect.gen(function* () {
                const projects = [target, ...sources]
                const placeholders = projects.map(() => '?').join(', ')
                const noteCount = yield* collisions(
                  `select count(*) collisions from (
                     select hash from notes where valid = 1 and archived_at is null and hash is not null and project in (${placeholders})
                     group by hash having count(*) > 1)`,
                  projects,
                )
                const threadCount = yield* collisions(
                  `select count(*) collisions from (
                     select digest_hash from threads where duplicate_of is null and project in (${placeholders})
                     group by digest_hash having count(*) > 1)`,
                  projects,
                )
                return [
                  ...(noteCount > 0 ? [{ kind: 'note' as const, target, collisions: noteCount }] : []),
                  ...(threadCount > 0 ? [{ kind: 'thread' as const, target, collisions: threadCount }] : []),
                ]
              }),
            )
            const conflicts = conflictsByTarget.flat()
            if (conflicts.length > 0) return { projects: 0, moved: noRowsMoved(), conflicts }
            const perMapping = yield* Effect.forEach(mappings, mapping =>
              Effect.gen(function* () {
                const move = (table: string) => changes(`update ${table} set project = ? where project = ?`, [mapping.to, mapping.from])
                const projectRows: RowsMoved = {
                  notes: yield* move('notes'),
                  threads: yield* move('threads'),
                  messages: yield* move('messages'),
                  embeddings: yield* move('embeddings'),
                  docsWords: yield* move('docs_words'),
                  docsIds: yield* move('docs_ids'),
                }
                return projectRows
              }),
            )
            const movedMappings = perMapping.filter(projectRows => Object.values(projectRows).some(count => count > 0))
            const moved = movedMappings.reduce(
              (total, projectRows): RowsMoved => ({
                notes: total.notes + projectRows.notes,
                threads: total.threads + projectRows.threads,
                messages: total.messages + projectRows.messages,
                embeddings: total.embeddings + projectRows.embeddings,
                docsWords: total.docsWords + projectRows.docsWords,
                docsIds: total.docsIds + projectRows.docsIds,
              }),
              noRowsMoved(),
            )
            const projectsMoved = movedMappings.length
            if (projectsMoved > 0) yield* changed
            return { projects: projectsMoved, moved, conflicts }
          }),
        )
      }, storeFailure)

      const rekeyProjects = (input: { readonly mappings: readonly { readonly from: string; readonly to: string }[] }) => {
        const targetsBySource = new Map<string, string>()
        let ambiguous: string | undefined
        for (const mapping of input.mappings) {
          if (mapping.from === mapping.to) continue
          const existingTarget = targetsBySource.get(mapping.from)
          if (existingTarget !== undefined && existingTarget !== mapping.to) ambiguous ??= mapping.from
          targetsBySource.set(mapping.from, mapping.to)
        }
        if (ambiguous !== undefined) return Effect.fail(new ProjectRekeyAmbiguous({ from: ambiguous }))
        return rekeyStored([...targetsBySource].map(([from, to]) => ({ from, to })))
      }

      const projects = rows(
        decodeProjectTotals,
        `select project, sum(threads) threads, sum(notes) notes from (
           select project, count(*) threads, 0 notes from threads where duplicate_of is null group by project
           union all select project, 0, count(*) from notes where valid = 1 and archived_at is null group by project)
         group by project order by project`,
      ).pipe(storeFailure, Effect.withSpan('memory repo projects'))

      /** Memory activity per UTC day, newest first: tool calls and outcomes, citations, corrections, digests and blocks. */
      const usageByDay = Effect.fn('memory repo usage by day')(function* (days: number) {
        const since = (yield* Clock.currentTimeMillis) - days * dayMs
        const byDay = new Map<string, DailyUsage>()
        const entry = (day: string): DailyUsage => {
          const existing = byDay.get(day)
          if (existing) return existing
          const created = emptyDay(day)
          byDay.set(day, created)
          return created
        }
        for (const row of yield* rows(
          decodeToolDays,
          "select date(at / 1000, 'unixepoch') day, tool, count(*) calls, sum(results > 0) found, sum(results = 0) empty, sum(used) used from tool_calls where at >= ? group by day, tool",
          [since],
        )) {
          const day = entry(row.day)
          const found = row.found ?? 0
          const empty = row.empty ?? 0
          day.cited += row.used ?? 0
          if (row.tool === 'memory_search') {
            day.searches += row.calls
            day.searchFound += found
            day.searchEmpty += empty
            continue
          }
          if (row.tool === 'memory_read') {
            day.reads += row.calls
            day.readFound += found
            day.readMissing += empty
            continue
          }
          day.notes += row.calls
        }
        for (const row of yield* rows(
          decodeCitationDays,
          "select date(at / 1000, 'unixepoch') day, count(*) n, sum(agent_corrected) agent, sum(user_corrected) user from citations where at >= ? group by day",
          [since],
        )) {
          const day = entry(row.day)
          day.citations += row.n
          day.agentCorrected += row.agent ?? 0
          day.userCorrected += row.user ?? 0
        }
        for (const row of yield* rows(
          decodeDayCounts,
          "select date(digested_at / 1000, 'unixepoch') day, count(*) n from threads where digested_at >= ? group by day",
          [since],
        ))
          entry(row.day).digests += row.n
        for (const row of yield* rows(
          decodeDayCounts,
          "select day, sum(value) n from daily where day >= date(? / 1000, 'unixepoch') and name = 'block.requests' group by day",
          [since],
        ))
          entry(row.day).blockRequests += row.n
        return [...byDay.values()].sort((left, right) => right.day.localeCompare(left.day))
      }, storeFailure)

      /** Stored notes by lifecycle state, for the notes header and analytics. */
      const noteStatusCounts = Effect.fn('memory repo note status counts')(function* (project?: string | undefined) {
        const row = yield* first(
          decodeStatusCounts,
          `select sum(valid = 1 and archived_at is null) active, sum(valid = 1 and archived_at is not null) archived,
                  sum(valid = 0 and forgotten_at is null) superseded, sum(forgotten_at is not null) forgotten from notes${project === undefined ? '' : ' where project = ?'}`,
          project === undefined ? [] : [project],
        )
        const counts: NoteStatusCounts = {
          active: row?.active ?? 0,
          superseded: row?.superseded ?? 0,
          forgotten: row?.forgotten ?? 0,
          archived: row?.archived ?? 0,
        }
        return counts
      }, storeFailure)

      /** The valid notes agents cited most, with their current text and citation counts. */
      const topNotes = Effect.fn('memory repo top notes')(function* (limit: number) {
        const found = yield* rows(
          decodeNotes,
          'select * from notes where valid = 1 and archived_at is null and uses > 0 order by uses desc, created_at desc limit ?',
          [limit],
        )
        return found.map(noteRecordOf)
      }, storeFailure)

      const count = (text: string) => Effect.map(first(decodeCount, text), row => row?.n ?? 0)

      const usage = Effect.gen(function* () {
        const tools = yield* rows(
          decodeToolTotals,
          'select tool, count(*) calls, sum(results > 0) with_results, sum(used) used from tool_calls group by tool order by tool',
        )
        const counters = yield* rows(decodeCounters, 'select name, value from counters')
        const counts: UsageCounts = {
          tools: tools.map(row => ({
            tool: row.tool,
            calls: row.calls,
            withResults: row.with_results ?? 0,
            empty: row.calls - (row.with_results ?? 0),
            used: row.used ?? 0,
          })),
          counters: Object.fromEntries(counters.map(row => [row.name, row.value])),
          threads: yield* count('select count(*) n from threads where duplicate_of is null'),
          notes: yield* count('select count(*) n from notes where valid = 1 and archived_at is null'),
          indexedMessages: yield* count('select count(*) n from messages'),
        }
        return counts
      }).pipe(storeFailure, Effect.withSpan('memory repo usage'))

      /** Drops digests, indexed messages, frozen blocks and telemetry older than the retention window. Notes stay until forgotten. */
      const prune = Effect.fn('memory repo prune')(function* (retentionDays: number) {
        if (retentionDays <= 0) return { threads: 0, messages: 0 }
        const cutoff = (yield* Clock.currentTimeMillis) - retentionDays * dayMs
        return yield* transaction(
          Effect.gen(function* () {
            const old = yield* rows(decodeOldThreads, 'select id, project from threads where updated_at < ? and coalesce(last_used_at, 0) < ?', [
              cutoff,
              cutoff,
            ])
            for (const row of old) {
              yield* removeDoc('thread', row.id)
              yield* exec('delete from threads where id = ?', [row.id])
            }
            const messages = yield* rows(decodeRowids, 'select rowid from messages where at < ?', [cutoff])
            for (const row of messages) {
              yield* exec('delete from messages_words where rowid = ?', [row.rowid])
              yield* exec('delete from messages_ids where rowid = ?', [row.rowid])
              yield* exec("delete from embeddings where kind = 'message' and ref = ?", [String(row.rowid)])
            }
            for (const table of ['messages where at', 'thread_blocks where created_at', 'tool_calls where at', 'costs where at', 'citations where at'])
              yield* exec(`delete from ${table} < ?`, [cutoff])
            if (old.length > 0) yield* changed
            return { threads: old.length, messages: messages.length }
          }),
        )
      }, storeFailure)

      return MemoryRepo.of({
        version: Ref.get(version),
        putThread,
        thread,
        blockThreads,
        addNote,
        note,
        updateNote,
        forgetNote,
        archiveNote,
        restoreNote,
        blockNotes,
        indexMessages,
        backfillExcerpts,
        indexedThrough,
        putEmbedding,
        missingEmbeddings,
        search,
        recordUse,
        recordCost,
        bump,
        bumpDaily,
        costsByDay,
        flagCitations,
        rateCitation,
        recentCitations,
        effectiveness,
        frozenBlock,
        freezeBlock,
        recordToolCall,
        markCited,
        listNotes,
        noteHistory,
        listThreads,
        projectPaths,
        rekeyProjects,
        projects,
        usageByDay,
        noteStatusCounts,
        topNotes,
        usage,
        prune,
      })
    }),
  )
}
