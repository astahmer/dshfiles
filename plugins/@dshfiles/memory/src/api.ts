import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

import type { RetrievalStatus } from './embedder.ts'
import { MemoryGuidance } from './guidance.ts'
import type { ThreadFinderPage, ThreadFinderRelations } from './thread-finder.ts'

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
  readonly daily: readonly {
    readonly day: string
    readonly searches: number
    readonly reads: number
    readonly notes: number
    readonly cited: number
    readonly citations: number
  }[]
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

export type MemoryCitation = z.infer<typeof memoryCitationSchema>

export type MemoryNoteType = z.infer<typeof memoryNoteTypeSchema>

export type PanelNote = z.infer<typeof panelNoteSchema>

export type PanelThread = z.infer<typeof panelThreadSchema>

/** Every field is sent; an empty string means "any". The API payload cannot carry `undefined`. */
export type NotesFilter = z.infer<typeof notesFilterSchema>

export const memoryNoteTypeSchema = z.enum(['user', 'feedback', 'project', 'reference'])

/** One stored note as the panel shows it. */
export const panelNoteSchema = z.object({
  id: z.number().int(),
  project: z.string(),
  type: memoryNoteTypeSchema,
  scope: z.string(),
  confidence: z.enum(['stated', 'inferred']),
  text: z.string(),
  sourceThread: z.string().nullable(),
  sourceSeq: z.number().int().nullable(),
  origin: z.enum(['user-requested', 'agent', 'panel']),
  createdAt: z.number(),
  updatedAt: z.number(),
  citations: z.number().int(),
  status: z.enum(['valid', 'superseded', 'forgotten']),
  supersedes: z.number().int().nullable(),
  supersededBy: z.number().int().nullable(),
  reason: z.string().nullable(),
})

/** One digested thread as the panel lists it. */
export const panelThreadSchema = z.object({
  id: z.string(),
  project: z.string(),
  title: z.string(),
  decision: z.string(),
  digest: z.string(),
  source: z.enum(['trail', 'model']),
  updatedAt: z.number(),
  digestedAt: z.number(),
  lastSeq: z.number().int(),
  citations: z.number().int(),
})

/** Every field is sent; an empty string means "any". */
export const notesFilterSchema = z
  .object({
    project: z.string(),
    scope: z.string(),
    type: memoryNoteTypeSchema.or(z.literal('')),
    query: z.string(),
    includeInvalid: z.boolean(),
  })
  .strict()

/** One recorded citation of memory, with its correction flags and rating. */
export const memoryCitationSchema = z.object({
  id: z.number().int(),
  at: z.number(),
  thread: z.string(),
  ref: z.string(),
  target: z.string().nullable(),
  rating: z.enum(['up', 'down']).nullable(),
  agentCorrected: z.boolean(),
  userCorrected: z.boolean(),
})

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

const toolOutput = z.object({ summary: z.string() }).strict()

const searchInput = z
  .object({
    query: z.string().min(1).max(512).describe('A few words or an exact identifier.'),
    project: z.string().max(4_096).optional().describe('Restrict to one project: "current", a project path, or "all" (default: current first, then others).'),
    limit: z.number().int().min(1).max(20).optional().describe('Hits to return, 1 to 20; default 6.'),
  })
  .strict()

const readInput = z
  .object({
    id: z.string().min(1).max(200).describe('t:<thread id> or n:<note id>.'),
    range: z.string().max(40).optional().describe('For a thread: "<from>-<to>" event sequence numbers (at most 60 events, 8 KB).'),
  })
  .strict()

const findThreadsInput = z
  .object({
    query: z.string().min(1).max(512).describe('A few words, an exact phrase, a thread title, a Session id, or a repository/workspace identifier.'),
    project: z.string().max(4_096).optional().describe('Restrict to one project: "current", a project path, or "all" (default: current first, then others).'),
    limit: z.number().int().min(1).max(20).optional().describe('Hits to return, 1 to 20; default 8.'),
    cursor: z.string().max(512).optional().describe('nextCursor from an earlier call with the same query; a cursor from a changed corpus is refused.'),
    availability: z
      .array(z.enum(['live', 'persisted']))
      .max(2)
      .optional()
      .describe('Restrict to Sessions whose log is live in this Host, persisted on disk, or either.'),
    createdFrom: z.string().max(40).optional().describe('Earliest creation date, inclusive: YYYY-MM-DD or an ISO 8601 timestamp.'),
    createdTo: z.string().max(40).optional().describe('Latest creation date, inclusive: YYYY-MM-DD or an ISO 8601 timestamp.'),
    includeNotes: z.boolean().optional().describe('Also return matching notes as separate labeled items; default false.'),
  })
  .strict()

const relatedThreadsInput = z
  .object({
    sessionId: z.string().min(1).max(200).describe('The Session whose relatives to list.'),
    project: z.string().max(4_096).optional().describe('Restrict to one project: "current", a project path, or "all" (default: current first, then others).'),
    limit: z.number().int().min(1).max(20).optional().describe('Inferred candidates to return, 1 to 20; default 8. Explicit lineage is always complete.'),
  })
  .strict()

