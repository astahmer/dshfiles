import type { SessionEventLikeEntry, SessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'

/**
 * What the transcript's subagent preview shows of a child thread. A subagent is a conversation, not a job: it works,
 * goes idle and can be followed up, so it has its own states and never reuses the job lifecycle words.
 */
export type SubagentPreviewState = 'starting' | 'failed-to-start' | 'working' | 'finished' | 'failed' | 'interrupted'

/**
 * How a child's latest closed turn ended (round 21 D4): it completed, it failed (an error or the output-token limit), or
 * it stopped (the user or its parent stopped it, a gate refused it, a crash cut it off). Every subagent surface words
 * it the same way: Done, Failed, Stopped.
 */
export type SubagentTerminal = 'completed' | 'failed' | 'stopped'

export interface SubagentFeed {
  /** The tool the child is in now. */
  readonly tool: string | undefined
  readonly toolCalls: number
  /** The tail of the child's latest answer, as it streams and once settled. */
  readonly text: string
  /** How the child's latest closed turn ended; undefined until the window shows one, and while a turn is open. */
  readonly lastTurnEnd: SubagentTerminal | undefined
}

const TEXT_TAIL = 2_000
/** Text deltas arrive per token; the preview repaints at most this often. */
const FLUSH_MS = 150

const tail = (text: string): string => (text.length > TEXT_TAIL ? text.slice(-TEXT_TAIL) : text)
/** The wire fields the fold reads; each stays unknown until it is checked. */
interface WirePayload {
  readonly chunk?: unknown
  readonly content?: unknown
  readonly kind?: unknown
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

const EMPTY: SubagentFeed = { tool: undefined, toolCalls: 0, text: '', lastTurnEnd: undefined }

/** `turn/end` reasons (DSH's `TurnEndReasonMap`) that are a failure rather than a stop. */
const FAILED_TURN_END_KINDS: ReadonlySet<string> = new Set(['error', 'max-tokens'])

/**
 * A `turn/end` reason as a terminal state. DSH writes `{ kind: 'completed' | 'error' | 'aborted' | … }`; reading the
 * reason as a bare string made every real turn end look stopped.
 */
const terminalOfTurnEnd = (reason: unknown): SubagentTerminal => {
  const kind = isRecord(reason) ? reason.kind : reason
  if (kind === 'completed') return 'completed'
  return typeof kind === 'string' && FAILED_TURN_END_KINDS.has(kind) ? 'failed' : 'stopped'
}

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
      return { ...feed, tool: undefined, text: '', lastTurnEnd: undefined }
    case 'turn/end':
      return { ...feed, tool: undefined, lastTurnEnd: terminalOfTurnEnd(data.reason) }
    default:
      return feed
  }
}

export const SubagentFeedModel = {
  empty: EMPTY,

  /** The name a settled delegation call gives its child: core answers `started subagent agent-1`, the child's handle. */
  childNameOfResult(text: string | undefined): string | undefined {
    return text?.match(/^started subagent (\S+)$/)?.[1]
  },

  /**
   * The child session behind that name, from the parent's catalog. The result names the handle, not the session, so
   * reading it as a session id found no status and the row said Idle while the child worked. An older result that
   * named the session itself still resolves.
   */
  childOf(catalog: readonly { readonly id: string; readonly name?: string }[] | undefined, name: string | undefined): string | undefined {
    if (name === undefined) return undefined
    return catalog?.find(entry => entry.name === name || entry.id === name)?.id ?? name
  },

  fold(feed: SubagentFeed, entries: readonly SessionEventLikeEntry[]): SubagentFeed {
    return entries.reduce(foldEntry, feed)
  },

  terminalOfTurnEnd,

  /**
   * A child's terminal state from what every list surface holds without opening the child (round 21 D4): the Host's
   * failed-turn record (`useFailedTurns`, kept until a later turn ends without failing) and the native `subagentTiming`
   * projection's `lastTurnCompleted`. A running child has none.
   */
  terminalOf(input: { readonly running: boolean; readonly failedTurn: boolean; readonly lastTurnCompleted: boolean | undefined }): SubagentTerminal | undefined {
    if (input.running) return undefined
    if (input.failedTurn) return 'failed'
    if (input.lastTurnCompleted === undefined) return undefined
    return input.lastTurnCompleted ? 'completed' : 'stopped'
  },

  stateOf(input: {
    readonly phase: 'preparing' | 'start' | 'result'
    readonly failed: boolean
    readonly childId: string | undefined
    readonly running: boolean
    readonly terminal: SubagentTerminal | undefined
  }): SubagentPreviewState | undefined {
    if (input.failed) return 'failed-to-start'
    if (input.childId === undefined) return 'starting'
    if (input.running) return 'working'
    // Neither a status nor a closed turn is known yet: say nothing rather than "Idle", which a child never is.
    if (input.terminal === undefined) return undefined
    return input.terminal === 'completed' ? 'finished' : input.terminal === 'failed' ? 'failed' : 'interrupted'
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
