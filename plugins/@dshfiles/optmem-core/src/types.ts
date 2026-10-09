export type EventRole = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'note'

export type EventMeta = Readonly<Record<string, string | number | boolean | null>>

export type StreamId = `conversation:${string}` | `project:${string}` | 'global'

export type MemoryEventInput = {
  readonly eventKey: string
  readonly harness: string
  readonly conversationId: string
  readonly projectId?: string | null | undefined
  readonly parentConversationId?: string | null | undefined
  readonly role: EventRole
  readonly createdAt: number
  readonly text: string
  readonly toolName?: string | undefined
  /** Global memory is opt-in per event; nothing is promoted automatically. */
  readonly global?: boolean | undefined
  readonly meta?: EventMeta | undefined
}

export type NormalizedEvent = {
  readonly eventKey: string
  readonly harness: string
  readonly conversationId: string
  readonly projectId: string | null
  readonly parentConversationId: string | null
  readonly role: EventRole
  readonly createdAt: number
  readonly text: string
  readonly bytes: number
  readonly truncated: boolean
  readonly meta: EventMeta
  readonly streams: readonly StreamId[]
}

export type MemoryEvent = Omit<NormalizedEvent, 'streams'> & { readonly id: number }

export type StreamEntry = { readonly stream: StreamId; readonly pos: number }

export type AppendedEvent = {
  readonly eventId: number
  readonly eventKey: string
  readonly inserted: boolean
  readonly entries: readonly StreamEntry[]
}

export type StreamEvent = { readonly pos: number; readonly event: MemoryEvent }

export type NodeAddress = { readonly level: number; readonly idx: number }

export type MemoryNode = {
  readonly stream: StreamId
  readonly address: NodeAddress
  readonly text: string
  readonly bytes: number
  readonly eventId: number | null
  /** `verbatim`, `concat`, `clipped:<model>` or the summarizer model. */
  readonly model: string
  readonly createdAt: number
}

/** `main` is the full-size view; `compact` is a smaller view over the same tree for bounded injection. */
export type ViewKind = 'main' | 'compact'

export type ViewState = {
  readonly stream: StreamId
  readonly kind: ViewKind
  readonly throughPos: number
  readonly nodes: readonly NodeAddress[]
  /** Persisted byte-for-byte; one `<start>+<len>| <text>\n` line per node. */
  readonly rendered: string
  readonly bytes: number
  readonly version: number
  /** A batch stopped above the lower bound because parents were missing; keep merging as they arrive. */
  readonly mergePending: boolean
}

export type Snapshot = {
  readonly stream: StreamId
  readonly length: number
  readonly viewVersion: number
  readonly viewThroughPos: number
  readonly view: string
  /** Lines for positions past the view: built leaves, or raw clipped text tagged `[pending summary]`. */
  readonly pending: string
  readonly text: string
  readonly bytes: number
  readonly pendingCount: number
  readonly barrierTimedOut: boolean
}

export type CursorName = 'leaf' | 'fts'

export type StreamSummary = { readonly stream: StreamId; readonly length: number }

export type StoreSnapshot = { readonly view: ViewState | undefined; readonly length: number }

export interface MemoryStore {
  appendEvents(events: readonly NormalizedEvent[]): Promise<readonly AppendedEvent[]>
  readStream(stream: StreamId, fromPos: number, toPos: number): Promise<readonly StreamEvent[]>
  findEntries(eventId: number): Promise<readonly StreamEntry[]>
  streamLength(stream: StreamId): Promise<number>
  listStreams(): Promise<readonly StreamSummary[]>
  /** `undefined` when the conversation has no events, `null` when it has no project. */
  conversationProject(conversationId: string): Promise<string | null | undefined>
  getNodes(stream: StreamId, addresses: readonly NodeAddress[]): Promise<readonly MemoryNode[]>
  listNodes(stream: StreamId, level: number, fromIdx: number, toIdx: number): Promise<readonly MemoryNode[]>
  /** First write wins; returns whether this call inserted the node. */
  saveNode(node: MemoryNode): Promise<boolean>
  findLeafByEvent(eventId: number): Promise<MemoryNode | undefined>
  listMissingLeaves(stream: StreamId, fromPos: number): Promise<readonly number[]>
  listBuildableParents(stream: StreamId): Promise<readonly NodeAddress[]>
  getView(stream: StreamId, kind?: ViewKind): Promise<ViewState | undefined>
  /** Optimistic: writes only when the stored version equals `expectedVersion`; a `main` view also moves the `leaf` cursor. */
  commitView(view: ViewState, expectedVersion: number): Promise<boolean>
  /** Reads the `main` view and the stream length in one read transaction. */
  readSnapshot(stream: StreamId): Promise<StoreSnapshot>
  /** Conversation id of every position in [fromPos, toPos), in order. */
  streamConversations(stream: StreamId, fromPos: number, toPos: number): Promise<readonly string[]>
  /**
   * Appends every entry of `from` to the end of `to` in stream order, retags those events with `projectId`, then
   * deletes `from` with its nodes, views and cursors. Returns the new entries of `to`.
   */
  moveStream(request: { readonly from: StreamId; readonly to: StreamId; readonly projectId: string }): Promise<readonly StreamEntry[]>
}

export type SummaryRequest = {
  readonly kind: 'leaf' | 'merge'
  readonly stream: StreamId
  readonly address: string
  readonly maxBytes: number
  /** Leaf: one `role: text`; merge: the two child texts, oldest first. Untrusted data. */
  readonly input: readonly string[]
  readonly attempt: number
  readonly previousBytes: number | null
}

export interface Summarizer {
  readonly model: string
  summarize(request: SummaryRequest): Promise<string>
}

export type StoredSearchHit = {
  readonly eventId: number
  readonly conversationId: string
  readonly projectId: string | null
  readonly role: EventRole
  readonly createdAt: number
  readonly snippet: string
  readonly entries: readonly StreamEntry[]
}

export type SearchQuery = { readonly query: string; readonly stream: StreamId | null; readonly limit: number }

export interface MemorySearch {
  indexPending(request: { readonly limit: number }): Promise<{ readonly indexed: number; readonly cursor: number }>
  search(request: SearchQuery): Promise<readonly StoredSearchHit[]>
  status(): Promise<{ readonly cursor: number; readonly lag: number }>
}

export type Clock = { now(): number }

export type MemoryLogger = { warn(message: string, fields: Readonly<Record<string, string | number | boolean>>): void }

export type MemoryConfig = {
  readonly maxNodeBytes: number
  readonly viewUpperBytes: number
  readonly viewLowerBytes: number
  readonly concurrency: number
  readonly summaryRetries: number
  readonly barrierMs: number
  readonly toolResultMaxBytes: number
  readonly eventMaxBytes: number
  readonly compactUpperBytes: number
  readonly compactLowerBytes: number
  /** Bytes of pending-tail lines a snapshot renders before collapsing the older ones into one marker line. */
  readonly pendingTailBytes: number
  readonly summaryTimeoutMs: number
  readonly retryBaseMs: number
  readonly retryMaxMs: number
  readonly zoomPageBytes: number
  readonly contextEventBytes: number
  readonly redactLiterals: readonly string[]
  readonly excludeTools: readonly string[]
}

export type MemoryScope = 'conversation' | 'project' | 'global' | 'all-projects'

export type MemoryAccess = {
  readonly conversationId: string
  readonly projectId: string | null
  readonly allowAllProjects: boolean
}
