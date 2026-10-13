import { defineApi, method } from '@dshfiles/dshx/api'

/** What the panel shows about whether memory earns its keep. Counters are local and never leave the machine. */
export type MemoryUsage = {
  readonly state: 'off' | 'ready' | 'failed'
  readonly failure: string | null
  readonly threads: number
  readonly notes: number
  readonly indexedMessages: number
  readonly blocksServed: number
  readonly citations: number
  readonly digests: { readonly trail: number; readonly model: number; readonly duplicate: number; readonly trivial: number; readonly modelFailures: number }
  readonly jev: { readonly calls: number; readonly inputTokens: number; readonly failures: number }
  readonly tools: readonly { readonly tool: string; readonly calls: number; readonly withResults: number; readonly used: number }[]
  readonly daily: readonly {
    readonly day: string
    readonly searches: number
    readonly reads: number
    readonly notes: number
    readonly cited: number
    readonly citations: number
  }[]
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
  },
})
