import { defineApi } from '@dshfiles/dshx/api'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import type { RetrievalStatus } from './embedder.ts'
import { MemoryGuidance } from './guidance.ts'
import { MemoryContract, MemorySchema } from './schema.ts'
import type { DailyUsage, NoteStatusCounts } from './memory-repo.ts'
import type { ThreadFinderPage, ThreadFinderRelations } from './thread-finder.ts'

/** One notable memory action, newest first, for the panel's activity list and analytics. */
export type MemoryEvent = {
  readonly at: number
  readonly kind: 'citation' | 'digest' | 'note'
  readonly project: string
  readonly detail: string
  readonly thread: string | null
  readonly threadTitle: string | null
  readonly noteId: number | null
  readonly ref: string | null
  readonly rating: 'up' | 'down' | null
  readonly agentCorrected: boolean
  readonly userCorrected: boolean
}

/** What the panel shows about whether memory earns its keep. Counters are local and never leave the machine. */
export type MemoryUsage = {
  readonly state: 'off' | 'ready' | 'failed'
  readonly failure: string | null
  /** Which ranker memory_search uses now, and why hybrid fell back to BM25 when it did. */
  readonly retrieval: RetrievalStatus
  readonly threads: number
  readonly notes: number
  readonly indexedMessages: number
  readonly blocksServed: number
  readonly citations: number
  readonly digests: { readonly trail: number; readonly model: number; readonly duplicate: number; readonly trivial: number; readonly modelFailures: number }
  readonly jev: { readonly calls: number; readonly inputTokens: number; readonly failures: number }
  /** Per memory tool: calls, calls that returned something, empty ones, and calls a reply cited (`memory: <id>`). */
  readonly tools: readonly { readonly tool: string; readonly calls: number; readonly withResults: number; readonly empty: number; readonly used: number }[]
  readonly costs: MemoryCosts
  readonly effectiveness: MemoryEffectiveness
  /** Notes by lifecycle state across every project. */
  readonly noteCounts: NoteStatusCounts
  /** Per-UTC-day activity for the analytics charts, newest first, already bounded to the requested window. */
  readonly daily: readonly DailyUsage[]
  /** The most recent citations, digests and note writes, newest first. */
  readonly events: readonly MemoryEvent[]
  /** The valid notes agents cite most in the window. */
  readonly topNotes: readonly PanelNote[]
}

/** Tokens and list-price dollars of memory's own calls. `usd` is null when the route has no known price. */
export type MemoryCostLine = {
  readonly digest: { readonly calls: number; readonly input: number; readonly cacheRead: number; readonly output: number; readonly usd: number | null }
  readonly jev: { readonly calls: number; readonly input: number; readonly usd: number }
}

export type MemoryCosts = {
  readonly days: readonly (MemoryCostLine & { readonly day: string })[]
  readonly total: MemoryCostLine
}

/** Whether the start block and cited memory hold up. The correction counts are heuristics. */
export type MemoryEffectiveness = {
  readonly block: { readonly threads: number; readonly meanBytes: number; readonly maxBytes: number; readonly requests: number }
  readonly citations: { readonly total: number; readonly agentCorrected: number; readonly userCorrected: number; readonly up: number; readonly down: number }
}

export const memoryNoteTypeSchema = Schema.Literals(['user', 'feedback', 'project', 'reference'])

const integer = Schema.Number.check(Schema.isFinite(), Schema.isInt())
const recordId = integer.check(Schema.isGreaterThan(0))
const optionalRecordId = Schema.NullOr(integer)

/** One stored note as the panel shows it. */
export const panelNoteSchema = Schema.Struct({
  id: integer,
  project: Schema.String,
  type: memoryNoteTypeSchema,
  scope: Schema.String,
  confidence: Schema.Literals(['stated', 'inferred']),
  text: Schema.String,
  sourceThread: Schema.NullOr(Schema.String),
  sourceSeq: Schema.NullOr(integer),
  origin: Schema.Literals(['user-requested', 'agent', 'panel']),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  citations: integer,
  status: Schema.Literals(['valid', 'superseded', 'forgotten', 'archived']),
  archivedAt: Schema.NullOr(Schema.Number),
  supersedes: optionalRecordId,
  supersededBy: optionalRecordId,
  reason: Schema.NullOr(Schema.String),
})

