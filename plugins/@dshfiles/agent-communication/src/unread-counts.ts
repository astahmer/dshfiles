import type { CommunicationPrincipal } from '@dshfiles/dshx/communication'
import { hostService } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Ref, Semaphore } from 'effect'
import { CommunicationHub } from './communication-hub-promise.js'
import { HostAgents } from './host-edge-promise.js'
import { UnreadNudgeRules } from './unread-nudge.js'

/**
 * Unread peer-message counts per live Agent, read by the turn-start nudge. A stale count is harmless; a failed refresh
 * must never disturb a turn, so a failure keeps the previous counts and concurrent refreshes collapse into one.
 */
export class UnreadCounts extends Context.Service<
  UnreadCounts,
  {
    readonly refresh: Effect.Effect<void>
    /** Start a refresh in the plugin's Scope without waiting for it. */
    readonly refreshInBackground: Effect.Effect<void>
    readonly countFor: (agentId: string) => number
  }
>()('@dshfiles/agent-communication/UnreadCounts') {
  static readonly layer = Layer.effect(
    UnreadCounts,
    Effect.gen(function* () {
      const hub = yield* CommunicationHub
      const agents = yield* HostAgents
      const scope = yield* Effect.scope
      const counts = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
      const refreshing = yield* Semaphore.make(1)

      // One secured state read and one sweep for the whole agent list; the per-principal reads only answer a
      // batch failure so one broken read cannot hide every other agent's count.
      const collect = Effect.gen(function* () {
        const principals = (yield* agents.list).map((agent): CommunicationPrincipal => ({ kind: 'agent', id: agent.id }))
        if (principals.length === 0) return new Map<string, number>()
        const readings = yield* hub.unreadCounts(principals).pipe(
          Effect.catch(() =>
            Effect.forEach(principals, principal => Effect.option(Effect.map(hub.unreadCount(principal), count => ({ principal, count }))), {
              concurrency: 'unbounded',
            }).pipe(Effect.map(results => results.flatMap(Option.toArray))),
          ),
        )
        return new Map(
          readings.flatMap(reading => (reading.count > 0 && reading.principal.kind === 'agent' ? [[reading.principal.id, reading.count] as const] : [])),
        )
      })

      const refresh = refreshing
        .withPermitsIfAvailable(1)(
          collect.pipe(
            Effect.flatMap(next => Ref.set(counts, next)),
            Effect.catchCause(cause => Effect.logWarning('agent-communication: unread count refresh failed', cause)),
          ),
        )
        .pipe(Effect.asVoid, Effect.withSpan('agent communication refresh unread counts'))

      return UnreadCounts.of({
        refresh,
        refreshInBackground: Effect.asVoid(Effect.forkIn(refresh, scope)),
        countFor: agentId => Ref.getUnsafe(counts).get(agentId) ?? 0,
      })
    }),
  )
}

/** The turn-start nudge, registered for the plugin's lifetime; it reads the last refreshed count synchronously. */
export const UnreadPrompt = Layer.effectDiscard(
  Effect.gen(function* () {
    const systemPrompt = yield* hostService('systemPrompt')
    const unread = yield* UnreadCounts
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        systemPrompt.context({
          name: UnreadNudgeRules.contextName,
          order: UnreadNudgeRules.contextOrder,
          interpolate: false,
          text: assembly => UnreadNudgeRules.text({ count: unread.countFor(assembly.agent?.id ?? '') }),
        }),
      ),
      dispose => Effect.sync(dispose),
    )
  }),
)
