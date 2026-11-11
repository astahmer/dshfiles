import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Ref, Schema, Stream } from 'effect'
import { SessionEvents, type SessionEvent } from './session-events.js'

const MAX_NAMES = 20
const toolName = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128))
const callId = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))

const toolCallEvent = Schema.Struct({ type: Schema.Literal('tool/call'), data: Schema.Struct({ callId, name: toolName }) })
const toolResultEvent = Schema.Struct({ type: Schema.Literal('tool/result'), data: Schema.Struct({ message: Schema.Struct({ toolCallId: callId }) }) })
const turnEndEvent = Schema.Struct({ type: Schema.Literal('turn/end') })

const decodeCall = Schema.decodeUnknownOption(toolCallEvent)
const decodeResult = Schema.decodeUnknownOption(toolResultEvent)
const isTurnEnd = Schema.is(turnEndEvent)

type OpenCalls = ReadonlyMap<string, ReadonlyMap<string, string>>

const applyEvent = (open: OpenCalls, { sessionId, event }: SessionEvent): OpenCalls => {
  if (isTurnEnd(event)) {
    if (!open.has(sessionId)) return open
    const next = new Map(open)
    next.delete(sessionId)
    return next
  }
  const call = decodeCall(event)
  if (Option.isSome(call)) {
    const calls = new Map(open.get(sessionId))
    calls.set(call.value.data.callId, call.value.data.name)
    return new Map(open).set(sessionId, calls)
  }
  const result = decodeResult(event)
  if (Option.isNone(result) || !open.get(sessionId)?.has(result.value.data.message.toolCallId)) return open
  const calls = new Map(open.get(sessionId))
  calls.delete(result.value.data.message.toolCallId)
  const next = new Map(open)
  if (calls.size === 0) next.delete(sessionId)
  else next.set(sessionId, calls)
  return next
}

/**
 * The tool calls each thread has started and not answered yet, held in memory from the Session event stream: what a
 * managed restart cuts off, recorded beside its resume row so the resumed turn can be told. A call waiting on a
 * background command (a jobs wait or a long shell) is one of them.
 */
export class OpenToolCalls extends Context.Service<
  OpenToolCalls,
  { readonly namesOf: (sessionIds: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, ReadonlyArray<string>>> }
>()('@dshfiles/thread-sidebar/OpenToolCalls') {
  static readonly layer = Layer.effect(
    OpenToolCalls,
    Effect.gen(function* () {
      const open = yield* Ref.make<OpenCalls>(new Map())
      const events = yield* (yield* SessionEvents).subscribe
      yield* DshxPlugin.worker(Stream.runForEach(events, event => Ref.update(open, current => applyEvent(current, event))))
      return OpenToolCalls.of({
        namesOf: sessionIds =>
          Effect.map(Ref.get(open), current => {
            const names = new Map<string, ReadonlyArray<string>>()
            for (const sessionId of sessionIds) {
              const calls = current.get(sessionId)
              if (calls !== undefined && calls.size > 0) names.set(sessionId, [...calls.values()].slice(0, MAX_NAMES))
            }
            return names
          }),
      })
    }),
  )
}
