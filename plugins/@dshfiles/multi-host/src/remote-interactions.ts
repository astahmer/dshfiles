import { Clock, Context, Deferred, Duration, Effect, Layer, Option, PubSub, RcMap, Ref, Schedule, Schema, type Scope, Stream } from 'effect'
import { remoteApprovalWireSchema, remoteQuestionWireSchema, type RemoteInteraction } from './api.js'
import type { Gateway, RemoteEventOutcome } from './connectors/gateway.js'
import type { GatewayRequestError } from './errors.js'
import { RuntimePool } from './runtime-pool.js'
import { SchemaFields } from './schema.js'

/** A reconnect within this window keeps the bridge, so a mirrored Session's stream can drop without losing its claims. */
const idleTimeToLive = Duration.seconds(30)
const reconnectDelay = Duration.seconds(3)
const maxInteractions = 200

/** The frames of the owner's event stream this Host acts on; every other frame decodes to nothing. */
const decodeEventFrame = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ type: Schema.Literal('ready'), clientId: Schema.String }).pipe(SchemaFields.passthrough),
    Schema.Struct({ type: Schema.Literal('cancel'), eventId: Schema.String }).pipe(SchemaFields.passthrough),
    Schema.Struct({
      type: Schema.Literal('waterfall'),
      event: Schema.Literals(['user-questions/request', 'approval/request']),
      eventId: Schema.String,
      agentId: Schema.String,
      request: Schema.Unknown,
    }).pipe(SchemaFields.passthrough),
  ]),
)
type EventFrame = Option.Option.Value<ReturnType<typeof decodeEventFrame>>
const decodeQuestionRequest = Schema.decodeUnknownOption(remoteQuestionWireSchema)
const decodeApprovalRequest = Schema.decodeUnknownOption(remoteApprovalWireSchema)
const decodeProjection = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.Literal('projection'), sessionId: Schema.String, key: Schema.String, value: Schema.Unknown, seq: Schema.Number }).pipe(
    SchemaFields.passthrough,
  ),
)
const decodeClaimFrame = Schema.decodeUnknownOption(Schema.Struct({ remainingMs: Schema.Number }).pipe(SchemaFields.passthrough))

/** A held request: what clients read, its timed-wait deadline, and the end that releases the claim on the owner. */
interface Held {
  readonly interaction: RemoteInteraction
  readonly deadlineAt: number | undefined
  /**
   * Whether clients may present it. A timed question waits for its claim to report: a card that mounts without a
   * deadline takes focus, and focus freezes the countdown the owner is about to report.
   */
  readonly revealed: boolean
  readonly released: Deferred.Deferred<void>
}

/** One open event stream of one runtime; a reconnect gets a new client id, and the owner delivers what is pending again. */
interface Connection {
  readonly clientId: string
  readonly held: ReadonlyMap<string, Held>
}

/** A held request that is gone, for the person who tried to answer it. */
export const interactionGone = {
  ok: false,
  code: 'interaction-not-found',
  message: 'This request is no longer waiting: it was answered elsewhere, timed out, or the host disconnected. Check the thread before answering again.',
} as const

/** One finished projection value at the owning runtime's own event sequence. */
export interface RemoteProjectionUpdate {
  readonly sessionId: string
  readonly key: string
  readonly value: unknown
  readonly seq: number
}

const toRequest = (frame: { readonly event: string; readonly request: unknown }): RemoteInteraction['request'] | undefined => {
  if (frame.event === 'approval/request') {
    const decoded = decodeApprovalRequest(frame.request)
    if (Option.isNone(decoded)) return undefined
    const { callId, displayReason, reason, toolName } = decoded.value
    return {
      kind: 'approval',
      toolName,
      ...(callId !== undefined && { callId }),
      ...(reason !== undefined && { reason }),
      ...(displayReason !== undefined && { displayReason }),
    }
  }
  const decoded = decodeQuestionRequest(frame.request)
  if (Option.isNone(decoded)) return undefined
  const callId = decoded.value.wait?.callId
  return { kind: 'question', questions: decoded.value.questions, ...(callId !== undefined && { callId }) }
}

/** The stream that keeps a timed wait on the owner from expiring while a question is on show here. */
const timedCall = (frame: { readonly request: unknown }): string | undefined =>
  Option.match(decodeQuestionRequest(frame.request), {
    onNone: () => undefined,
    onSome: request => (request.wait?.timed === true ? request.wait.callId : undefined),
  })

