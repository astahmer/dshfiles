import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLOutputValue, type StatementSync } from 'node:sqlite'

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

export type NoteOrigin = 'user-requested' | 'agent' | 'panel'

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
export type NoteStatusCounts = { readonly active: number; readonly superseded: number; readonly forgotten: number }

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
      /** The message's first `MemoryStore.excerptChars` characters; null for rows indexed before excerpts were kept. */
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

const toCategory = (value: SQLOutputValue | undefined): NoteCategory => noteCategories.find(category => category === value) ?? 'project'

type Row = Record<string, SQLOutputValue>

const citationRatings: readonly ('up' | 'down')[] = ['up', 'down']

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
  return words.length === 0
    ? undefined
    : [...new Set(words)]
        .slice(0, 24)
        .map(word => `"${word}"`)
        .join(' OR ')
}

/** Identifier-looking terms (digits or separators, or long words) as substrings for the trigram table. */
const identifierQuery = (terms: readonly string[]): string | undefined => {
  const identifiers = terms.filter(term => term.length >= 3 && (/[\d._:/-]/.test(term) || term.length >= 8))
  return identifiers.length === 0
    ? undefined
    : identifiers
        .slice(0, 12)
        .map(term => `"${term.replaceAll('"', '')}"`)
        .join(' OR ')
}

const schema = `
create table if not exists threads (
  id text primary key,
  project text not null,
  parent text,
  title text not null,
  decision text not null,
  digest text not null,
  digest_hash text not null,
  source text not null,
  last_seq integer not null,
  updated_at integer not null,
  digested_at integer not null,
  duplicate_of text,
  uses integer not null default 0,
  last_used_at integer
);
create index if not exists threads_project on threads (project, updated_at desc);
create index if not exists threads_hash on threads (project, digest_hash);
create table if not exists notes (
  id integer primary key,
  project text not null,
  scope text not null,
  category text not null,
  confidence text not null,
  text text not null,
  hash text not null,
  source_thread text,
  source_seq integer,
  origin text not null default 'agent',
  first_created_at integer not null default 0,
  created_at integer not null,
  valid integer not null default 1,
  supersedes integer,
  superseded_by integer,
  forgotten_at integer,
  reason text,
  uses integer not null default 0,
  last_used_at integer
);
create unique index if not exists notes_valid_hash on notes (project, hash) where valid = 1;
create index if not exists notes_project on notes (project, valid, created_at desc);
create virtual table if not exists docs_words using fts5 (text, kind unindexed, ref unindexed, project unindexed, tokenize = 'porter unicode61 remove_diacritics 2');
create virtual table if not exists docs_ids using fts5 (text, kind unindexed, ref unindexed, project unindexed, tokenize = 'trigram');
create virtual table if not exists messages_words using fts5 (text, content = '', contentless_delete = 1, tokenize = 'porter unicode61 remove_diacritics 2');
create virtual table if not exists messages_ids using fts5 (text, content = '', contentless_delete = 1, tokenize = 'trigram');
create table if not exists messages (
  rowid integer primary key,
  thread text not null,
  seq integer not null,
  project text not null,
  role text not null,
  at integer not null,
  excerpt text,
  unique (thread, seq)
);
create index if not exists messages_at on messages (at);
create table if not exists indexed_threads (thread text primary key, through_seq integer not null);
create table if not exists thread_blocks (thread text primary key, text text not null, created_at integer not null);
create table if not exists embeddings (kind text not null, ref text not null, model text not null, project text not null, updated_at integer not null, vector blob not null, primary key (kind, ref, model));
create table if not exists tool_calls (id integer primary key, at integer not null, thread text not null, tool text not null, results integer not null, used integer not null default 0, tokens text not null);
create index if not exists tool_calls_thread on tool_calls (thread, at);
create table if not exists counters (name text primary key, value integer not null);
create table if not exists citations (
  id integer primary key,
  at integer not null,
  thread text not null,
  ref text not null,
  rating text,
  agent_corrected integer not null default 0,
  user_corrected integer not null default 0
);
create table if not exists costs (at integer not null, kind text not null, provider text not null, model text not null, input integer not null, cache_read integer not null, output integer not null);
create index if not exists costs_at on costs (at);
create table if not exists daily (day text not null, name text not null, value integer not null, primary key (day, name));
create index if not exists citations_at on citations (at);
`

/** Characters of a message kept with its index row, enough for a search snippet without reading the Session log. */
const EXCERPT_CHARS = 2_000

const excerptOf = (value: SQLOutputValue | undefined): string | null => (value === null || value === undefined ? null : String(value))

/**
 * The plugin's only persistent state: thread digests, notes, a contentless index of message text (the text itself
 * stays in DSH's session log and is read back on demand), frozen start blocks, optional embeddings and usage counters.
 */
