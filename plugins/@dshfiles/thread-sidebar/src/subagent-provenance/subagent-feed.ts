import type { SessionEventLikeEntry, SessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'

/**
 * What the transcript's subagent preview shows of a child thread. A subagent is a conversation, not a job: it works,
 * goes idle and can be followed up, so it has its own states and never reuses the job lifecycle words.
 */
export type SubagentPreviewState = 'starting' | 'failed-to-start' | 'working' | 'finished' | 'interrupted' | 'idle'

export interface SubagentFeed {
  /** The tool the child is in now. */
  readonly tool: string | undefined
  readonly toolCalls: number
  /** The tail of the child's latest answer, as it streams and once settled. */
  readonly text: string
  /** Whether the child's latest closed turn completed; undefined until the window shows one. */
  readonly lastTurnCompleted: boolean | undefined
}

const TEXT_TAIL = 2_000
/** Text deltas arrive per token; the preview repaints at most this often. */
const FLUSH_MS = 150

const tail = (text: string): string => (text.length > TEXT_TAIL ? text.slice(-TEXT_TAIL) : text)
/** The wire fields the fold reads; each stays unknown until it is checked. */
interface WirePayload {
  readonly chunk?: unknown
  readonly content?: unknown
  readonly message?: unknown
  readonly name?: unknown
  readonly reason?: unknown
  readonly text?: unknown
  readonly type?: unknown
}

const isRecord = (value: unknown): value is WirePayload => typeof value === 'object' && value !== null

const isMessage = (value: unknown): value is { readonly content: readonly unknown[] } => isRecord(value) && Array.isArray(value.content)
const isTextPart = (value: unknown): value is { readonly type: 'text'; readonly text: string } =>
  isRecord(value) && value.type === 'text' && typeof value.text === 'string'

const messageText = (message: { readonly content: readonly unknown[] }): string | undefined => {
  const text = message.content
    .filter(isTextPart)
    .map(part => part.text)
    .join('\n')
  return text === '' ? undefined : text
}

const EMPTY: SubagentFeed = { tool: undefined, toolCalls: 0, text: '', lastTurnCompleted: undefined }

/** Wire payloads reach the client unnarrowed for this plugin's purposes, so each field is read defensively. */
const foldEntry = (feed: SubagentFeed, entry: SessionEventLikeEntry): SubagentFeed => {
  const event = entry.event
  const data: unknown = event.data
  if (!isRecord(data)) return feed
  switch (event.type) {
    case 'tool/call':
      return { ...feed, tool: typeof data.name === 'string' ? data.name : feed.tool, toolCalls: feed.toolCalls + 1 }
    case 'tool/result':
      return feed.tool === undefined ? feed : { ...feed, tool: undefined }
    case 'assistant/live-chunk': {
      const chunk = data.chunk
      if (!isRecord(chunk) || chunk.type !== 'text-delta' || typeof chunk.text !== 'string') return feed
      return { ...feed, text: tail(feed.text + chunk.text) }
    }
    case 'assistant/message': {
      const text = isMessage(data.message) ? messageText(data.message) : undefined
      return text === undefined ? feed : { ...feed, text: tail(text) }
    }
    case 'turn/start':
      return { ...feed, tool: undefined, text: '', lastTurnCompleted: undefined }
    case 'turn/end':
      return { ...feed, tool: undefined, lastTurnCompleted: data.reason === 'completed' }
    default:
      return feed
  }
}

export const SubagentFeedModel = {
  empty: EMPTY,

  /** The child session a settled delegation call started. */
  childIdOfResult(text: string | undefined): string | undefined {
    return text?.match(/^started subagent (\S+)$/)?.[1]
  },

  fold(feed: SubagentFeed, entries: readonly SessionEventLikeEntry[]): SubagentFeed {
    return entries.reduce(foldEntry, feed)
  },

  stateOf(input: {
    readonly phase: 'preparing' | 'start' | 'result'
    readonly failed: boolean
    readonly childId: string | undefined
    readonly running: boolean
    readonly lastTurnCompleted: boolean | undefined
  }): SubagentPreviewState {
    if (input.failed) return 'failed-to-start'
    if (input.childId === undefined) return 'starting'
    if (input.running) return 'working'
    if (input.lastTurnCompleted === undefined) return 'idle'
    return input.lastTurnCompleted ? 'finished' : 'interrupted'
  },
}

export interface SubagentFeedStore {
  readonly getSnapshot: () => SubagentFeed
  readonly subscribe: (listener: () => void) => () => void
  readonly dispose: () => void
}

/**
 * Folds the child's event window as it publishes and repaints on a timer: the window publishes per token, which must
 * reach neither the transcript nor, per token, this preview.
 */
export const createSubagentFeedStore = (source: SessionEventSource, flushMs: number = FLUSH_MS): SubagentFeedStore => {
  const listeners = new Set<() => void>()
  let working = SubagentFeedModel.fold(EMPTY, source.getSnapshot().entries)
  let published = working
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = (): void => {
    timer = undefined
    published = working
    for (const listener of listeners) listener()
  }
  const unsubscribe = source.subscribe(() => {
    const window = source.getSnapshot()
    const change = window.change
    if (change.kind === 'replace') working = SubagentFeedModel.fold(EMPTY, window.entries)
    if (change.kind === 'append') working = SubagentFeedModel.fold(working, change.entries)
    if (change.kind === 'settle-assistant' && change.entry !== undefined) working = SubagentFeedModel.fold(working, [change.entry])
    timer ??= setTimeout(flush, flushMs)
  })
  return {
    getSnapshot: () => published,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => {
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}
