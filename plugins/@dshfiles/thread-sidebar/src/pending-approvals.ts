import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, PubSub, Ref, Schema, Stream } from 'effect'
import { LiveTurnsModel } from './live-turns.js'
import { SessionEvents, type SessionEvent } from './session-events.js'

/**
 * Tool approvals waiting on the user, folded on this Host from the Session log it already observes: the approval
 * service appends `approval/asked` when it puts a question to the answerers and `approval/decided` when the outcome is
 * known (granted, refused, cancelled or unavailable). A turn's end settles anything it left open. The command and the
 * tool's description come from the `tool/call` the question names. Held in memory only: a pending approval does not
 * outlive the Host process that asks it.
 */

export interface PendingApproval {
  /** The approval request's id, unique per ask. */
  readonly id: string
  readonly sessionId: string
  readonly toolName: string
  /** The asker's explanation, when it gave one. */
  readonly reason: string | undefined
  /** The command or path the call acts on, when its arguments name one. */
  readonly command: string | undefined
  /** The call's own one-line description (bash's `description`), when it gave one. */
  readonly description: string | undefined
  /** Host clock, epoch ms, of the ask. */
  readonly askedAt: number
}

interface CallFacts {
  readonly command: string | undefined
  readonly description: string | undefined
}

export interface PendingApprovalsState {
  readonly pending: ReadonlyMap<string, PendingApproval>
  /** Recent tool calls by call id, so an ask can name its command; bounded. */
  readonly calls: ReadonlyMap<string, CallFacts>
}

const MAX_CALLS = 200
const MAX_PENDING = 500

const askedSchema = Schema.Struct({
  type: Schema.Literal('approval/asked'),
  data: Schema.Struct({ id: Schema.String, toolName: Schema.String, callId: Schema.optional(Schema.String), reason: Schema.optional(Schema.String) }),
})
const decidedSchema = Schema.Struct({ type: Schema.Literal('approval/decided'), data: Schema.Struct({ id: Schema.String }) })
const callSchema = Schema.Struct({
  type: Schema.Literal('tool/call'),
  data: Schema.Struct({ id: Schema.optional(Schema.String), callId: Schema.optional(Schema.String), arguments: Schema.optional(Schema.Unknown) }),
})
const describedSchema = Schema.Struct({ description: Schema.String })
const decodeAsked = Schema.decodeUnknownOption(askedSchema)
const decodeDecided = Schema.decodeUnknownOption(decidedSchema)
const decodeCall = Schema.decodeUnknownOption(callSchema)
const decodeDescribed = Schema.decodeUnknownOption(Schema.Union([describedSchema, Schema.fromJsonString(describedSchema)]))

export const EMPTY_PENDING_APPROVALS: PendingApprovalsState = { pending: new Map(), calls: new Map() }

const withoutSession = (pending: ReadonlyMap<string, PendingApproval>, sessionId: string): ReadonlyMap<string, PendingApproval> => {
  if (![...pending.values()].some(approval => approval.sessionId === sessionId)) return pending
  return new Map([...pending].filter(([, approval]) => approval.sessionId !== sessionId))
}

const bounded = <V>(map: Map<string, V>, limit: number): Map<string, V> => {
  while (map.size > limit) {
    const oldest = map.keys().next()
    if (oldest.done === true) break
    map.delete(oldest.value)
  }
  return map
}

/** Fold one Session event; every other event leaves the state as it is (same reference). */
const apply = (state: PendingApprovalsState, input: SessionEvent): PendingApprovalsState => {
  const { sessionId, event } = input
  if (event.type === 'tool/call') {
    const call = decodeCall(event)
    if (Option.isNone(call)) return state
    const callId = call.value.data.id ?? call.value.data.callId
    if (callId === undefined) return state
    const args = LiveTurnsModel.readArguments(call.value.data.arguments)
    const command = args.command ?? args.cmd ?? args.file_path ?? args.path ?? args.filePath
    const described = decodeDescribed(call.value.data.arguments)
    const facts: CallFacts = { command, description: Option.isSome(described) ? described.value.description : undefined }
    return { ...state, calls: bounded(new Map(state.calls).set(callId, facts), MAX_CALLS) }
  }
  if (event.type === 'approval/asked') {
    const asked = decodeAsked(event)
    if (Option.isNone(asked)) return state
    const { id, toolName, callId, reason } = asked.value.data
    const facts = callId === undefined ? undefined : state.calls.get(callId)
    const approval: PendingApproval = {
      id,
      sessionId,
      toolName,
      reason,
      command: facts?.command,
      description: facts?.description,
      askedAt: event.time,
    }
    return { ...state, pending: bounded(new Map(state.pending).set(id, approval), MAX_PENDING) }
  }
  if (event.type === 'approval/decided') {
    const decided = decodeDecided(event)
    if (Option.isNone(decided) || !state.pending.has(decided.value.data.id)) return state
    const pending = new Map(state.pending)
    pending.delete(decided.value.data.id)
    return { ...state, pending }
  }
  if (event.type === 'turn/end') {
    const pending = withoutSession(state.pending, sessionId)
    return pending === state.pending ? state : { ...state, pending }
  }
  return state
}

const listOf = (state: PendingApprovalsState): readonly PendingApproval[] => [...state.pending.values()].sort((left, right) => right.askedAt - left.askedAt)

export class PendingApprovalsModel {
  static readonly apply = apply
  static readonly listOf = listOf
}

export class PendingApprovals extends Context.Service<
  PendingApprovals,
  {
    readonly list: Effect.Effect<readonly PendingApproval[]>
    /** Emits once per change of the pending set. */
    readonly changes: Stream.Stream<void>
  }
>()('@dshfiles/thread-sidebar/PendingApprovals') {
  static readonly layer = Layer.effect(
    PendingApprovals,
    Effect.gen(function* () {
      const state = yield* Ref.make<PendingApprovalsState>(EMPTY_PENDING_APPROVALS)
      const changed = yield* Effect.acquireRelease(PubSub.sliding<void>(1), PubSub.shutdown)
      const events = yield* (yield* SessionEvents).subscribe
      yield* DshxPlugin.worker(
        Stream.runForEach(events, event =>
          Ref.modify(state, current => {
            const next = apply(current, event)
            return [next.pending !== current.pending, next] as const
          }).pipe(Effect.flatMap(moved => (moved ? PubSub.publish(changed, undefined) : Effect.void))),
        ),
      )
      return PendingApprovals.of({
        list: Effect.map(Ref.get(state), listOf),
        changes: Stream.fromPubSub(changed),
      })
    }),
  )
}
