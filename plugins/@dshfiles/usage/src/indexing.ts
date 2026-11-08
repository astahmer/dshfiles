import { Clock, Context, Effect, FiberHandle, Layer, Option, Ref } from 'effect'
import type { indexStatusSchema } from './api.js'
import { IndexPassFailed, type UsageStoreFailed } from './errors.js'
import type { ToolSourceMetadata } from './fold.js'
import { SessionLogIndex } from './indexer.js'
import { Pricing } from './pricing.js'
import { UsageRepo } from './store.js'
import { toolSourceSnapshotsEqual } from './tool-source-snapshots.js'

const MAX_ERROR_LENGTH = 500
/** How long after the last read a periodic catch-up pass stays worth running. */
const DEMAND_WINDOW_MS = 5 * 60_000

export type IndexStatus = typeof indexStatusSchema.Type

/** The tool registry's name → source and owner, so tool rows land in the right category; None while it is unavailable. */
export class ToolRegistry extends Context.Service<ToolRegistry, { readonly snapshot: Effect.Effect<Option.Option<ReadonlyMap<string, ToolSourceMetadata>>> }>()(
  '@dshfiles/usage/ToolRegistry',
) {}

const failedAt =
  (step: IndexPassFailed['step']) =>
  (cause: { readonly message: string }): IndexPassFailed =>
    new IndexPassFailed({ step, reason: cause.message.slice(0, 400), cause })

/**
 * One index pass at a time: prune old telemetry, sync tool sources, fold what the session logs gained, reconcile live
 * calls and re-price. A refresh that arrives during a pass joins it instead of starting another; the pass runs in the
 * Indexer's scope, so an aborted refresh never cuts a pass short.
 */
export class Indexer extends Context.Service<
  Indexer,
  {
    readonly pass: Effect.Effect<void>
    readonly status: Effect.Effect<IndexStatus, UsageStoreFailed>
    /** Mark that someone is reading the ledger, so the periodic catch-up pass is worth running. */
    readonly touch: Effect.Effect<void>
    /** Whether a read happened inside the demand window: closed panels do not keep the indexer running. */
    readonly demanded: Effect.Effect<boolean>
  }
>()('@dshfiles/usage/Indexer') {
  static readonly layer = (input: { readonly sessionsRoot: string }) =>
    Layer.effect(
      Indexer,
      Effect.gen(function* () {
        const repo = yield* UsageRepo
        const logs = yield* SessionLogIndex
        const pricing = yield* Pricing
        const registry = yield* ToolRegistry
        const running = yield* FiberHandle.make<void, never>()
        // The panel is the only reason to fold session logs periodically: no read in this window means nobody is looking.
        const demand = yield* Ref.make(0)
        const outcome = yield* Ref.make<{ readonly lastIndexedAt: number | null; readonly lastError: string | null }>({ lastIndexedAt: null, lastError: null })
        const syncedToolSources = yield* Ref.make(Option.none<ReadonlyMap<string, ToolSourceMetadata>>())

        const syncToolSources = Effect.gen(function* () {
          const snapshot = yield* registry.snapshot
          if (Option.isNone(snapshot)) return Option.none<ReadonlyMap<string, ToolSourceMetadata>>()
          const previous = Option.getOrUndefined(yield* Ref.get(syncedToolSources))
          if (toolSourceSnapshotsEqual({ previous, next: snapshot.value })) return snapshot
          yield* repo.syncToolSources(new Map([...snapshot.value].map(([name, source]) => [name, { category: source.source, owner: source.owner }] as const)))
          yield* Ref.set(syncedToolSources, snapshot)
          return snapshot
        })

        const runPass = Effect.fn('usage index pass')(function* () {
          yield* repo.pruneTelemetry(yield* Clock.currentTimeMillis).pipe(Effect.mapError(failedAt('prune')))
          const toolSources = yield* syncToolSources.pipe(Effect.mapError(failedAt('tool-sources')))
          yield* logs
            .indexAll({ root: input.sessionsRoot, ...(Option.isSome(toolSources) && { toolSources: toolSources.value }) })
            .pipe(Effect.mapError(failedAt('session-logs')))
          yield* repo.reconcileLiveCalls(yield* Clock.currentTimeMillis).pipe(Effect.mapError(failedAt('reconcile')))
          yield* pricing.update.pipe(Effect.mapError(failedAt('pricing')))
          const indexedAt = yield* Clock.currentTimeMillis
          yield* Ref.set(outcome, { lastIndexedAt: indexedAt, lastError: null })
        })

        const recorded = runPass().pipe(
          Effect.catchTag('IndexPassFailed', error =>
            Ref.update(outcome, current => ({ ...current, lastError: error.message.slice(0, MAX_ERROR_LENGTH) })).pipe(
              Effect.andThen(Effect.logWarning('usage: indexing pass failed', error.message)),
            ),
          ),
        )

        return Indexer.of({
          pass: FiberHandle.run(running, recorded, { onlyIfMissing: true }).pipe(Effect.andThen(FiberHandle.awaitEmpty(running))),
          touch: Ref.set(demand, Date.now()),
          demanded: Ref.get(demand).pipe(Effect.map(at => Date.now() - at <= DEMAND_WINDOW_MS)),
          status: Effect.gen(function* () {
            const counts = yield* repo.counts
            const current = yield* Ref.get(outcome)
            const indexing = Option.isSome(yield* FiberHandle.get(running))
            return {
              indexedFiles: counts.files,
              requests: counts.requests,
              lastIndexedAt: current.lastIndexedAt,
              indexing,
              pricingFetchedAt: yield* pricing.fetchedAt,
              lastError: current.lastError,
            }
          }),
        })
      }),
    )
}