/** One digested thread — or a Session memory has not digested yet — as the panel lists it. */
export const panelThreadSchema = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  title: Schema.String,
  decision: Schema.String,
  digest: Schema.String,
  source: Schema.NullOr(Schema.Literals(['trail', 'model'])),
  updatedAt: Schema.Number,
  createdAt: Schema.Number,
  digestedAt: Schema.NullOr(Schema.Number),
  digested: Schema.Boolean,
  /** Session events at digest time; null for a thread memory has not read yet. */
  events: Schema.NullOr(integer),
  lastSeq: integer,
  citations: integer,
})

/**
 * What a citation preview holds: the stored item itself, so the card renders it instead of the model-facing text.
 * `missing` and `excerpt` carry only `summary`, which is also all a Host older than this shape sends.
 */
export const memoryPreviewSchema = Schema.Struct({
  kind: Schema.Literals(['note', 'digest', 'excerpt', 'missing']),
  id: Schema.String,
  summary: Schema.String,
  note: Schema.NullOr(panelNoteSchema),
  thread: Schema.NullOr(panelThreadSchema),
})

/** Every field is sent; an empty string means "any". */
export const notesFilterSchema = Schema.Struct({
  project: Schema.String.check(Schema.isMaxLength(4_096)),
  scope: Schema.String.check(Schema.isMaxLength(256)),
  type: Schema.Union([memoryNoteTypeSchema, Schema.Literal('')]),
  query: Schema.String.check(Schema.isMaxLength(256)),
  thread: Schema.String.check(Schema.isMaxLength(200)),
  includeInvalid: Schema.Boolean,
})

/** One recorded citation of memory, with its correction flags and rating. */
export const memoryCitationSchema = Schema.Struct({
  id: integer,
  at: Schema.Number,
  thread: Schema.String,
  threadTitle: Schema.NullOr(Schema.String),
  ref: Schema.String,
  target: Schema.NullOr(Schema.String),
  project: Schema.NullOr(Schema.String),
  rating: Schema.NullOr(Schema.Literals(['up', 'down'])),
  agentCorrected: Schema.Boolean,
  userCorrected: Schema.Boolean,
})

const citationFilterSchema = Schema.Struct({
  thread: Schema.optional(Schema.String.check(Schema.isMaxLength(200))).annotate({ description: 'Only citations made in this Session.' }),
  ref: Schema.optional(Schema.String.check(Schema.isMaxLength(200))).annotate({ description: 'Only citations of this memory id (n:<id> or t:<session id>).' }),
})

/**
 * These four outputs are built by this Host and read by the panel; like the `z.custom<T>()` they replace, they are
 * typed but not re-decoded field by field, so a Host older than the panel still answers with the fields it has.
 */
const hostOutput = <Value extends object>() => Schema.declare<Value>((value: unknown): value is Value => typeof value === 'object' && value !== null)

export type MemoryCitation = typeof memoryCitationSchema.Type

export type MemoryNoteType = typeof memoryNoteTypeSchema.Type

export type PanelNote = typeof panelNoteSchema.Type

export type PanelThread = typeof panelThreadSchema.Type

export type MemoryPreview = typeof memoryPreviewSchema.Type

/** Every field is sent; an empty string means "any". The API payload cannot carry `undefined`. */
export type NotesFilter = typeof notesFilterSchema.Type

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

const toolOutput = Schema.Struct({ summary: Schema.String })

const searchInput = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)).annotate({ description: 'A few words or an exact identifier.' }),
  project: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))).annotate({
    description: 'Restrict to one project: "current", a project path, or "all" (default: current first, then others).',
  }),
  limit: Schema.optional(integer.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20))).annotate({
    description: 'Hits to return, 1 to 20; default 6.',
  }),
})

const readInput = Schema.Struct({
  id: MemorySchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({ description: 't:<thread id> or n:<note id>.' }),
  range: Schema.optional(Schema.String.check(Schema.isMaxLength(40))).annotate({
    description: 'For a thread: "<from>-<to>" event sequence numbers (at most 60 events, 8 KB).',
  }),
})

