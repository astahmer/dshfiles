import { Duration, Effect, Option, Queue, Schema, Stream } from 'effect'
import { EVENT_REFRESH_MIN_AGE_MS, type PullRequestMonitor } from './monitor.js'

/** A shell command that publishes commits or opens/changes a pull request: its result is worth a prompt refresh. */
const PUBLISHING_COMMAND = /\b(?:jj\s+git\s+push|git\s+push|gh\s+pr\s+(?:create|merge|ready|close|reopen)|glab\s+mr\s+(?:create|merge|close|reopen))\b/u

/** Tool calls awaiting their result; bounded so a thread that never answers one cannot grow it. */
const MAX_PENDING_CALLS = 256

/** How the event path runs, read again for every burst so a settings change applies to the next one. */
export interface EventRefreshConfig {
  readonly enabled: boolean
  /** Thread events gathered into one refresh: a push and the turn end right after it cost one pass. */
  readonly debounce: Duration.Input
}

const DEFAULT_EVENT_REFRESH: EventRefreshConfig = { enabled: true, debounce: Duration.seconds(3) }

/** The fallback sweep: events cover pushes and turn ends, so a pull request changed outside DSH is caught within this. */
const DEFAULT_SWEEP_INTERVAL = Duration.minutes(10)

const toolCallSchema = Schema.Struct({
  type: Schema.Literal('tool/call'),
  data: Schema.Struct({ callId: Schema.String, arguments: Schema.String }),
})
const toolResultSchema = Schema.Struct({
  type: Schema.Literal('tool/result'),
  data: Schema.Struct({ message: Schema.Struct({ toolCallId: Schema.String }) }),
})
const turnEndSchema = Schema.Struct({
  type: Schema.Literal('turn/end'),
  data: Schema.Struct({ reason: Schema.Struct({ kind: Schema.String, reason: Schema.optional(Schema.Struct({ kind: Schema.String })) }) }),
})
const decodeToolCall = Schema.decodeUnknownOption(toolCallSchema)
const decodeToolResult = Schema.decodeUnknownOption(toolResultSchema)
const decodeTurnEnd = Schema.decodeUnknownOption(turnEndSchema)

/** The only Session events a trigger reads; the Host listener drops every other event before it queues. */
export const TRIGGER_EVENT_TYPES: ReadonlySet<string> = new Set(['tool/call', 'tool/result', 'turn/end'])

export interface ThreadEvent {
  readonly sessionId: string
  readonly event: { readonly type: string }
}

/**
 * Which thread a Session event asks to refresh: one whose publishing command (a `jj git push`, `git push`, `gh pr …`)
 * just returned, or whose turn just ended. Everything else — and a turn the Host's own shutdown disposed — is null.
 */
const makeRefreshTriggers = () => {
  const publishingCalls = new Map<string, string>()
  return (input: ThreadEvent): string | null => {
    const call = decodeToolCall(input.event)
    if (Option.isSome(call)) {
      if (!PUBLISHING_COMMAND.test(call.value.data.arguments)) return null
      if (publishingCalls.size >= MAX_PENDING_CALLS) publishingCalls.delete(publishingCalls.keys().next().value ?? '')
      publishingCalls.set(call.value.data.callId, input.sessionId)
      return null
    }
    const result = decodeToolResult(input.event)
    if (Option.isSome(result)) {
      const sessionId = publishingCalls.get(result.value.data.message.toolCallId)
      if (sessionId === undefined) return null
      publishingCalls.delete(result.value.data.message.toolCallId)
      return sessionId
    }
    const ended = decodeTurnEnd(input.event)
    if (Option.isNone(ended)) return null
    const reason = ended.value.data.reason
    return reason.kind === 'aborted' && reason.reason?.kind === 'disposed' ? null : input.sessionId
  }
}

type Monitor = Pick<PullRequestMonitor['Service'], 'refresh' | 'pollAll'>

/**
 * Thread events, debounced, refresh the pull requests of the threads they name; nothing else polls between sweeps. The
 * first trigger of a burst starts the debounce, and everything that arrived by its end becomes one refresh.
 */
const refreshOnThreadEvents = (input: {
  readonly monitor: Monitor
  readonly events: Stream.Stream<ThreadEvent>
  readonly config?: Effect.Effect<EventRefreshConfig>
}) =>
  Effect.gen(function* () {
    const triggerOf = makeRefreshTriggers()
    const pending = yield* Queue.unbounded<string>()
    yield* input.events.pipe(
      Stream.map(triggerOf),
      Stream.filter((sessionId): sessionId is string => sessionId !== null),
      Stream.runForEach(sessionId => Queue.offer(pending, sessionId)),
      Effect.forkChild,
    )
    return yield* Effect.forever(
      Effect.gen(function* () {
        const first = yield* Queue.take(pending)
        const config = yield* input.config ?? Effect.succeed(DEFAULT_EVENT_REFRESH)
        yield* Effect.sleep(config.debounce)
        const sessionIds = [...new Set([first, ...(yield* Queue.clear(pending))])]
        if (!config.enabled) return
        yield* input.monitor.refresh({ sessionIds, minAgeMs: EVENT_REFRESH_MIN_AGE_MS }).pipe(
          Effect.catchCause(() => Effect.logWarning('pull-requests: an event-driven refresh failed; the sweep will retry')),
          Effect.withSpan('pull-requests event refresh', { attributes: { threads: sessionIds.length } }),
        )
      }),
    )
  })

/** The slow fallback: every watched pull request once per interval, for changes no thread event announces. */
const sweepWatched = (input: { readonly monitor: Monitor; readonly every?: Effect.Effect<Duration.Input> }) =>
  input.monitor.pollAll.pipe(
    Effect.catchCause(() => Effect.logWarning('pull-requests: scheduled poll failed; polling will continue')),
    Effect.andThen(input.every ?? Effect.succeed(DEFAULT_SWEEP_INTERVAL)),
    Effect.flatMap(every => Effect.sleep(every)),
    Effect.forever,
  )

/** What makes the monitor refresh: thread events that ask for it, and the slow sweep behind them. */
export class PullRequestRefreshTriggers {
  static readonly make = makeRefreshTriggers
  static readonly refreshOnThreadEvents = refreshOnThreadEvents
  static readonly sweepWatched = sweepWatched
}
