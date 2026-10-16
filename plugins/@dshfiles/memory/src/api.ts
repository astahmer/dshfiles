import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

import type { RetrievalStatus } from './embedder.ts'
import { MemoryGuidance } from './guidance.ts'

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

export type MemoryCitation = {
  readonly id: number
  readonly at: number
  readonly thread: string
  readonly ref: string
  readonly target: string | null
  readonly rating: 'up' | 'down' | null
  readonly agentCorrected: boolean
  readonly userCorrected: boolean
}

export type MemoryNoteType = 'user' | 'feedback' | 'project' | 'reference'

export type PanelNote = {
  readonly id: number
  readonly project: string
  readonly type: MemoryNoteType
  readonly scope: string
  readonly confidence: 'stated' | 'inferred'
  readonly text: string
  readonly sourceThread: string | null
  /** Event sequence of the user message the note came from, when known. */
  readonly sourceSeq: number | null
  readonly origin: 'user-requested' | 'agent' | 'panel'
  /** When the first version of the note was written. */
  readonly createdAt: number
  /** When this version was written. */
  readonly updatedAt: number
  readonly citations: number
  readonly status: 'valid' | 'superseded' | 'forgotten'
  readonly supersedes: number | null
  readonly supersededBy: number | null
  readonly reason: string | null
}

export type PanelThread = {
  readonly id: string
  readonly project: string
  readonly title: string
  readonly decision: string
  readonly digest: string
  readonly source: 'trail' | 'model'
  /** The thread's last event. */
  readonly updatedAt: number
  readonly digestedAt: number
  readonly lastSeq: number
  readonly citations: number
}

/** Every field is sent; an empty string means "any". The API payload cannot carry `undefined`. */
export type NotesFilter = {
  readonly project: string
  readonly scope: string
  readonly type: MemoryNoteType | ''
  readonly query: string
  readonly includeInvalid: boolean
}

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
    projects: method<void, readonly { readonly project: string; readonly threads: number; readonly notes: number }[]>(),
    startBlock: method({
      input: z.object({ cwd: z.string().min(1).max(4_096) }).strict(),
      output: z.custom<{ readonly project: string; readonly text: string }>(),
      description:
        'The memory block a new thread started in this folder gets now, and the project it is filed under. Empty when memory is off or has nothing for the project.',
    }),
    notes: method<NotesFilter, readonly PanelNote[]>(),
    noteHistory: method<{ readonly id: number }, readonly PanelNote[]>(),
    editNote: method<
      {
        readonly id: number
        readonly text: string
        readonly type: MemoryNoteType
        readonly scope: string
        /** Empty: "edited in the Memory panel". */
        readonly reason: string
      },
      PanelNote
    >(),
    forgetNote: method<{ readonly id: number; readonly reason: string }, { readonly forgotten: boolean }>(),
    threads: method<{ readonly project: string }, readonly PanelThread[]>(),
    citations: method({
      output: z.custom<readonly MemoryCitation[]>(),
      description: 'The 100 most recent citations of memory (`memory: <id>` in a reply), with heuristic correction flags and ratings.',
    }),
    /** 👍/👎 on one cited memory; null clears the rating. */
    rateCitation: method<{ readonly id: number; readonly rating: 'up' | 'down' | null }, { readonly rated: boolean }>(),
  },
})
