import { Duration, Effect, Option, Schema, Stream } from 'effect'
import { EVENT_REFRESH_MIN_AGE_MS, type PullRequestMonitor } from './monitor.js'

/** A shell command that publishes commits or opens/changes a pull request: its result is worth a prompt refresh. */
const PUBLISHING_COMMAND = /\b(?:jj\s+git\s+push|git\s+push|gh\s+pr\s+(?:create|merge|ready|close|reopen)|glab\s+mr\s+(?:create|merge|close|reopen))\b/u

/** Tool calls awaiting their result; bounded so a thread that never answers one cannot grow it. */
const MAX_PENDING_CALLS = 256

/** Thread events gathered into one refresh: a push and the turn end right after it cost one pass. */
export const EVENT_DEBOUNCE = Duration.seconds(3)

/** The fallback sweep: events cover pushes and turn ends, so a pull request changed outside DSH is caught within this. */
export const SWEEP_INTERVAL = Duration.minutes(10)

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
export const makeRefreshTriggers = () => {
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

/** Thread events, debounced, refresh the pull requests of the threads they name; nothing else polls between sweeps. */
export const refreshOnThreadEvents = (input: { readonly monitor: Monitor; readonly events: Stream.Stream<ThreadEvent>; readonly debounce?: Duration.Input }) => {
  const triggerOf = makeRefreshTriggers()
  return input.events.pipe(
    Stream.map(triggerOf),
    Stream.filter((sessionId): sessionId is string => sessionId !== null),
    Stream.groupedWithin(64, input.debounce ?? EVENT_DEBOUNCE),
    Stream.runForEach(sessionIds =>
      input.monitor.refresh({ sessionIds: [...new Set(sessionIds)], minAgeMs: EVENT_REFRESH_MIN_AGE_MS }).pipe(
        Effect.catchCause(() => Effect.logWarning('pull-requests: an event-driven refresh failed; the sweep will retry')),
        Effect.withSpan('pull-requests event refresh', { attributes: { threads: sessionIds.length } }),
      ),
    ),
  )
}

/** The slow fallback: every watched pull request once per interval, for changes no thread event announces. */
export const sweepWatched = (input: { readonly monitor: Monitor; readonly every?: Duration.Input }) =>
  input.monitor.pollAll.pipe(
    Effect.catchCause(() => Effect.logWarning('pull-requests: scheduled poll failed; polling will continue')),
    Effect.andThen(Effect.sleep(input.every ?? SWEEP_INTERVAL)),
    Effect.forever,
  )