/**
 * Questions and approvals of the runtimes whose Sessions this Host mirrors.
 *
 * The owning runtime forwards these waterfalls only to an owner Client it can reach, so this Host becomes one: while a
 * mirrored Session is followed, it opens the runtime's own `$events` stream and holds each request, and an answer goes
 * back as `$events/result` over that connection. The owner still decides: it accepts a result only for a request it
 * delivered to this client, and the first answer from any Client settles it. Nothing here fabricates a request, and
 * nothing answers `next`, so a request no one here answers stays on the owner for its own UI.
 */
export class RemoteInteractions extends Context.Service<
  RemoteInteractions,
  {
    /** Keep the runtime's event stream open for the Scope. */
    readonly hold: (runtimeId: string) => Effect.Effect<void, never, Scope.Scope>
    /** Every held request, oldest first; a timed question carries what its wait has left right now. */
    readonly list: Effect.Effect<readonly RemoteInteraction[]>
    /** One held request of one Session, when the owner still waits on it. */
    readonly find: (input: { readonly sessionId: string; readonly id: string }) => Effect.Effect<RemoteInteraction | undefined>
    /** Send one outcome to the owner and stop holding the request. */
    readonly settle: (input: {
      readonly interaction: RemoteInteraction
      readonly outcome: RemoteEventOutcome
    }) => Effect.Effect<{ readonly ok: true } | typeof interactionGone, Effect.Error<ReturnType<RuntimePool['Service']['acquire']>> | GatewayRequestError>
    /** Each change of what is held. */
    readonly changes: Stream.Stream<void>
    /** Finished projection values of a followed runtime's Sessions, which its `follow` stream does not carry. */
    readonly projections: Stream.Stream<RemoteProjectionUpdate>
  }
