import { Clock, Context, Deferred, Effect, Layer, Ref } from 'effect'
import type * as Schema from 'effect/Schema'
import type { WindowState, completionSchema } from './api.js'
import { BridgeLimits } from './api.js'
import { ClientToolRefused } from './errors.js'
import { BridgeWindows, type KnownWindow } from './windows.js'

type Completion = typeof completionSchema.Type
type Json = Schema.Json

interface PendingCall {
  readonly clientId: string
  readonly settle: Deferred.Deferred<Json, ClientToolRefused>
}

/** A call the Host sent to a window and now waits on. */
export interface StartedCall {
  readonly requestId: string
  /** Succeeds with the tool's result, fails with the window's error, or with `timeout` after `timeoutMs`. */
  readonly result: Effect.Effect<Json, ClientToolRefused>
  /** Forget the call without waiting, when the request never reached a window. */
  readonly cancel: Effect.Effect<void>
}

/**
 * The Host's view of open browser windows and the calls in flight to them. In memory only: windows announce
 * themselves again after a Host restart, and a restart drops every pending call with its Agent turn.
 */
export class ClientBridge extends Context.Service<
  ClientBridge,
  {
    readonly announce: (state: WindowState) => Effect.Effect<void>
    readonly leave: (clientId: string) => Effect.Effect<boolean>
    /** Windows heard from within the TTL; older ones are forgotten. */
    readonly windows: Effect.Effect<readonly KnownWindow[]>
    readonly start: (input: { readonly clientId: string; readonly timeoutMs: number }) => Effect.Effect<StartedCall>
    /** Settle a pending call; false when it is unknown, finished, or the reply comes from another window. */
    readonly complete: (completion: Completion) => Effect.Effect<boolean>
  }
>()('@dshfiles/client-bridge/ClientBridge') {
  static readonly layer = Layer.effect(
    ClientBridge,
    Effect.gen(function* () {
      const known = yield* Ref.make<ReadonlyMap<string, KnownWindow>>(new Map())
      const pending = new Map<string, PendingCall>()

      const windows = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const all = yield* Ref.get(known)
        const alive = BridgeWindows.live(all.values(), now)
        if (alive.length !== all.size) yield* Ref.set(known, new Map(alive.map(window => [window.clientId, window])))
        return alive
      })

      const failWindowCalls = (clientId: string, recovery: string) =>
        Effect.forEach(
          [...pending.entries()].filter(([, call]) => call.clientId === clientId),
          ([requestId, call]) => {
            pending.delete(requestId)
            return Deferred.fail(call.settle, new ClientToolRefused({ reason: 'window-closed', recovery }))
          },
          { discard: true },
        )

      return ClientBridge.of({
        announce: state =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            yield* Ref.update(known, all => new Map(all).set(state.clientId, BridgeWindows.announce(all.get(state.clientId), state, now)))
          }),
        leave: clientId =>
          Effect.gen(function* () {
            const removed = (yield* Ref.get(known)).has(clientId)
            yield* Ref.update(known, all => {
              const next = new Map(all)
              next.delete(clientId)
              return next
            })
            yield* failWindowCalls(clientId, 'The browser window closed before it answered. Call client_tools_list and retry in an open window.')
            return removed
          }),
        windows,
        start: input =>
          Effect.gen(function* () {
            const requestId = crypto.randomUUID()
            const settle = yield* Deferred.make<Json, ClientToolRefused>()
            pending.set(requestId, { clientId: input.clientId, settle })
            const result = Deferred.await(settle).pipe(
              Effect.timeoutOrElse({
                duration: input.timeoutMs,
                orElse: () =>
                  Effect.fail(
                    new ClientToolRefused({
                      reason: 'timeout',
                      recovery: `The browser window did not answer within ${String(input.timeoutMs)} ms. It may be asleep or still loading: ask the user to bring DSH to the front, or retry with a longer timeoutMs (up to ${String(BridgeLimits.maxTimeoutMs)}).`,
                    }),
                  ),
              }),
              Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
            )
            return { requestId, result, cancel: Effect.sync(() => void pending.delete(requestId)) }
          }),
        complete: completion =>
          Effect.gen(function* () {
            const call = pending.get(completion.requestId)
            if (call === undefined || call.clientId !== completion.clientId) return false
            pending.delete(completion.requestId)
            if (completion.outcome === 'ok') return yield* Deferred.succeed(call.settle, completion.result ?? null)
            return yield* Deferred.fail(
              call.settle,
              new ClientToolRefused({ reason: 'failed', recovery: completion.error ?? 'The client tool failed without saying why.' }),
            )
          }),
      })
    }),
  )
}