const findThreadsInput = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)).annotate({
    description: 'A few words, an exact phrase, a thread title, a Session id, or a repository/workspace identifier.',
  }),
  project: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))).annotate({
    description: 'Restrict to one project: "current", a project path, or "all" (default: current first, then others).',
  }),
  limit: Schema.optional(integer.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20))).annotate({
    description: 'Hits to return, 1 to 20; default 8.',
  }),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(512))).annotate({
    description: 'nextCursor from an earlier call with the same query; a cursor from a changed corpus is refused.',
  }),
  availability: Schema.optional(Schema.Array(Schema.Literals(['live', 'persisted'])).check(Schema.isMaxLength(2))).annotate({
    description: 'Restrict to Sessions whose log is live in this Host, persisted on disk, or either.',
  }),
  createdFrom: Schema.optional(Schema.String.check(Schema.isMaxLength(40))).annotate({
    description: 'Earliest creation date, inclusive: YYYY-MM-DD or an ISO 8601 timestamp.',
  }),
  createdTo: Schema.optional(Schema.String.check(Schema.isMaxLength(40))).annotate({
    description: 'Latest creation date, inclusive: YYYY-MM-DD or an ISO 8601 timestamp.',
  }),
  includeNotes: Schema.optional(Schema.Boolean).annotate({ description: 'Also return matching notes as separate labeled items; default false.' }),
})

const relatedThreadsInput = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({ description: 'The Session whose relatives to list.' }),
  project: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))).annotate({
    description: 'Restrict to one project: "current", a project path, or "all" (default: current first, then others).',
  }),
  limit: Schema.optional(integer.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20))).annotate({
    description: 'Inferred candidates to return, 1 to 20; default 8. Explicit lineage is always complete.',
  }),
})

const noteInput = Schema.Struct({
  action: Schema.optional(Schema.Literals(['add', 'update', 'forget'])).annotate({ description: 'Default add.' }),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))).annotate({ description: 'The note (add, update): one or two sentences.' }),
  category: Schema.optional(memoryNoteTypeSchema).annotate({
    description:
      'user: who the user is, their role, expertise, preferences. feedback: a correction or a confirmed approach, with the why. project: a decision, constraint or context not derivable from code or git. reference: a pointer to an external resource. Default project.',
  }),
  scope: Schema.optional(Schema.String.check(Schema.isMaxLength(256))).annotate({
    description:
      'repo (default), global, path:<subpath>, or agent:<handle> for a scope only that agent’s threads read. Do not widen a one-off request into a global rule.',
  }),
  confidence: Schema.optional(Schema.Literals(['stated', 'inferred'])).annotate({
    description: 'stated: the user said it; inferred: you concluded it. Default stated.',
  }),
  id: Schema.optional(Schema.String.check(Schema.isMaxLength(40))).annotate({ description: 'Note id (n:<id>) for update and forget.' }),
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(500))).annotate({ description: 'Why the note is updated or forgotten (required for both).' }),
})

const daysInput = Schema.Struct({
  days: Schema.optional(integer.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(365))).annotate({
    description: 'Activity window in days; default 30.',
  }),
})

