import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Cause, Clock, Context, Duration, Effect, FileSystem, Layer, Option, Path, Ref, Schedule, Schema, Semaphore } from 'effect'
import { HttpClient, HttpClientError, HttpClientRequest } from 'effect/http'
import { AccountSettings } from './account-settings-service.js'
import { AccountsPlatformLive } from './platform-layer.js'
import { MODELS_DEV_URL, PricingCatalogModel, type PricingCache, type PricingStatus } from './pricing-catalog.js'

const FETCH_TIMEOUT = Duration.seconds(30)
/** The refresh period is in hours; checking twice an hour keeps a lowered setting honest. */
const CHECK_EVERY = Duration.minutes(30)
const RETRY_SCHEDULE = Schedule.exponential('200 millis').pipe(Schedule.jittered)
const HOUR_MS = 3_600_000

/** models.dev could not be read: the request failed, answered an error, returned nothing priced, or could not be stored. */
export class PricingRefreshFailed extends Schema.TaggedError<PricingRefreshFailed>()('PricingRefreshFailed', {
  reason: Schema.Literals(['request', 'status', 'empty', 'store']),
  status: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    if (this.reason === 'status') return `models.dev answered ${String(this.status)}`
    if (this.reason === 'empty') return 'models.dev returned no priced models'
    if (this.reason === 'store') return 'The price catalog could not be written'
    return 'models.dev could not be read'
  }
}

const decodeStoredCatalog = Schema.decodeUnknownOption(Schema.fromJsonString(PricingCatalogModel.cacheSchema))

interface PricingState {
  readonly catalog: Option.Option<PricingCache>
  readonly lastError: Option.Option<string>
  readonly refreshing: boolean
}

const emptyState: PricingState = { catalog: Option.none(), lastError: Option.none(), refreshing: false }

/**
 * Model prices from models.dev, cached on disk so a cold or offline Host still prices with the last catalog it saw.
 * One fetch runs at a time; a failed one keeps the previous catalog and records why, which the settings page shows.
 * `snapshot` and `snapshotStatus` are synchronous because stream pricing asks on every chunk.
 */
export class PricingCatalog extends Context.Service<
  PricingCatalog,
  {
    readonly snapshot: () => PricingCache | null
    readonly snapshotStatus: () => PricingStatus
    readonly refresh: Effect.Effect<PricingStatus>
    /** Fetch only once the cached catalog is older than `maxAgeMs`. */
    readonly ensureFresh: (maxAgeMs: number) => Effect.Effect<void>
    readonly load: Effect.Effect<void>
  }
