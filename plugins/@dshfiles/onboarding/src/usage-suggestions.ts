import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { usageApi } from '@dshfiles/usage/api'
import { Clock, Context, Duration, Effect, Layer, Ref, Semaphore } from 'effect'
import type { FeatureCatalog } from './catalog-model.js'
import { SUGGESTION_DAYS, SuggestionsModel, type Suggestions } from './suggestions-model.js'

const READY_TTL = Duration.minutes(10)
const FAILED_TTL = Duration.seconds(5)
const DAY_MS = 24 * 60 * 60 * 1_000

const NO_USAGE: Suggestions = {
  state: 'no-usage',
  reason:
    'Suggestions read local tool use from the Usage plugin, which is not running on this Host. Enable it in Settings › Plugins (it is in the Observe & perf pack), then try again.',
}

const unreadable = (detail: string): Suggestions => ({
  state: 'unreadable',
  reason: `The Usage plugin did not answer (${detail}). Open Usage to check its index, then try again.`,
})

/**
 * Suggestions from local tool use, read through the Usage plugin's published API: two aggregate reports (tool and
 * command counts, request counts per purpose and thread) once per 10 minutes. No network, no model call; nothing is
 * read until `read` runs, and the caller runs it only while the `suggestions` setting is on.
 */
export class UsageSuggestions extends Context.Service<UsageSuggestions, { readonly read: Effect.Effect<Suggestions> }>()(
  '@dshfiles/onboarding/UsageSuggestions',
) {
  static readonly layerFrom = (input: { readonly catalog: FeatureCatalog }) =>
    Layer.effect(
      UsageSuggestions,
      Effect.gen(function* () {
        const apis = yield* HostApis

        const readUsage = Effect.gen(function* () {
          if (!(yield* apis.isServed(usageApi))) return NO_USAGE
          const usage = apis.client(usageApi)
          const to = yield* Clock.currentTimeMillis
          const [activity, charts] = yield* Effect.all(
            [
              usage.activity({ days: SUGGESTION_DAYS, limit: 100, eventLimit: 1 }),
              usage.charts({ from: to - SUGGESTION_DAYS * DAY_MS, to, bucket: 'day', groupBy: 'purpose', tzOffsetMinutes: 0 }),
            ],
            { concurrency: 'unbounded' },
          )
          const suggestions = SuggestionsModel.suggest({ catalog: input.catalog, signals: SuggestionsModel.signalsOf({ activity, charts }) })
          const ready: Suggestions = { state: 'ready', days: SUGGESTION_DAYS, suggestions }
          return ready
        }).pipe(
          Effect.catchTag('ApiCallError', error => Effect.succeed(error.kind === 'unavailable' ? NO_USAGE : unreadable(error.kind))),
          Effect.tap(value =>
            Effect.annotateCurrentSpan(
              value.state === 'ready'
                ? { 'onboarding.suggestions.state': value.state, 'onboarding.suggestions.count': value.suggestions.length }
                : { 'onboarding.suggestions.state': value.state },
            ),
          ),
          Effect.withSpan('onboarding suggestions read', { kind: 'client' }),
        )

        // Not an Effect Cache: its lookup would run under the span current at layer build, the ended `plugin activate`.
        const last = yield* Ref.make<{ readonly value: Suggestions; readonly until: number } | null>(null)
        const oneRead = yield* Semaphore.make(1)
        const read = oneRead.withPermit(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const cached = yield* Ref.get(last)
            if (cached !== null && now < cached.until) return cached.value
            const value = yield* readUsage
            // An absent or failing owner is asked again soon, so Try again after enabling Usage answers at once.
            const ttl = value.state === 'ready' ? READY_TTL : FAILED_TTL
            yield* Ref.set(last, { value, until: now + Duration.toMillis(ttl) })
            return value
          }),
        )

        return UsageSuggestions.of({ read })
      }),
    )
}
