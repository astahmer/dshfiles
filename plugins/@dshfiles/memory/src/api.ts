import { defineApi, method } from '@dshfiles/dshx/api'

import type { RetrievalStatus } from './embedder.ts'

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

export const memoryApi = defineApi({
  id: 'dshfiles-memory',
  owner: '@dshfiles/memory',
  version: 1,
  methods: {
    usage: method<void, MemoryUsage>(),
    projects: method<void, readonly { readonly project: string; readonly threads: number; readonly notes: number }[]>(),
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
    citations: method<void, readonly MemoryCitation[]>(),
    /** 👍/👎 on one cited memory; null clears the rating. */
    rateCitation: method<{ readonly id: number; readonly rating: 'up' | 'down' | null }, { readonly rated: boolean }>(),
  },
})
