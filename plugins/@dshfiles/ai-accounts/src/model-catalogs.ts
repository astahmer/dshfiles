import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { Context, Effect, Exit, Fiber, HashMap, Layer, Option, Ref } from 'effect'
import type { KeyedRoute } from './provider-routes.js'

/** A discovered catalog is only valid for the keyed route it was fetched for. */
export interface DiscoveredCatalog {
  readonly route: KeyedRoute
  readonly models: readonly LlmDiscoveredModel[]
}

export const CATALOG_REFRESH_TIMEOUT = '15 seconds'

/** One account's in-flight refresh; the token lets a replaced run leave the newer entry alone. */
interface CatalogRefresh {
  readonly token: number
  readonly fiber: Fiber.Fiber<Option.Option<unknown>> | undefined
}

/**
 * The model catalogs this Host discovered at runtime. Discovery is per keyed account and outlives any one request:
 * `start` keeps one refresh per account, interrupting the previous one so a slow fetch cannot outlive the route that
 * asked for it, and hands back the fiber whose `Option` result the caller joins. A refresh that fails, times out or is
 * interrupted reports `None` and records nothing.
 */
export class ModelCatalogs extends Context.Service<
  ModelCatalogs,
  {
    /** The models discovered for this account, synchronously: route building reads them while it builds profiles. */
    readonly discovered: (instanceId: string) => readonly LlmDiscoveredModel[] | undefined
    readonly record: (input: { readonly instanceId: string; readonly route: KeyedRoute; readonly models: readonly LlmDiscoveredModel[] }) => Effect.Effect<void>
    readonly forget: (instanceId: string) => Effect.Effect<void>
    /** Drop every catalog whose route no longer matches, as a route rebuild does. */
    readonly retain: (matches: (input: { readonly instanceId: string; readonly route: KeyedRoute }) => boolean) => Effect.Effect<void>
    /** Begin one account's refresh, interrupting the one already running for it. */
    readonly start: <A, E, R>(instanceId: string, task: Effect.Effect<A, E, R>) => Effect.Effect<Fiber.Fiber<Option.Option<A>>, never, R>
    readonly isRefreshing: (instanceId: string) => Effect.Effect<boolean>
  }
>()('@dshfiles/ai-accounts/ModelCatalogs') {
  static readonly make = Effect.gen(function* () {
    const discovered = yield* Ref.make(HashMap.empty<string, DiscoveredCatalog>())
    const refreshes = yield* Ref.make(HashMap.empty<string, CatalogRefresh>())

    const record = Effect.fn('ai-accounts model catalog record')(function* (input: {
      readonly instanceId: string
      readonly route: KeyedRoute
      readonly models: readonly LlmDiscoveredModel[]
    }) {
      yield* Ref.update(discovered, current => HashMap.set(current, input.instanceId, { route: input.route, models: input.models }))
    })

    /** Only the run that still owns the account drops its entry; a replaced run leaves the newer one in place. */
    const settle = (instanceId: string, token: number) =>
      Ref.update(refreshes, current => {
        const entry = Option.getOrUndefined(HashMap.get(current, instanceId))
        return entry?.token === token ? HashMap.remove(current, instanceId) : current
      })

    const start = Effect.fnUntraced(function* <A, E, R>(instanceId: string, task: Effect.Effect<A, E, R>) {
      const { previous, token } = yield* Ref.modify(refreshes, current => {
        const entry = Option.getOrUndefined(HashMap.get(current, instanceId))
        const token = (entry?.token ?? 0) + 1
        return [{ previous: entry?.fiber, token }, HashMap.set(current, instanceId, { token, fiber: entry?.fiber })]
      })
      if (previous !== undefined) yield* Fiber.interrupt(previous)
      // Settled as data: a failed, timed-out or interrupted refresh answers `None` instead of failing its joiner.
      const fiber = yield* Effect.forkChild(
        task.pipe(
          Effect.timeoutOption(CATALOG_REFRESH_TIMEOUT),
          Effect.exit,
          Effect.map(exit => (Exit.isSuccess(exit) ? exit.value : Option.none<A>())),
          Effect.ensuring(settle(instanceId, token)),
        ),
      )
      yield* Ref.update(refreshes, current => {
        const entry = Option.getOrUndefined(HashMap.get(current, instanceId))
        return entry?.token === token ? HashMap.set(current, instanceId, { token, fiber }) : current
      })
      return fiber
    })

    return ModelCatalogs.of({
      discovered: instanceId => Option.map(HashMap.get(Ref.getUnsafe(discovered), instanceId), catalog => catalog.models).pipe(Option.getOrUndefined),
      record,
      forget: instanceId => Ref.update(discovered, current => HashMap.remove(current, instanceId)),
      retain: matches =>
        Ref.update(discovered, current =>
          [...current].reduce(
            (kept, [instanceId, catalog]) => (matches({ instanceId, route: catalog.route }) ? kept : HashMap.remove(kept, instanceId)),
            current,
          ),
        ),
      start,
      isRefreshing: instanceId =>
        Effect.gen(function* () {
          const entry = Option.getOrUndefined(HashMap.get(yield* Ref.get(refreshes), instanceId))
          return entry?.fiber !== undefined && entry.fiber.pollUnsafe() === undefined
        }),
    })
  })

  static readonly layer = Layer.effect(ModelCatalogs, ModelCatalogs.make)
}
