import { Effect, Exit, Fiber, Option, Schema, type Context } from 'effect'
import type { ModelCatalogs } from './model-catalogs.js'
import type { KeyedRoute } from './provider-routes.js'

/** One account's model discovery failed; the catalog keeps its previous ids. */
export class ModelCatalogRefreshFailed extends Schema.TaggedError<ModelCatalogRefreshFailed>()('ModelCatalogRefreshFailed', {
  instanceId: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The model catalog for "${this.instanceId}" could not be refreshed.`
  }
}

/** What the unported Host route code reads: the discovered ids synchronously, and one account's refresh to await. */
export interface ModelCatalogsPromise {
  readonly discovered: (instanceId: string) => readonly string[] | undefined
  /** Refresh one account's catalog, interrupting the run already in flight for it; `undefined` when it found nothing. */
  readonly refresh: (instanceId: string, task: (signal: AbortSignal) => Promise<readonly string[]>) => Promise<readonly string[] | undefined>
  readonly record: (input: { readonly instanceId: string; readonly route: KeyedRoute; readonly modelIds: readonly string[] }) => void
  readonly forget: (instanceId: string) => void
  readonly retain: (matches: (input: { readonly instanceId: string; readonly route: KeyedRoute }) => boolean) => void
}

export class ModelCatalogsPromiseModel {
  static readonly facade = (catalogs: ModelCatalogs['Service'], services: Context.Context<never>): ModelCatalogsPromise => {
    const run = Effect.runPromiseWith(services)
    const sync = Effect.runSyncWith(services)
    return {
      discovered: catalogs.discovered,
      refresh: (instanceId, task) =>
        run(
          Effect.flatMap(
            catalogs.start(
              instanceId,
              Effect.tryPromise({ try: signal => task(signal), catch: cause => new ModelCatalogRefreshFailed({ instanceId, cause }) }),
            ),
            fiber => Effect.map(Fiber.await(fiber), exit => Option.getOrUndefined(Exit.isSuccess(exit) ? exit.value : Option.none())),
          ),
        ),
      record: input => sync(catalogs.record(input)),
      forget: instanceId => sync(catalogs.forget(instanceId)),
      retain: matches => sync(catalogs.retain(matches)),
    }
  }
}