export const memoryApi = defineApi({
  id: 'dshfiles-memory',
  owner: '@dshfiles/memory',
  version: 1,
  methods: {
    usage: MemoryContract.method({
      input: daysInput,
      output: hostOutput<MemoryUsage>(),
      description:
        "Memory's state and whether it earns its keep: stored digests, notes and indexed messages; its own digest and Jev cost per day; start-block size and the requests that carried it; memory tool calls, hits and citations; heuristic correction counts and ratings; per-day activity, recent events and the most-cited notes.",
    }),
    usageSummary: MemoryContract.method({
      input: daysInput,
      output: toolOutput,
      description:
        "Whether memory is earning its keep, as counters rather than charts: store size, start blocks served, citations, digests by source, per-tool calls with empty and cited counts, citation ratings and corrections, and memory's own list-price cost over the window. Read-only; use it to judge retrieval rather than to read stored content.",
      tool: { name: 'memory_usage', readOnly: true, render: output => output.summary },
    }),
    search: MemoryContract.method({
      input: searchInput,
      output: toolOutput,
      description: MemoryGuidance.searchDescription,
      tool: { name: 'memory_search', readOnly: true, render: output => output.summary },
    }),
    findThreads: MemoryContract.method({
      input: findThreadsInput,
      output: hostOutput<ThreadFinderPage & { readonly project: string }>(),
      description: MemoryGuidance.findThreadsDescription,
      tool: { name: 'find_threads', readOnly: true, render: output => MemoryGuidance.renderFinderPage(output) },
    }),
    relatedThreads: MemoryContract.method({
      input: relatedThreadsInput,
      output: hostOutput<ThreadFinderRelations & { readonly project: string }>(),
      description: MemoryGuidance.relatedThreadsDescription,
      tool: { name: 'related_threads', readOnly: true, render: output => MemoryGuidance.renderRelations(output) },
    }),
    read: MemoryContract.method({
      input: readInput,
      output: toolOutput,
      description: MemoryGuidance.readDescription,
      tool: { name: 'memory_read', readOnly: true, render: output => output.summary },
    }),
    preview: MemoryContract.method({
      input: readInput,
      output: memoryPreviewSchema,
      description: 'Read one digest, note or bounded thread excerpt for a UI preview without counting it as an agent memory-tool call.',
    }),
    note: MemoryContract.method({
      input: noteInput,
      output: toolOutput,
      description: MemoryGuidance.noteDescription,
      tool: { name: 'memory_note', render: output => output.summary },
    }),
    projects: MemoryContract.method({
      input: Schema.Void,
      output: Schema.Array(Schema.Struct({ project: Schema.String, threads: integer, notes: integer })),
      description: 'Every project memory is filed under, with how many thread digests and notes it holds. Read-only.',
      tool: { name: 'memory_projects', readOnly: true, render: compactJson },
    }),
    startBlock: MemoryContract.method({
      input: Schema.Struct({
        cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096)),
        scope: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
      }),
      output: Schema.Struct({ project: Schema.String, text: Schema.String }),
      description:
        'The memory block a new thread started in this folder gets now, and the project it is filed under. Empty when memory is off or has nothing for the project. Read-only.',
      tool: {
        name: 'memory_start_block',
        readOnly: true,
        render: output =>
          output.text.length === 0
            ? `No memory block for ${output.project}.`
            : `${output.project}:
${output.text}`,
      },
    }),
    notes: MemoryContract.method({
      input: notesFilterSchema,
      output: Schema.Array(panelNoteSchema),
      description:
        'Browse active notes by project, scope, type, text and source thread, optionally including superseded and forgotten ones. Archived memories are excluded. Read-only; every filter field is required, and an empty string means any.',
      tool: { name: 'memory_notes', readOnly: true, render: compactJson },
    }),
    panelNotes: MemoryContract.method({
      input: notesFilterSchema,
      output: Schema.Array(panelNoteSchema),
      description: 'Browse notes in the Memory panel, including archived notes for debugging.',
    }),
    reviewNotes: MemoryContract.method({
      input: Schema.Struct({
        project: Schema.String.check(Schema.isMaxLength(4_096)),
        afterId: Schema.optional(recordId),
        limit: integer.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(50)).pipe(Schema.withDecodingDefaultKey(Effect.succeed(25))),
      }),
      output: Schema.Struct({
        results: Schema.Array(
          Schema.Struct({
            id: integer,
            text: Schema.String,
            probability: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))),
            candidate: Schema.Boolean,
          }),
        ),
        nextAfterId: Schema.NullOr(recordId),
      }),
      description:
        'Ask Jev whether each active saved note still looks durable. Sends each note text to TypeSafe; Jev is opt-in in Memory settings, failures remain unknown, and results are suggestions only. Call only when the user asked to review memories; this does not archive notes.',
      tool: { name: 'memory_review_notes', readOnly: true, render: compactJson },
    }),
    noteCounts: MemoryContract.method({
      input: Schema.Struct({ project: Schema.String.check(Schema.isMaxLength(4_096)) }),
      output: hostOutput<NoteStatusCounts>(),
      description: 'How many notes are active, superseded or forgotten, for one project or every project (empty string). Read-only.',
      tool: { name: 'memory_note_counts', readOnly: true, render: compactJson },
    }),
    createNote: MemoryContract.method({
      input: Schema.Struct({
        project: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096)),
        text: MemorySchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
        type: memoryNoteTypeSchema,
        scope: MemorySchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
        confidence: Schema.Literals(['stated', 'inferred']),
      }),
      output: panelNoteSchema,
      description: 'Write a note from the Memory panel. It is filed under the project as a panel-authored note; duplicates return the existing note.',
    }),
    noteHistory: MemoryContract.method({
      input: Schema.Struct({ id: integer }),
      output: Schema.Array(panelNoteSchema),
      description: 'Every active or superseded version of one note, oldest first. Archived notes are excluded. Read-only.',
      tool: { name: 'memory_note_history', readOnly: true, render: compactJson },
    }),
    panelNoteHistory: MemoryContract.method({
      input: Schema.Struct({ id: integer }),
      output: Schema.Array(panelNoteSchema),
      description: 'Every version of one note, oldest first, including archived notes for debugging in the Memory panel.',
    }),
    editNote: MemoryContract.method({
      input: Schema.Struct({
        id: integer,
        text: MemorySchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
        type: memoryNoteTypeSchema,
        scope: MemorySchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
        reason: MemorySchema.trimmedString.check(Schema.isMaxLength(500)).annotate({ description: 'Empty: "edited in the Memory panel".' }),
      }),
      output: panelNoteSchema,
      description:
        'Replace one note with a new version, keeping its history. Give the reason for the change. Call only when the user asked to correct that note.',
      tool: { name: 'memory_edit_note', render: compactJson },
    }),
    forgetNote: MemoryContract.method({
      input: Schema.Struct({ id: integer, reason: MemorySchema.trimmedString.check(Schema.isMaxLength(500)) }),
      output: Schema.Struct({ forgotten: Schema.Boolean }),
      description: 'Forget one note, keeping it in the history as forgotten, with the reason recorded. Call only when the user asked to forget that note.',
      tool: { name: 'memory_forget_note', render: compactJson },
    }),
    archiveNote: MemoryContract.method({
      input: Schema.Struct({ id: recordId }),
      output: Schema.Struct({ archived: Schema.Boolean }),
      description:
        'Archive one note without deleting it. It remains visible in the Memory panel but is excluded from memory tools. Call only when the user asked to archive that note.',
      tool: { name: 'memory_archive_note', render: compactJson },
    }),
    restoreNote: MemoryContract.method({
      input: Schema.Struct({ id: recordId }),
      output: Schema.Struct({ restored: Schema.Boolean }),
      description: 'Restore one archived note to memory retrieval. Call only when the user asked to restore it.',
      tool: { name: 'memory_restore_note', render: compactJson },
    }),
    threads: MemoryContract.method({
      input: Schema.Struct({
        project: Schema.String.check(Schema.isMaxLength(4_096)),
        includeUndigested: Schema.optional(Schema.Boolean).annotate({ description: 'Also list Sessions memory has not digested yet; default false.' }),
      }),
      output: Schema.Array(panelThreadSchema),
      description:
        'Thread digests filed under one project, with their decisions, source and citation counts, optionally with Sessions that have no digest yet. Read-only.',
      tool: { name: 'memory_threads', readOnly: true, render: compactJson },
    }),
    threadDetail: MemoryContract.method({
      input: Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)) }),
      output: Schema.Struct({ messages: integer, createdAt: Schema.Number, updatedAt: Schema.Number }),
      description: "One thread digest's message count and timestamps, read from its Session log. Read-only.",
      tool: { name: 'memory_thread_detail', readOnly: true, render: compactJson },
    }),
    redigest: MemoryContract.method({
      input: Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)) }),
      output: Schema.Struct({ outcome: Schema.String }),
      description: 'Write or refresh one thread digest from its Session log now. Call only when the user asked for that thread.',
    }),
    citations: MemoryContract.method({
      input: citationFilterSchema,
      output: Schema.Array(memoryCitationSchema),
      description:
        'The 100 most recent citations of memory (`memory: <id>` in a reply), optionally for one thread or one memory id, with heuristic correction flags and ratings. Read-only.',
      tool: { name: 'memory_citations', readOnly: true, render: compactJson },
    }),
    /** 👍/👎 on one cited memory; null clears the rating. */
    rateCitation: MemoryContract.method({
      input: Schema.Struct({ id: recordId, rating: Schema.NullOr(Schema.Literals(['up', 'down'])) }),
      output: Schema.Struct({ rated: Schema.Boolean }),
    }),
  },
})