>()('@dshfiles/multi-host/RemoteInteractions') {
  static readonly layer = Layer.effect(
    RemoteInteractions,
    Effect.gen(function* () {
      const pool = yield* RuntimePool
      const connections = yield* Ref.make<ReadonlyMap<string, Connection>>(new Map())
      const changed = yield* PubSub.sliding<void>(1)
      const projected = yield* PubSub.unbounded<RemoteProjectionUpdate>()
      const announce = PubSub.publish(changed, undefined)

      const update = (runtimeId: string, change: (connection: Connection) => Connection) =>
        Ref.update(connections, current => {
          const connection = current.get(runtimeId)
          if (connection === undefined) return current
          return new Map(current).set(runtimeId, change(connection))
        })

      const releaseAll = (connection: Connection | undefined) =>
        Effect.forEach(connection?.held.values() ?? [], held => Deferred.succeed(held.released, undefined), { discard: true })

      /** The owner's stream ended, so every delivery ended with it; the next stream receives what is still pending. */
      const disconnect = (runtimeId: string) =>
        Effect.gen(function* () {
          const previous = yield* Ref.modify(connections, current => {
            const next = new Map(current)
            next.delete(runtimeId)
            return [current.get(runtimeId), next] as const
          })
          yield* releaseAll(previous)
          if (previous !== undefined && previous.held.size > 0) yield* announce
        })

      const drop = (runtimeId: string, eventId: string) =>
        Effect.gen(function* () {
          const held = (yield* Ref.get(connections)).get(runtimeId)?.held.get(eventId)
          if (held === undefined) return
          yield* update(runtimeId, connection => {
            const remaining = new Map(connection.held)
            remaining.delete(eventId)
            return { ...connection, held: remaining }
          })
          yield* Deferred.succeed(held.released, undefined)
          yield* announce
        })

      const reveal = (runtimeId: string, eventId: string) =>
        Effect.gen(function* () {
          const held = (yield* Ref.get(connections)).get(runtimeId)?.held.get(eventId)
          if (held === undefined || held.revealed) return
          yield* update(runtimeId, connection => ({ ...connection, held: new Map(connection.held).set(eventId, { ...held, revealed: true }) }))
          yield* announce
        })

      /** Hold the owner's foreground wait while the question is on show, and learn how long it has left. */
      const claim = (input: {
        readonly runtimeId: string
        readonly gateway: Gateway
        readonly eventId: string
        readonly agentId: string
        readonly callId: string
        readonly released: Deferred.Deferred<void>
      }) =>
        input.gateway.stream({ endpoint: 'userQuestions/attachWait', args: { agentId: input.agentId, callId: input.callId } }).pipe(
          Stream.interruptWhen(Deferred.await(input.released)),
          Stream.runForEach(frame =>
            Effect.gen(function* () {
              const remaining = decodeClaimFrame(frame)
              if (Option.isNone(remaining)) return
              const now = yield* Clock.currentTimeMillis
              yield* update(input.runtimeId, connection => {
                const held = connection.held.get(input.eventId)
                if (held === undefined) return connection
                return {
                  ...connection,
                  held: new Map(connection.held).set(input.eventId, { ...held, deadlineAt: now + remaining.value.remainingMs, revealed: true }),
                }
              })
              yield* announce
            }),
          ),
          // A runtime that refuses the claim keeps its own timer, and its cancel frame ends the request here.
          Effect.ignore,
          Effect.andThen(reveal(input.runtimeId, input.eventId)),
        )

      const handle = (runtimeId: string, gateway: Gateway, frame: EventFrame): Effect.Effect<void, never, Scope.Scope> =>
        Effect.gen(function* () {
          if (frame.type === 'ready') {
            yield* releaseAll((yield* Ref.get(connections)).get(runtimeId))
            yield* Ref.update(connections, current => new Map(current).set(runtimeId, { clientId: frame.clientId, held: new Map() }))
            return
          }
          if (frame.type === 'cancel') return yield* drop(runtimeId, frame.eventId)
          const { agentId, eventId } = frame
          const request = toRequest(frame)
          const connection = (yield* Ref.get(connections)).get(runtimeId)
          if (request === undefined || connection === undefined || connection.held.size >= maxInteractions) return
          const released = yield* Deferred.make<void>()
          const interaction: RemoteInteraction = { id: eventId, runtimeId, sessionId: agentId, request }
          const callId = timedCall(frame)
          yield* update(runtimeId, current => ({
            ...current,
            held: new Map(current.held).set(eventId, { interaction, deadlineAt: undefined, revealed: callId === undefined, released }),
          }))
          if (callId === undefined) yield* announce
          else yield* Effect.forkScoped(claim({ runtimeId, gateway, eventId, agentId, callId, released }))
        })

      /** A dropped control stream only pauses live values: the next `follow` snapshot carries them, so it is simply reopened. */
      const followProjections = (gateway: Gateway) =>
        gateway.stream({ endpoint: 'session/control', args: {} }).pipe(
          Stream.runForEach(frame =>
            Option.match(decodeProjection(frame), {
              onNone: () => Effect.void,
              onSome: ({ key, seq, sessionId, value }) => PubSub.publish(projected, { sessionId, key, value, seq }),
            }),
          ),
          Effect.ignore,
          Effect.repeat(Schedule.spaced(reconnectDelay)),
        )

      const connectOnce = (runtimeId: string) =>
        Effect.scoped(
          Effect.flatMap(pool.acquire(runtimeId), lease =>
            Effect.gen(function* () {
              yield* Effect.forkScoped(followProjections(lease.gateway))
              yield* Stream.runForEach(lease.gateway.events, raw =>
                Option.match(decodeEventFrame(raw), { onNone: () => Effect.void, onSome: frame => handle(runtimeId, lease.gateway, frame) }),
              )
            }).pipe(Effect.withSpan('multi-host remote interactions follow', { attributes: { 'dshx.multi-host.runtime_id': runtimeId } })),
          ),
        ).pipe(Effect.ensuring(disconnect(runtimeId)), Effect.ignore)

      const bridges = yield* RcMap.make({
        lookup: (runtimeId: string) => Effect.asVoid(Effect.forkScoped(Effect.repeat(connectOnce(runtimeId), Schedule.spaced(reconnectDelay)))),
        idleTimeToLive,
      })

      const list = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const rows = [...(yield* Ref.get(connections)).values()].flatMap(connection => [...connection.held.values()]).filter(held => held.revealed)
        return rows.map(({ deadlineAt, interaction }): RemoteInteraction => {
          if (deadlineAt === undefined || interaction.request.kind !== 'question') return interaction
          return { ...interaction, request: { ...interaction.request, remainingMs: Math.max(0, deadlineAt - now) } }
        })
      })

      const find = (input: { readonly sessionId: string; readonly id: string }) =>
        Effect.map(list, rows => rows.find(row => row.id === input.id && row.sessionId === input.sessionId))

      const settle = Effect.fn('multi-host remote interaction settle')(function* (input: {
        readonly interaction: RemoteInteraction
        readonly outcome: RemoteEventOutcome
      }) {
        const { id, runtimeId } = input.interaction
        const connection = (yield* Ref.get(connections)).get(runtimeId)
        if (connection?.held.has(id) !== true) return interactionGone
        yield* pool.use(runtimeId, gateway => gateway.answerEvent({ clientId: connection.clientId, eventId: id, outcome: input.outcome }), { mutation: true })
        yield* drop(runtimeId, id)
        return { ok: true as const }
      })

      return RemoteInteractions.of({
        hold: runtimeId => RcMap.get(bridges, runtimeId),
        list,
        find,
        settle,
        changes: Stream.fromPubSub(changed),
        projections: Stream.fromPubSub(projected),
      })
    }),
  )
}