export const openMemoryStore = (options: { readonly path: string; readonly now?: () => number }) => {
  const now = options.now ?? Date.now
  if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(options.path)
  database.exec('pragma journal_mode = wal; pragma busy_timeout = 5000;')
  database.exec(schema)
  // Databases created before excerpts were kept get the column; their rows stay null until a log read backfills them.
  if (
    !database
      .prepare('select name from pragma_table_info(?)')
      .all('messages')
      .some(column => column['name'] === 'excerpt')
  )
    database.exec('alter table messages add column excerpt text')
  /**
   * One prepared statement per SQL text for the life of this database. The store compiles the same index, lookup and
   * retention SQL over and over otherwise — three statements per indexed message alone — and preparing re-parses it.
   */
  const statements = new Map<string, StatementSync>()
  const statement = (sql: string): StatementSync => {
    const cached = statements.get(sql)
    if (cached !== undefined) return cached
    const prepared = database.prepare(sql)
    statements.set(sql, prepared)
    return prepared
  }

  let version = 0
  const listeners = new Set<(project: string) => void>()
  const changed = (project: string): void => {
    version++
    for (const listener of listeners) listener(project)
  }

  const bump = (name: string, by = 1): void => {
    statement('insert into counters (name, value) values (?, ?) on conflict (name) do update set value = value + excluded.value').run(name, by)
  }

  const transaction = <T>(run: () => T): T => {
    database.exec('begin immediate')
    try {
      const result = run()
      database.exec('commit')
      return result
    } catch (error) {
      database.exec('rollback')
      throw error
    }
  }

  const indexDoc = (kind: 'thread' | 'note', ref: string, project: string, text: string): void => {
    statement('insert into docs_words (text, kind, ref, project) values (?, ?, ?, ?)').run(text, kind, ref, project)
    statement('insert into docs_ids (text, kind, ref, project) values (?, ?, ?, ?)').run(text, kind, ref, project)
  }

  const removeDoc = (kind: 'thread' | 'note', ref: string): void => {
    statement('delete from docs_words where kind = ? and ref = ?').run(kind, ref)
    statement('delete from docs_ids where kind = ? and ref = ?').run(kind, ref)
    statement('delete from embeddings where kind = ? and ref = ?').run(kind, ref)
  }

  const threadRow = (row: Row): StoredThread => ({
    id: String(row['id']),
    project: String(row['project']),
    parent: row['parent'] === null ? null : String(row['parent']),
    title: String(row['title']),
    decision: String(row['decision']),
    digest: String(row['digest']),
    source: row['source'] === 'model' ? 'model' : 'trail',
    lastSeq: Number(row['last_seq']),
    updatedAt: Number(row['updated_at']),
    digestedAt: Number(row['digested_at']),
    duplicateOf: row['duplicate_of'] === null ? null : String(row['duplicate_of']),
    uses: Number(row['uses']),
    lastUsedAt: row['last_used_at'] === null ? null : Number(row['last_used_at']),
  })

  const noteRow = (row: Row): Note => ({
    id: Number(row['id']),
    project: String(row['project']),
    scope: String(row['scope']),
    category: toCategory(row['category']),
    confidence: row['confidence'] === 'inferred' ? 'inferred' : 'stated',
    text: String(row['text']),
    sourceThread: row['source_thread'] === null ? null : String(row['source_thread']),
    sourceSeq: row['source_seq'] === null ? null : Number(row['source_seq']),
    origin: row['origin'] === 'user-requested' || row['origin'] === 'panel' ? row['origin'] : 'agent',
    firstCreatedAt: Number(row['first_created_at']) || Number(row['created_at']),
    createdAt: Number(row['created_at']),
    supersedes: row['supersedes'] === null ? null : Number(row['supersedes']),
    uses: Number(row['uses']),
  })

  const noteRecord = (row: Row): NoteRecord => ({
    ...noteRow(row),
    valid: Number(row['valid']) === 1,
    supersededBy: row['superseded_by'] === null ? null : Number(row['superseded_by']),
    forgottenAt: row['forgotten_at'] === null ? null : Number(row['forgotten_at']),
    reason: row['reason'] === null ? null : String(row['reason']),
  })

  const putThread = (digest: ThreadDigest): { readonly stored: 'new' | 'updated' | 'unchanged' | 'duplicate' } =>
    transaction(() => {
      const hash = hashOf(digest.digest)
      const existing = statement('select digest_hash from threads where id = ?').get(digest.id)
      if (existing?.['digest_hash'] === hash) return { stored: 'unchanged' as const }
      const twin = statement('select id from threads where project = ? and digest_hash = ? and id != ? and duplicate_of is null limit 1').get(
        digest.project,
        hash,
        digest.id,
      )
      const duplicateOf = twin === undefined ? null : String(twin['id'])
      statement(
        `insert into threads (id, project, parent, title, decision, digest, digest_hash, source, last_seq, updated_at, digested_at, duplicate_of)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (id) do update set project = excluded.project, parent = excluded.parent, title = excluded.title, decision = excluded.decision,
             digest = excluded.digest, digest_hash = excluded.digest_hash, source = excluded.source, last_seq = excluded.last_seq,
             updated_at = excluded.updated_at, digested_at = excluded.digested_at, duplicate_of = excluded.duplicate_of`,
      ).run(
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
        now(),
        duplicateOf,
      )
      removeDoc('thread', digest.id)
      if (duplicateOf === null) indexDoc('thread', digest.id, digest.project, `${digest.title}\n${digest.digest}`)
      bump(duplicateOf === null ? `digests.${digest.source}` : 'digests.duplicate')
      changed(digest.project)
      return { stored: duplicateOf !== null ? ('duplicate' as const) : existing === undefined ? ('new' as const) : ('updated' as const) }
    })

  const note = (id: number): Note | undefined => {
    const row = statement('select * from notes where id = ? and valid = 1').get(id)
    return row === undefined ? undefined : noteRow(row)
  }

  const insertNote = (input: NoteInput, supersedes: Note | null): Note => {
    const at = now()
    const firstCreatedAt = supersedes?.firstCreatedAt ?? at
    const result = statement(
      `insert into notes (project, scope, category, confidence, text, hash, source_thread, source_seq, origin, created_at, first_created_at, supersedes, uses)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
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
    )
    const id = Number(result.lastInsertRowid)
    indexDoc('note', String(id), input.project, `${input.category}: ${input.text}`)
    return { ...input, id, createdAt: at, firstCreatedAt, supersedes: supersedes?.id ?? null, uses: supersedes?.uses ?? 0 }
  }

  /** A note whose text already exists as a valid note of the project is not stored twice; the existing one is returned. */
  const addNote = (input: NoteInput): { readonly note: Note; readonly duplicate: boolean } =>
    transaction(() => {
      const twin = statement('select * from notes where project = ? and hash = ? and valid = 1').get(input.project, hashOf(input.text))
      if (twin !== undefined) return { note: noteRow(twin), duplicate: true }
      const created = insertNote(input, null)
      bump('notes.added')
      changed(input.project)
      return { note: created, duplicate: false }
    })

  /** Writes the new text as a new row that supersedes the old one; the old row stays as invalid history. */
  const updateNote = (input: {
    readonly id: number
    readonly text: string
    readonly reason: string
    readonly sourceThread: string | null
    readonly sourceSeq: number | null
    readonly origin: NoteOrigin
    readonly category?: NoteCategory | undefined
    readonly scope?: string | undefined
    readonly confidence?: 'stated' | 'inferred' | undefined
  }): Note | undefined =>
    transaction(() => {
      const current = note(input.id)
      if (current === undefined) return undefined
      statement('update notes set valid = 0, reason = ? where id = ?').run(input.reason, input.id)
      removeDoc('note', String(input.id))
      const twin = statement('select * from notes where project = ? and hash = ? and valid = 1').get(current.project, hashOf(input.text))
      const replacement =
        twin === undefined
          ? insertNote(
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
          : noteRow(twin)
      statement('update notes set superseded_by = ? where id = ?').run(replacement.id, input.id)
      bump('notes.updated')
      changed(current.project)
      return replacement
    })

  /** Hides the note from memory; the row and the reason stay for audit. */
  const forgetNote = (input: { readonly id: number; readonly reason: string }): boolean =>
    transaction(() => {
      const current = note(input.id)
      if (current === undefined) return false
      statement('update notes set valid = 0, forgotten_at = ?, reason = ? where id = ?').run(now(), input.reason, input.id)
      removeDoc('note', String(input.id))
      bump('notes.forgotten')
      changed(current.project)
      return true
    })

  /** Appends message text to the contentless indexes only; returns how many rows were new. */
  const indexMessages = (input: {
    readonly thread: string
    readonly project: string
    readonly messages: readonly IndexedMessage[]
    /** The thread's last event, so a thread with nothing to index is still marked as read. */
    readonly throughSeq: number
  }): number =>
    transaction(() => {
      const known = statement('select through_seq from indexed_threads where thread = ?').get(input.thread)
      const through = known === undefined ? -1 : Number(known['through_seq'])
      let added = 0
      let last = through
      for (const message of input.messages) {
        if (message.seq <= through || message.text.trim().length === 0) continue
        const result = statement('insert or ignore into messages (thread, seq, project, role, at, excerpt) values (?, ?, ?, ?, ?, ?)').run(
          input.thread,
          message.seq,
          input.project,
          message.role,
          message.at,
          message.text.slice(0, EXCERPT_CHARS),
        )
        if (result.changes === 0) continue
        statement('insert into messages_words (rowid, text) values (?, ?)').run(result.lastInsertRowid, message.text)
        statement('insert into messages_ids (rowid, text) values (?, ?)').run(result.lastInsertRowid, message.text)
        added++
        last = Math.max(last, message.seq)
      }
      last = Math.max(last, input.throughSeq)
      if (last > through)
        statement('insert into indexed_threads (thread, through_seq) values (?, ?) on conflict (thread) do update set through_seq = excluded.through_seq').run(
          input.thread,
          last,
        )
      return added
    })

  /** Fill the excerpt of rows indexed before excerpts were kept, from one read of their Session log. */
  const backfillExcerpts = (input: { readonly thread: string; readonly messages: readonly { readonly seq: number; readonly text: string }[] }): void =>
    transaction(() => {
      for (const message of input.messages)
        statement('update messages set excerpt = ? where thread = ? and seq = ? and excerpt is null').run(
          message.text.slice(0, EXCERPT_CHARS),
          input.thread,
          message.seq,
        )
    })

  const indexedThrough = (thread: string): number =>
    Number(statement('select through_seq from indexed_threads where thread = ?').get(thread)?.['through_seq'] ?? -1)

  /** A full session id, or the short form the block shows (the first eight characters of the uuid). */
  const thread = (id: string): StoredThread | undefined => {
    const row = statement('select * from threads where id = ? or id like ? order by updated_at desc limit 1').get(id, `session-${id.replace(/^session-/, '')}%`)
    return row === undefined ? undefined : threadRow(row)
  }

  /**
   * Start-block candidates: distinct top-level digests ranked by how often memory tools returned them, then recency.
   * Entries that were never used and are older than `staleDays` drop out of the block (they stay searchable).
   */
  const blockThreads = (input: {
    readonly projects?: readonly string[]
    readonly excludeProjects?: readonly string[]
    readonly limit: number
    readonly staleDays: number
  }): readonly StoredThread[] => {
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
      const cutoff = now() - input.staleDays * dayMs
      params.push(cutoff, cutoff)
    }
    return statement(`select * from threads where ${clauses.join(' and ')} order by uses desc, updated_at desc limit ?`)
      .all(...params, input.limit)
      .map(threadRow)
  }

  /** Valid notes for a project's block: its own and global ones, ranked by citations, then feedback and project context first, then recency. */
  /**
   * Notes the start block may show: the project's repo and path-scoped notes, global notes everywhere, and the extra
   * scopes an agent owns. Any other scope stays out of every block (it is still searchable), which is what makes an
   * agent's scope its own without a second table.
   */
  const blockNotes = (input: { readonly project: string; readonly limit: number; readonly scopes?: readonly string[] }): readonly Note[] => {
    const extra = input.scopes ?? []
    const extraSql = extra.map(() => '?').join(', ')
    const scoped = extra.length === 0 ? '' : ` or scope in (${extraSql})`
    return statement(
      `select * from notes where valid = 1
         and ((project = ? and (scope = 'repo' or scope = 'global' or scope like 'path:%')) or scope = 'global'${scoped})
         order by uses desc, case category when 'feedback' then 0 when 'project' then 1 when 'user' then 2 else 3 end, created_at desc limit ?`,
    )
      .all(input.project, ...extra, input.limit)
      .map(noteRow)
  }

  const putEmbedding = (input: {
    readonly kind: 'thread' | 'note' | 'message'
    readonly ref: string
    readonly project: string
    readonly model: string
    readonly vector: Float32Array
  }): void => {
    statement(
      'insert into embeddings (kind, ref, model, project, updated_at, vector) values (?, ?, ?, ?, ?, ?) on conflict (kind, ref, model) do update set vector = excluded.vector, updated_at = excluded.updated_at',
    ).run(input.kind, input.ref, input.model, input.project, now(), new Uint8Array(input.vector.buffer, input.vector.byteOffset, input.vector.byteLength))
  }

  /** Digests and valid notes that have no vector for `model` yet, oldest first. */
  const missingEmbeddings = (input: { readonly model: string; readonly limit: number }) => [
    ...statement(
      `select t.id ref, t.project, t.title || char(10) || t.digest text from threads t
         left join embeddings e on e.kind = 'thread' and e.ref = t.id and e.model = ?
         where t.duplicate_of is null and e.ref is null order by t.updated_at limit ?`,
    )
      .all(input.model, input.limit)
      .map(row => ({ kind: 'thread' as const, ref: String(row['ref']), project: String(row['project']), text: String(row['text']) })),
    ...statement(
      `select n.id ref, n.project, n.text from notes n
         left join embeddings e on e.kind = 'note' and e.ref = cast(n.id as text) and e.model = ?
         where n.valid = 1 and e.ref is null order by n.created_at limit ?`,
    )
      .all(input.model, input.limit)
      .map(row => ({ kind: 'note' as const, ref: String(row['ref']), project: String(row['project']), text: String(row['text']) })),
  ]

  const search = (request: SearchRequest): readonly SearchHit[] => {
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
    if (ranker !== 'vector') {
      for (const [table, match] of [
        ['docs_words', wordQuery(terms)],
        ['docs_ids', identifierQuery(terms)],
      ] as const) {
        if (match === undefined) continue
        const scope = scoped('d.project')
        lists.push(
          statement(
            `select d.kind, d.ref, d.project, coalesce(t.updated_at, n.created_at, 0) updated_at from ${table} d
               left join threads t on d.kind = 'thread' and t.id = d.ref
               left join notes n on d.kind = 'note' and n.id = cast(d.ref as integer)
               where ${table} match ?${scope.sql} order by bm25(${table}) limit ?`,
          )
            .all(match, ...scope.parameters, depth * 4)
            .filter(row => allowed(String(row['project'])))
            .slice(0, depth)
            .map((row): SearchHit => {
              const base = { project: String(row['project']), score: 0, updatedAt: Number(row['updated_at']) }
              return row['kind'] === 'note' ? { kind: 'note', id: Number(row['ref']), ...base } : { kind: 'thread', id: String(row['ref']), ...base }
            }),
        )
      }
      for (const [table, match] of [
        ['messages_words', wordQuery(terms)],
        ['messages_ids', identifierQuery(terms)],
      ] as const) {
        if (match === undefined) continue
        const scope = scoped('m.project')
        lists.push(
          statement(
            `select m.thread, m.seq, m.role, m.project, m.at, m.excerpt from ${table} f join messages m on m.rowid = f.rowid
               where ${table} match ?${scope.sql} order by bm25(${table}) limit ?`,
          )
            .all(match, ...scope.parameters, depth * 4)
            .filter(row => allowed(String(row['project'])))
            .slice(0, depth)
            .map((row): SearchHit => ({
              kind: 'message',
              thread: String(row['thread']),
              seq: Number(row['seq']),
              role: String(row['role']),
              project: String(row['project']),
              score: 0,
              updatedAt: Number(row['at']),
              excerpt: excerptOf(row['excerpt']),
            })),
        )
      }
    }
    if (ranker !== 'bm25' && request.queryVector !== undefined && request.embeddingModel !== undefined) {
      const queryVector = request.queryVector
      // Scoring every project's vectors is the expensive half; the predicate keeps the work to the requested projects.
      const scope = scoped('e.project')
      lists.push(
        statement(
          `select e.kind, e.ref, e.project, e.vector, e.updated_at, m.thread, m.seq, m.role, m.excerpt from embeddings e
             left join messages m on e.kind = 'message' and m.rowid = cast(e.ref as integer) where e.model = ?${scope.sql}`,
        )
          .all(request.embeddingModel, ...scope.parameters)
          .filter(row => allowed(String(row['project'])))
          .map(row => {
            const blob = row['vector']
            const vector =
              blob instanceof Uint8Array ? new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)) : new Float32Array()
            return { row, similarity: cosine(queryVector, vector) }
          })
          .sort((left, right) => right.similarity - left.similarity)
          .slice(0, depth)
          .map(({ row }): SearchHit => {
            const base = { project: String(row['project']), score: 0, updatedAt: Number(row['updated_at']) }
            if (row['kind'] === 'note') return { kind: 'note', id: Number(row['ref']), ...base }
            if (row['kind'] === 'message')
              return {
                kind: 'message',
                thread: String(row['thread']),
                seq: Number(row['seq']),
                role: String(row['role']),
                excerpt: excerptOf(row['excerpt']),
                ...base,
              }
            return { kind: 'thread', id: String(row['ref']), ...base }
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
    const reference = now()
    const categories = new Map(
      [...fused.values()]
        .flatMap(entry => (entry.hit.kind === 'note' ? [entry.hit.id] : []))
        .map(id => [id, toCategory(statement('select category from notes where id = ?').get(id)?.['category'])] as const),
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
  }

  /** Counts a citation of a thread or note: cited items rank higher in later start blocks. */
  const recordUse = (item: { readonly kind: 'thread'; readonly id: string } | { readonly kind: 'note'; readonly id: number }, citingThread: string): void => {
    const table = item.kind === 'thread' ? 'threads' : 'notes'
    statement(`update ${table} set uses = uses + 1, last_used_at = ? where id = ?`).run(now(), item.id)
    statement('insert into citations (at, thread, ref) values (?, ?, ?)').run(now(), citingThread, `${item.kind === 'thread' ? 't' : 'n'}:${item.id}`)
  }

  /** One model or classifier call memory made on its own behalf; priced later from the token counts. */
  const recordCost = (input: {
    readonly kind: 'digest' | 'jev'
    readonly provider: string
    readonly model: string
    readonly input: number
    readonly cacheRead: number
    readonly output: number
  }): void => {
    statement('insert into costs (at, kind, provider, model, input, cache_read, output) values (?, ?, ?, ?, ?, ?, ?)').run(
      now(),
      input.kind,
      input.provider,
      input.model,
      input.input,
      input.cacheRead,
      input.output,
    )
  }

  const bumpDaily = (name: string, by = 1): void => {
    statement(
      "insert into daily (day, name, value) values (date(? / 1000, 'unixepoch'), ?, ?) on conflict (day, name) do update set value = value + excluded.value",
    ).run(now(), name, by)
  }

  /** Token totals per UTC day, kind and route, newest first. */
  const costsByDay = (days: number) =>
    statement(
      `select date(at / 1000, 'unixepoch') day, kind, provider, model, count(*) calls, sum(input) input, sum(cache_read) cache_read, sum(output) output
         from costs where at >= ? group by day, kind, provider, model order by day desc`,
    )
      .all(now() - days * dayMs)
      .map(row => ({
        day: String(row['day']),
        kind: row['kind'] === 'jev' ? ('jev' as const) : ('digest' as const),
        provider: String(row['provider']),
        model: String(row['model']),
        calls: Number(row['calls']),
        input: Number(row['input']),
        cacheRead: Number(row['cache_read']),
        output: Number(row['output']),
      }))

  /**
   * Heuristic correctness signals on a thread's citations of the last `sinceMs`: the agent revised what it said from
   * memory, or the user corrected the answer that cited it.
   */
  const flagCitations = (input: { readonly thread: string; readonly by: 'agent' | 'user'; readonly sinceMs: number }): number =>
    Number(
      statement(`update citations set ${input.by === 'agent' ? 'agent_corrected' : 'user_corrected'} = 1 where thread = ? and at >= ?`).run(
        input.thread,
        now() - input.sinceMs,
      ).changes,
    )

  const rateCitation = (input: { readonly id: number; readonly rating: 'up' | 'down' | null }): boolean =>
    statement('update citations set rating = ? where id = ?').run(input.rating, input.id).changes > 0

  /** Recent citations with what they pointed at and where, for the panel's rating list and analytics events. */
  const recentCitations = (request: { readonly limit: number; readonly thread?: string | undefined; readonly ref?: string | undefined }) => {
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
    return statement(
      `select c.*, coalesce(t.title, n.text) target, coalesce(t.project, n.project) project, citing.title thread_title from citations c
         left join threads t on c.ref = 't:' || t.id
         left join notes n on c.ref = 'n:' || n.id
         left join threads citing on citing.id = c.thread
         ${clauses.length === 0 ? '' : `where ${clauses.join(' and ')}`}
         order by c.at desc limit ?`,
    )
      .all(...params, request.limit)
      .map(row => ({
        id: Number(row['id']),
        at: Number(row['at']),
        thread: String(row['thread']),
        threadTitle: row['thread_title'] === null ? null : String(row['thread_title']),
        ref: String(row['ref']),
        target: row['target'] === null ? null : String(row['target']),
        project: row['project'] === null ? null : String(row['project']),
        rating: citationRatings.find(rating => rating === row['rating']) ?? null,
        agentCorrected: Number(row['agent_corrected']) === 1,
        userCorrected: Number(row['user_corrected']) === 1,
      }))
  }

  /** Whether the start block and cited memory hold up: totals for the panel. */
  const effectiveness = () => {
    const blocks = statement("select count(*) n, avg(length(text)) mean, max(length(text)) max from thread_blocks where text != ''").get()
    const citations = statement(
      "select count(*) n, sum(agent_corrected) agent, sum(user_corrected) user, sum(rating = 'up') up, sum(rating = 'down') down from citations",
    ).get()
    const daily = (name: string): number => Number(statement('select sum(value) n from daily where name = ?').get(name)?.['n'] ?? 0)
    return {
      block: {
        threads: Number(blocks?.['n'] ?? 0),
        meanBytes: Math.round(Number(blocks?.['mean'] ?? 0)),
        maxBytes: Number(blocks?.['max'] ?? 0),
        requests: daily('block.requests'),
      },
      citations: {
        total: Number(citations?.['n'] ?? 0),
        agentCorrected: Number(citations?.['agent'] ?? 0),
        userCorrected: Number(citations?.['user'] ?? 0),
        up: Number(citations?.['up'] ?? 0),
        down: Number(citations?.['down'] ?? 0),
      },
    }
  }

  const frozenBlock = (threadId: string): string | undefined => {
    const row = statement('select text from thread_blocks where thread = ?').get(threadId)
    return row === undefined ? undefined : String(row['text'])
  }

  const freezeBlock = (threadId: string, text: string): string => {
    const result = statement('insert or ignore into thread_blocks (thread, text, created_at) values (?, ?, ?)').run(threadId, text, now())
    if (result.changes > 0) bump('blocks.served')
    return frozenBlock(threadId) ?? text
  }

  /** `ids` are the memory ids the call returned (`t:<short>`, `n:<id>`), matched later against citations. */
  const recordToolCall = (input: { readonly thread: string; readonly tool: string; readonly results: number; readonly ids: readonly string[] }): void => {
    statement('insert into tool_calls (at, thread, tool, results, tokens) values (?, ?, ?, ?, ?)').run(
      now(),
      input.thread,
      input.tool,
      input.results,
      input.ids.slice(0, 40).join('\n'),
    )
  }

  /** A `memory: <id>` citation in the assistant's reply marks the thread's recent tool calls that returned that id as used. */
  const markCited = (input: { readonly thread: string; readonly cited: readonly string[]; readonly sinceMs: number }): number => {
    const cited = new Set(input.cited.map(id => id.toLowerCase()))
    let marked = 0
    for (const row of statement('select id, tokens from tool_calls where thread = ? and used = 0 and results > 0 and at >= ?').all(
      input.thread,
      now() - input.sinceMs,
    )) {
      if (
        !String(row['tokens'])
          .split('\n')
          .some(id => cited.has(id.toLowerCase()))
      )
        continue
      statement('update tool_calls set used = 1 where id = ?').run(Number(row['id']))
      marked++
    }
    return marked
  }

  /** Notes for the panel, newest first; invalid (superseded or forgotten) rows only when asked for. */
  const listNotes = (filter: {
    readonly project?: string | undefined
    readonly scope?: string | undefined
    readonly category?: NoteCategory | undefined
    readonly query?: string | undefined
    readonly thread?: string | undefined
    readonly includeInvalid?: boolean | undefined
    readonly limit: number
  }): readonly NoteRecord[] => {
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (filter.includeInvalid !== true) clauses.push('valid = 1')
    if (filter.project !== undefined) {
      clauses.push('project = ?')
      params.push(filter.project)
    }
    if (filter.scope !== undefined) {
      clauses.push('scope = ?')
      params.push(filter.scope)
    }
    if (filter.category !== undefined) {
      clauses.push('category = ?')
      params.push(filter.category)
    }
    if (filter.thread !== undefined) {
      clauses.push('source_thread = ?')
      params.push(filter.thread)
    }
    if (filter.query !== undefined && filter.query.trim().length > 0) {
      clauses.push('text like ?')
      params.push(`%${filter.query.trim().replaceAll('%', '')}%`)
    }
    return statement(`select * from notes ${clauses.length === 0 ? '' : `where ${clauses.join(' and ')}`} order by created_at desc limit ?`)
      .all(...params, filter.limit)
      .map(noteRecord)
  }

  /** The note's whole supersede chain, oldest first. */
  const noteHistory = (id: number): readonly NoteRecord[] => {
    const byId = (noteId: number): NoteRecord | undefined => {
      const row = statement('select * from notes where id = ?').get(noteId)
      return row === undefined ? undefined : noteRecord(row)
    }
    let first = byId(id)
    for (let guard = 0; first?.supersedes !== null && first !== undefined && guard < 100; guard++) first = byId(first.supersedes ?? -1) ?? first
    const chain: NoteRecord[] = []
    for (let current = first, guard = 0; current !== undefined && guard < 100; guard++) {
      chain.push(current)
      current = current.supersededBy === null ? undefined : byId(current.supersededBy)
    }
    return chain
  }

  const listThreads = (filter: { readonly project?: string | undefined; readonly limit: number }): readonly StoredThread[] =>
    statement(`select * from threads where duplicate_of is null ${filter.project === undefined ? '' : 'and project = ?'} order by updated_at desc limit ?`)
      .all(...(filter.project === undefined ? [] : [filter.project]), filter.limit)
      .map(threadRow)

  const projectPaths = (): readonly string[] =>
    statement(
      `select project from notes
         union select project from threads
         union select project from messages
         union select project from embeddings
         union select project from docs_words
         union select project from docs_ids
         order by project`,
    )
      .all()
      .map(row => String(row['project']))

  const noRowsMoved = () => ({ notes: 0, threads: 0, messages: 0, embeddings: 0, docsWords: 0, docsIds: 0 })

  const rekeyProjects = (input: { readonly mappings: readonly { readonly from: string; readonly to: string }[] }) => {
    const targetsBySource = new Map<string, string>()
    for (const mapping of input.mappings) {
      if (mapping.from === mapping.to) continue
      const existingTarget = targetsBySource.get(mapping.from)
      if (existingTarget !== undefined && existingTarget !== mapping.to) throw new Error('A project path cannot be rekeyed to multiple targets.')
      targetsBySource.set(mapping.from, mapping.to)
    }
    const mappings = [...targetsBySource].map(([from, to]) => ({ from, to }))
    if (mappings.length === 0) return { projects: 0, moved: noRowsMoved(), conflicts: [] }

    const changedProjects = new Set<string>()
    const result = transaction(() => {
      const sourcesByTarget = new Map<string, Set<string>>()
      for (const mapping of mappings) {
        const sources = sourcesByTarget.get(mapping.to) ?? new Set<string>()
        sources.add(mapping.from)
        sourcesByTarget.set(mapping.to, sources)
      }

      const conflicts: { kind: 'note' | 'thread'; target: string; collisions: number }[] = []
      for (const [target, sources] of sourcesByTarget) {
        const projects = [target, ...sources]
        const placeholders = projects.map(() => '?').join(', ')
        const noteCollisions = statement(
          `select count(*) collisions from (
               select hash from notes where valid = 1 and hash is not null and project in (${placeholders})
               group by hash having count(*) > 1)`,
        ).get(...projects)
        const noteCount = Number(noteCollisions?.['collisions'] ?? 0)
        if (noteCount > 0) conflicts.push({ kind: 'note', target, collisions: noteCount })
        const threadCollisions = statement(
          `select count(*) collisions from (
               select digest_hash from threads where duplicate_of is null and project in (${placeholders})
               group by digest_hash having count(*) > 1)`,
        ).get(...projects)
        const threadCount = Number(threadCollisions?.['collisions'] ?? 0)
        if (threadCount > 0) conflicts.push({ kind: 'thread', target, collisions: threadCount })
      }
      if (conflicts.length > 0) return { projects: 0, moved: noRowsMoved(), conflicts }

      const moved = noRowsMoved()
      let projectsMoved = 0
      for (const mapping of mappings) {
        const projectRows = {
          notes: Number(statement('update notes set project = ? where project = ?').run(mapping.to, mapping.from).changes),
          threads: Number(statement('update threads set project = ? where project = ?').run(mapping.to, mapping.from).changes),
          messages: Number(statement('update messages set project = ? where project = ?').run(mapping.to, mapping.from).changes),
          embeddings: Number(statement('update embeddings set project = ? where project = ?').run(mapping.to, mapping.from).changes),
          docsWords: Number(statement('update docs_words set project = ? where project = ?').run(mapping.to, mapping.from).changes),
          docsIds: Number(statement('update docs_ids set project = ? where project = ?').run(mapping.to, mapping.from).changes),
        }
        if (Object.values(projectRows).some(count => count > 0)) {
          projectsMoved++
          changedProjects.add(mapping.from)
          changedProjects.add(mapping.to)
          moved.notes += projectRows.notes
          moved.threads += projectRows.threads
          moved.messages += projectRows.messages
          moved.embeddings += projectRows.embeddings
          moved.docsWords += projectRows.docsWords
          moved.docsIds += projectRows.docsIds
        }
      }
      return { projects: projectsMoved, moved, conflicts }
    })

    for (const project of changedProjects) changed(project)
    return result
  }

  const rekeyProject = (input: { readonly from: string; readonly to: string }) => ({
    from: input.from,
    to: input.to,
    ...rekeyProjects({ mappings: [input] }),
  })

  const projects = (): readonly { readonly project: string; readonly threads: number; readonly notes: number }[] =>
    statement(
      `select project, sum(threads) threads, sum(notes) notes from (
           select project, count(*) threads, 0 notes from threads where duplicate_of is null group by project
           union all select project, 0, count(*) from notes where valid = 1 group by project)
         group by project order by project`,
    )
      .all()
      .map(row => ({ project: String(row['project']), threads: Number(row['threads']), notes: Number(row['notes']) }))

  /** Memory activity per UTC day, newest first: tool calls and outcomes, citations, corrections, digests and blocks. */
  const usageByDay = (days: number): readonly DailyUsage[] => {
    const since = now() - days * dayMs
    const rows = new Map<string, DailyUsage>()
    const entry = (day: string): DailyUsage => {
      const existing = rows.get(day)
      if (existing) return existing
      const created: DailyUsage = {
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
      }
      rows.set(day, created)
      return created
    }
    for (const row of statement(
      "select date(at / 1000, 'unixepoch') day, tool, count(*) calls, sum(results > 0) found, sum(results = 0) empty, sum(used) used from tool_calls where at >= ? group by day, tool",
    ).all(since)) {
      const day = entry(String(row['day']))
      const tool = String(row['tool'])
      const calls = Number(row['calls'])
      const found = Number(row['found'] ?? 0)
      const empty = Number(row['empty'] ?? 0)
      if (tool === 'memory_search') {
        day.searches += calls
        day.searchFound += found
        day.searchEmpty += empty
      } else if (tool === 'memory_read') {
        day.reads += calls
        day.readFound += found
        day.readMissing += empty
      } else {
        day.notes += calls
      }
      day.cited += Number(row['used'] ?? 0)
    }
    for (const row of statement(
      "select date(at / 1000, 'unixepoch') day, count(*) n, sum(agent_corrected) agent, sum(user_corrected) user from citations where at >= ? group by day",
    ).all(since)) {
      const day = entry(String(row['day']))
      day.citations += Number(row['n'])
      day.agentCorrected += Number(row['agent'] ?? 0)
      day.userCorrected += Number(row['user'] ?? 0)
    }
    for (const row of statement("select date(digested_at / 1000, 'unixepoch') day, count(*) n from threads where digested_at >= ? group by day").all(since)) {
      entry(String(row['day'])).digests += Number(row['n'])
    }
    for (const row of statement("select day, sum(value) n from daily where day >= date(? / 1000, 'unixepoch') and name = 'block.requests' group by day").all(
      since,
    )) {
      entry(String(row['day'])).blockRequests += Number(row['n'])
    }
    return [...rows.values()].sort((left, right) => right.day.localeCompare(left.day))
  }

  /** Stored notes by lifecycle state, for the notes header and analytics. */
  const noteStatusCounts = (project?: string | undefined): NoteStatusCounts => {
    const row = statement(
      `select sum(valid = 1) active, sum(valid = 0 and forgotten_at is null) superseded, sum(forgotten_at is not null) forgotten from notes${project === undefined ? '' : ' where project = ?'}`,
    ).get(...(project === undefined ? [] : [project]))
    return {
      active: Number(row?.['active'] ?? 0),
      superseded: Number(row?.['superseded'] ?? 0),
      forgotten: Number(row?.['forgotten'] ?? 0),
    }
  }

  /** The valid notes agents cited most, with their current text and citation counts. */
  const topNotes = (limit: number): readonly NoteRecord[] =>
    statement('select * from notes where valid = 1 and uses > 0 order by uses desc, created_at desc limit ?').all(limit).map(noteRecord)

  const usage = (): UsageCounts => ({
    tools: statement('select tool, count(*) calls, sum(results > 0) with_results, sum(used) used from tool_calls group by tool order by tool')
      .all()
      .map(row => ({
        tool: String(row['tool']),
        calls: Number(row['calls']),
        withResults: Number(row['with_results'] ?? 0),
        empty: Number(row['calls']) - Number(row['with_results'] ?? 0),
        used: Number(row['used'] ?? 0),
      })),
    counters: Object.fromEntries(
      statement('select name, value from counters')
        .all()
        .map(row => [String(row['name']), Number(row['value'])]),
    ),
    threads: Number(statement('select count(*) n from threads where duplicate_of is null').get()?.['n'] ?? 0),
    notes: Number(statement('select count(*) n from notes where valid = 1').get()?.['n'] ?? 0),
    indexedMessages: Number(statement('select count(*) n from messages').get()?.['n'] ?? 0),
  })

  /** Drops digests, indexed messages, frozen blocks and telemetry older than the retention window. Notes stay until forgotten. */
  const prune = (retentionDays: number) => {
    if (retentionDays <= 0) return { threads: 0, messages: 0 }
    const cutoff = now() - retentionDays * dayMs
    return transaction(() => {
      const old = statement('select id, project from threads where updated_at < ? and coalesce(last_used_at, 0) < ?').all(cutoff, cutoff)
      for (const row of old) {
        removeDoc('thread', String(row['id']))
        statement('delete from threads where id = ?').run(String(row['id']))
      }
      const messages = statement('select rowid from messages where at < ?').all(cutoff)
      for (const row of messages) {
        statement('delete from messages_words where rowid = ?').run(Number(row['rowid']))
        statement('delete from messages_ids where rowid = ?').run(Number(row['rowid']))
        statement("delete from embeddings where kind = 'message' and ref = ?").run(String(row['rowid']))
      }
      statement('delete from messages where at < ?').run(cutoff)
      statement('delete from thread_blocks where created_at < ?').run(cutoff)
      statement('delete from tool_calls where at < ?').run(cutoff)
      statement('delete from costs where at < ?').run(cutoff)
      statement('delete from citations where at < ?').run(cutoff)
      for (const project of new Set(old.map(row => String(row['project'])))) changed(project)
      return { threads: old.length, messages: messages.length }
    })
  }

  return {
    putThread,
    thread,
    blockThreads,
    addNote,
    note,
    updateNote,
    forgetNote,
    blockNotes,
    indexMessages,
    backfillExcerpts,
    indexedThrough,
    putEmbedding,
    missingEmbeddings,
    search,
    recordUse,
    recordCost,
    bumpDaily,
    costsByDay,
    flagCitations,
    rateCitation,
    recentCitations,
    effectiveness,
    listNotes,
    noteHistory,
    listThreads,
    projectPaths,
    rekeyProject,
    rekeyProjects,
    projects,
    usageByDay,
    noteStatusCounts,
    topNotes,
    frozenBlock,
    freezeBlock,
    recordToolCall,
    markCited,
    bump,
    usage,
    prune,
    version: (): number => version,
    onChange: (listener: (project: string) => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: (): void => {
      statements.clear()
      database.close()
    },
  }
}

export type MemoryStore = ReturnType<typeof openMemoryStore>