>()('@dshfiles/ai-accounts/PricingCatalog') {
  static readonly make = Effect.fnUntraced(function* (input: {
    readonly path: string
    readonly url?: string
    /** models.dev retries twice on a transient failure on the live Host; a test that scripts a response skips them. */
    readonly retry?: boolean
  }) {
    const base = yield* HttpClient.HttpClient
    const client = input.retry === false ? base : base.pipe(HttpClient.retryTransient({ retryOn: 'errors-and-responses', times: 2, schedule: RETRY_SCHEDULE }))
    const fs = yield* FileSystem.FileSystem
    const paths = yield* Path.Path
    const state = yield* Ref.make(emptyState)
    const claim = yield* Semaphore.make(1)
    const url = input.url ?? MODELS_DEV_URL

    const statusOf = (current: PricingState): PricingStatus => ({
      fetchedAt: Option.match(current.catalog, { onNone: () => null, onSome: catalog => catalog.fetchedAt }),
      source: Option.match(current.catalog, { onNone: () => url, onSome: catalog => catalog.source }),
      modelCount: Option.match(current.catalog, {
        onNone: () => 0,
        onSome: catalog => Object.values(catalog.providers).reduce((sum, models) => sum + Object.keys(models).length, 0),
      }),
      refreshing: current.refreshing,
      lastError: Option.getOrNull(current.lastError),
    })

    const store = Effect.fnUntraced(function* (next: PricingCache) {
      const temporary = `${input.path}.${String(process.pid)}.tmp`
      yield* fs.makeDirectory(paths.dirname(input.path), { recursive: true })
      yield* fs.writeFileString(temporary, JSON.stringify(next))
      yield* fs.rename(temporary, input.path)
    })

    const fetchCatalog = Effect.gen(function* () {
      const response = yield* client
        .execute(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeader('accept', 'application/json'),
            HttpClientRequest.setHeader('user-agent', 'dshfiles-ai-accounts'),
          ),
        )
        .pipe(
          Effect.timeout(FETCH_TIMEOUT),
          Effect.catchTag('TimeoutError', cause => Effect.fail(new PricingRefreshFailed({ reason: 'request', cause }))),
          Effect.catchIf(HttpClientError.isHttpClientError, cause =>
            Effect.fail(
              cause.response === undefined
                ? new PricingRefreshFailed({ reason: 'request', cause })
                : new PricingRefreshFailed({ reason: 'status', status: cause.response.status, cause }),
            ),
          ),
        )
      if (response.status < 200 || response.status >= 300) return yield* new PricingRefreshFailed({ reason: 'status', status: response.status })
      const body = yield* response.json.pipe(Effect.mapError(cause => new PricingRefreshFailed({ reason: 'request', cause })))
      const next = PricingCatalogModel.trimModelsDev(body, yield* Clock.currentTimeMillis)
      if (Object.keys(next.providers).length === 0) return yield* new PricingRefreshFailed({ reason: 'empty' })
      yield* store(next).pipe(Effect.mapError(cause => new PricingRefreshFailed({ reason: 'store', cause })))
      yield* Ref.set(state, { catalog: Option.some(next), lastError: Option.none(), refreshing: false })
    }).pipe(Effect.withSpan('ai-accounts pricing fetch'))

    const refresh = claim
      .withPermits(1)(
        Effect.gen(function* () {
          yield* Ref.update(state, current => ({ ...current, refreshing: true }))
          const failure = yield* Effect.flip(fetchCatalog).pipe(Effect.option)
          if (Option.isSome(failure)) yield* Ref.update(state, current => ({ ...current, refreshing: false, lastError: Option.some(failure.value.message) }))
          return statusOf(yield* Ref.get(state))
        }),
      )
      .pipe(Effect.withSpan('ai-accounts pricing refresh'))

    const load = Effect.gen(function* () {
      const text = yield* fs.readFileString(input.path).pipe(Effect.option)
      if (Option.isNone(text)) return
      const parsed = decodeStoredCatalog(text.value)
      if (Option.isNone(parsed)) return
      const next = parsed.value
      yield* Ref.update(state, current =>
        Option.isSome(current.catalog) && current.catalog.value.fetchedAt >= next.fetchedAt ? current : { ...current, catalog: Option.some(next) },
      )
    }).pipe(Effect.withSpan('ai-accounts pricing catalog load'))

    const ensureFresh = (maxAgeMs: number) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (Option.isSome(current.catalog) && (yield* Clock.currentTimeMillis) - current.catalog.value.fetchedAt < maxAgeMs) return
        yield* refresh
      })

    return PricingCatalog.of({
      snapshot: () => Option.getOrNull(Ref.getUnsafe(state).catalog),
      snapshotStatus: () => statusOf(Ref.getUnsafe(state)),
      refresh,
      ensureFresh,
      load,
    })
  })

  static readonly layer = (input: { readonly path: string; readonly url?: string; readonly retry?: boolean }) =>
    Layer.effect(PricingCatalog, PricingCatalog.make(input))

  /** The service over the Host's own file system and `fetch`; a reader outside this plugin needs no platform wiring. */
  static readonly layerLive = (input: { readonly path: string; readonly url?: string }) => PricingCatalog.layer(input).pipe(Layer.provide(AccountsPlatformLive))

  /**
   * Loads the stored catalog once, then refreshes on the interval the account preferences name. Provide it merged with
   * `PricingCatalog.layer(input)` so both halves share one catalog instance.
   */
  static readonly scheduled = () =>
    Layer.effectDiscard(
      Effect.gen(function* () {
        const catalog = yield* PricingCatalog
        const settings = yield* AccountSettings
        yield* catalog.load
        const check = Effect.gen(function* () {
          const preferences = yield* settings.current
          if (!preferences.pricing.costEstimates) return
          yield* catalog.ensureFresh(preferences.pricing.pricingRefreshHours * HOUR_MS)
        }).pipe(Effect.catchCause(cause => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning('ai-accounts: pricing refresh failed'))))
        yield* DshxPlugin.worker(Effect.repeat(check, Schedule.spaced(CHECK_EVERY)))
      }),
    )
}

/** Reads a stored `pricing.json` with the schema the service writes; `undefined` when it is unreadable. */
export const decodeStoredPricing = (text: string): PricingCache | undefined => Option.getOrUndefined(decodeStoredCatalog(text))