const noteInput = z
  .object({
    action: z.enum(['add', 'update', 'forget']).optional().describe('Default add.'),
    text: z.string().max(2_000).optional().describe('The note (add, update): one or two sentences.'),
    category: z
      .enum(['user', 'feedback', 'project', 'reference'])
      .optional()
      .describe(
        'user: who the user is, their role, expertise, preferences. feedback: a correction or a confirmed approach, with the why. project: a decision, constraint or context not derivable from code or git. reference: a pointer to an external resource. Default project.',
      ),
    scope: z.string().max(256).optional().describe('repo (default), global, or path:<subpath>. Do not widen a one-off request into a global rule.'),
    confidence: z.enum(['stated', 'inferred']).optional().describe('stated: the user said it; inferred: you concluded it. Default stated.'),
    id: z.string().max(40).optional().describe('Note id (n:<id>) for update and forget.'),
    reason: z.string().max(500).optional().describe('Why the note is updated or forgotten (required for both).'),
  })
  .strict()

export const memoryApi = defineApi({
  id: 'dshfiles-memory',
  owner: '@dshfiles/memory',
  version: 1,
  methods: {
    usage: method({
      output: z.custom<MemoryUsage>(),
      description:
        "Memory's state and whether it earns its keep: stored digests, notes and indexed messages; its own digest and Jev cost per day; start-block size and the requests that carried it; memory tool calls, hits and citations; heuristic correction counts and ratings.",
    }),
    search: method({
      input: searchInput,
      output: toolOutput,
      description: MemoryGuidance.searchDescription,
      tool: { name: 'memory_search', readOnly: true, render: output => output.summary },
    }),
    findThreads: method({
      input: findThreadsInput,
      output: z.custom<ThreadFinderPage & { readonly project: string }>(),
      description: MemoryGuidance.findThreadsDescription,
      tool: { name: 'find_threads', readOnly: true, render: output => MemoryGuidance.renderFinderPage(output) },
    }),
    relatedThreads: method({
      input: relatedThreadsInput,
      output: z.custom<ThreadFinderRelations & { readonly project: string }>(),
      description: MemoryGuidance.relatedThreadsDescription,
      tool: { name: 'related_threads', readOnly: true, render: output => MemoryGuidance.renderRelations(output) },
    }),
    read: method({
      input: readInput,
      output: toolOutput,
      description: MemoryGuidance.readDescription,
      tool: { name: 'memory_read', readOnly: true, render: output => output.summary },
    }),
    preview: method({
      input: readInput,
      output: toolOutput,
      description: 'Read one digest, note or bounded thread excerpt for a UI preview without counting it as an agent memory-tool call.',
    }),
    note: method({
      input: noteInput,
      output: toolOutput,
      description: MemoryGuidance.noteDescription,
      tool: { name: 'memory_note', render: output => output.summary },
    }),
    projects: method({
      input: z.void(),
      output: z.array(z.object({ project: z.string(), threads: z.number().int(), notes: z.number().int() })),
      description: 'Every project memory is filed under, with how many thread digests and notes it holds. Read-only.',
      tool: { name: 'memory_projects', readOnly: true, render: compactJson },
    }),
    startBlock: method({
      input: z.object({ cwd: z.string().min(1).max(4_096) }).strict(),
      output: z.object({ project: z.string(), text: z.string() }),
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
    notes: method({
      input: notesFilterSchema,
      output: z.array(panelNoteSchema),
      description:
        'Browse stored notes by project, scope, type and text, optionally including superseded and forgotten ones. Read-only; every filter field is required, and an empty string means any.',
      tool: { name: 'memory_notes', readOnly: true, render: compactJson },
    }),
    noteHistory: method({
      input: z.object({ id: z.number().int() }).strict(),
      output: z.array(panelNoteSchema),
      description: 'Every version of one note, oldest first, so a superseded or forgotten note can be traced. Read-only.',
      tool: { name: 'memory_note_history', readOnly: true, render: compactJson },
    }),
    editNote: method({
      input: z
        .object({
          id: z.number().int(),
          text: z.string(),
          type: memoryNoteTypeSchema,
          scope: z.string(),
          reason: z.string().describe('Empty: "edited in the Memory panel".'),
        })
        .strict(),
      output: panelNoteSchema,
      description:
        'Replace one note with a new version, keeping its history. Give the reason for the change. Call only when the user asked to correct that note.',
      tool: { name: 'memory_edit_note', render: compactJson },
    }),
    forgetNote: method({
      input: z.object({ id: z.number().int(), reason: z.string() }).strict(),
      output: z.object({ forgotten: z.boolean() }),
      description: 'Forget one note, keeping it in the history as forgotten, with the reason recorded. Call only when the user asked to forget that note.',
      tool: { name: 'memory_forget_note', render: compactJson },
    }),
    threads: method({
      input: z.object({ project: z.string() }).strict(),
      output: z.array(panelThreadSchema),
      description: 'Thread digests filed under one project, with their decisions, source and citation counts. Read-only.',
      tool: { name: 'memory_threads', readOnly: true, render: compactJson },
    }),
    citations: method({
      input: z.void(),
      output: z.array(memoryCitationSchema),
      description: 'The 100 most recent citations of memory (`memory: <id>` in a reply), with heuristic correction flags and ratings. Read-only.',
      tool: { name: 'memory_citations', readOnly: true, render: compactJson },
    }),
    /** 👍/👎 on one cited memory; null clears the rating. */
    rateCitation: method<{ readonly id: number; readonly rating: 'up' | 'down' | null }, { readonly rated: boolean }>(),
  },
})
