import { Context, Effect, Exit, Fiber, HashMap, Layer, Option, Ref } from 'effect'
import type { KeyedRoute } from './provider-routes.js'

/** A discovered catalog is only valid for the keyed route it was fetched for. */
export interface DiscoveredCatalog {
  readonly route: KeyedRoute
  readonly modelIds: readonly string[]
}

export const CATALOG_REFRESH_TIMEOUT = '15 seconds'

/**
 * The model catalogs this Host discovered at runtime. Discovery is per keyed account and outlives any one request:
 * `start` keeps one refresh per account, interrupting the previous one so a slow fetch cannot outlive the route that
 * asked for it, and hands back the fiber whose `Option` result the caller joins. A refresh that fails, times out or is
 * interrupted reports `None` and records nothing.
 */
export class ModelCatalogs extends Context.Service<
  ModelCatalogs,
  {
    /** The ids discovered for this account, synchronously: route building reads it while it builds profiles. */
    readonly discovered: (instanceId: string) => readonly string[] | undefined
    readonly record: (input: { readonly instanceId: string; readonly route: KeyedRoute; readonly modelIds: readonly string[] }) => Effect.Effect<void>
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
    const running = yield* Ref.make(HashMap.empty<string, Fiber.Fiber<Option.Option<unknown>>>())
    const generation = yield* Ref.make(HashMap.empty<string, number>())

    const record = Effect.fn('ai-accounts model catalog record')(function* (input: {
      readonly instanceId: string
      readonly route: KeyedRoute
      readonly modelIds: readonly string[]
    }) {
      yield* Ref.update(discovered, current => HashMap.set(current, input.instanceId, { route: input.route, modelIds: input.modelIds }))
    })

    /** Only the run that still owns the account drops its entry; a replaced run leaves the newer one in place. */
    const settle = (instanceId: string, token: number) =>
      Ref.get(generation).pipe(
        Effect.flatMap(current =>
          HashMap.get(current, instanceId) === Option.some(token)
            ? Ref.update(running, entries => HashMap.remove(entries, instanceId))
            : Effect.void,
        ),
        Effect.andThen(
          Ref.get(generation).pipe(
            Effect.flatMap(current =>
              HashMap.get(current, instanceId) === Option.some(token) ? Ref.update(generation, entries => HashMap.remove(entries, instanceId)) : Effect.void,
            ),
          ),
        ),
      )

    const start = Effect.fnUntraced(function* <A, E, R>(instanceId: string, task: Effect.Effect<A, E, R>) {
      const token = (Option.getOrUndefined(HashMap.get(Ref.getUnsafe(generation), instanceId)) ?? 0) + 1
      const previous = Option.getOrUndefined(HashMap.get(Ref.getUnsafe(running), instanceId))
      yield* Ref.update(generation, current => HashMap.set(current, instanceId, token))
      if (previous !== undefined) yield* Fiber.interrupt(previous)
      // Settled as data: a failed, timed-out or interrupted refresh answers `None` instead of failing its joiner.
      const fiber = yield* Effect.forkChild(
        task.pipe(
          Effect.timeoutOption(CATALOG_REFRESH_TIMEOUT),
          Effect.exit,
          Effect.map(exit => (Exit.isSuccess(exit) ? exit.value : Option.none<A>())),
        ),
      )
      yield* Ref.update(running, current => HashMap.set(current, instanceId, fiber))
      yield* Effect.forkChild(Fiber.await(fiber).pipe(Effect.andThen(settle(instanceId, token)), Effect.asVoid))
      return fiber
    })

    return ModelCatalogs.of({
      discovered: instanceId => Option.map(HashMap.get(Ref.getUnsafe(discovered), instanceId), catalog => catalog.modelIds).pipe(Option.getOrUndefined),
      record,
      forget: instanceId => Ref.update(discovered, current => HashMap.remove(current, instanceId)),
      retain: matches =>
        Ref.update(discovered, current =>
          [...current].reduce((kept, [instanceId, catalog]) => (matches({ instanceId, route: catalog.route }) ? kept : HashMap.remove(kept, instanceId)), current),
        ),
      start,
      isRefreshing: instanceId =>
        Effect.gen(function* () {
          const fiber = Option.getOrUndefined(HashMap.get(yield* Ref.get(running), instanceId))
          return fiber !== undefined && fiber.pollUnsafe() === undefined
        }),
    })
  })

  static readonly layer = Layer.effect(ModelCatalogs, ModelCatalogs.make)
}
