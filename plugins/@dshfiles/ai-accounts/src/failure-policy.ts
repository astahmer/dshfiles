import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

/**
 * What happens when a model request on an account route fails.
 *
 * Each failure kind runs the same ladder, skipping the rungs its policy turns
 * off: retry the same account, draw on Luna Reserve (Codex), fail over to the
 * next compatible account, wait out a provider-declared reset, resend without
 * re-sent images, then hand the failure to DSH's own recovery (`dsh`: the
 * built-in retry policy and compaction) or end the turn (`fail`).
 */
export const FAILURE_KINDS = ['transport', 'rateLimit', 'exhausted', 'auth', 'oversized'] as const
export type FailureKind = (typeof FAILURE_KINDS)[number]

export interface KindPolicy {
  readonly retries: number
  readonly backoffMs: number
  readonly lunaReserve: boolean
  readonly failover: boolean
  readonly waitSeconds: number
  readonly shrink: boolean
  readonly then: 'fail' | 'dsh'
}

export type RecoveryPolicy = Readonly<Record<FailureKind, KindPolicy>>

const quiet: KindPolicy = { retries: 0, backoffMs: 1_000, lunaReserve: false, failover: false, waitSeconds: 0, shrink: false, then: 'dsh' }

/**
 * Transport keeps the two retries DSH gave it and adds fail-over; auth and
 * oversized requests stay with DSH, whose compaction owns context overflow.
 */
export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  transport: { ...quiet, retries: 2, failover: true, then: 'fail' },
  rateLimit: { ...quiet, failover: true, waitSeconds: 60, then: 'fail' },
  exhausted: { ...quiet, lunaReserve: true, failover: true, then: 'fail' },
  auth: quiet,
  oversized: quiet,
}

/** The longest single backoff; a provider asking for more is waited out by the `wait` rung instead. */
const MAX_BACKOFF_MS = 60_000

const integerIn = (minimum: number, maximum: number) =>
  Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(minimum), Schema.isLessThanOrEqualTo(maximum))

const kindPolicyFields = {
  retries: integerIn(0, 10),
  backoffMs: integerIn(100, MAX_BACKOFF_MS),
  lunaReserve: Schema.Boolean,
  failover: Schema.Boolean,
  waitSeconds: integerIn(0, 3_600),
  shrink: Schema.Boolean,
  then: Schema.Literals(['fail', 'dsh']),
}

const kindPolicySchema = Schema.Struct(kindPolicyFields)

/** Every field may be missing or malformed and is then filled from `fallback`; a sibling field's value still applies. */
const lenientKindPolicySchema = (fallback: KindPolicy) =>
  Schema.Struct({
    retries: Schema.optional(kindPolicyFields.retries.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(fallback.retries))))),
    backoffMs: Schema.optional(kindPolicyFields.backoffMs.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(fallback.backoffMs))))),
    lunaReserve: Schema.optional(kindPolicyFields.lunaReserve.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(fallback.lunaReserve))))),
    failover: Schema.optional(kindPolicyFields.failover.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(fallback.failover))))),
    waitSeconds: Schema.optional(kindPolicyFields.waitSeconds.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(fallback.waitSeconds))))),
    shrink: Schema.optional(kindPolicyFields.shrink.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(fallback.shrink))))),
    then: Schema.optional(kindPolicyFields.then.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(fallback.then))))),
  })

const lenientRecoveryPolicySchema = Schema.Struct({
  transport: Schema.optional(
    lenientKindPolicySchema(DEFAULT_RECOVERY_POLICY.transport).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_RECOVERY_POLICY.transport)))),
  ),
  rateLimit: Schema.optional(
    lenientKindPolicySchema(DEFAULT_RECOVERY_POLICY.rateLimit).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_RECOVERY_POLICY.rateLimit)))),
  ),
  exhausted: Schema.optional(
    lenientKindPolicySchema(DEFAULT_RECOVERY_POLICY.exhausted).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_RECOVERY_POLICY.exhausted)))),
  ),
  auth: Schema.optional(
    lenientKindPolicySchema(DEFAULT_RECOVERY_POLICY.auth).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_RECOVERY_POLICY.auth)))),
  ),
  oversized: Schema.optional(
    lenientKindPolicySchema(DEFAULT_RECOVERY_POLICY.oversized).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_RECOVERY_POLICY.oversized)))),
  ),
})

type LenientRecoveryPolicy = typeof lenientRecoveryPolicySchema.Type

const fillKindPolicy = (value: LenientRecoveryPolicy['transport'], fallback: KindPolicy): KindPolicy => ({
  retries: value?.retries ?? fallback.retries,
  backoffMs: value?.backoffMs ?? fallback.backoffMs,
  lunaReserve: value?.lunaReserve ?? fallback.lunaReserve,
  failover: value?.failover ?? fallback.failover,
  waitSeconds: value?.waitSeconds ?? fallback.waitSeconds,
  shrink: value?.shrink ?? fallback.shrink,
  then: value?.then ?? fallback.then,
})

const strictRecoveryPolicySchema = Schema.Struct({
  transport: kindPolicySchema,
  rateLimit: kindPolicySchema,
  exhausted: kindPolicySchema,
  auth: kindPolicySchema,
  oversized: kindPolicySchema,
})

/** Stored settings decoded once; a missing or malformed field keeps its default, so older settings still load. */
export const recoveryPolicySchema = lenientRecoveryPolicySchema.pipe(
  Schema.decodeTo(strictRecoveryPolicySchema, {
    decode: SchemaGetter.transform((value: LenientRecoveryPolicy) => ({
      transport: fillKindPolicy(value.transport, DEFAULT_RECOVERY_POLICY.transport),
      rateLimit: fillKindPolicy(value.rateLimit, DEFAULT_RECOVERY_POLICY.rateLimit),
      exhausted: fillKindPolicy(value.exhausted, DEFAULT_RECOVERY_POLICY.exhausted),
      auth: fillKindPolicy(value.auth, DEFAULT_RECOVERY_POLICY.auth),
      oversized: fillKindPolicy(value.oversized, DEFAULT_RECOVERY_POLICY.oversized),
    })),
    encode: SchemaGetter.transform((value: typeof strictRecoveryPolicySchema.Type) => value),
  }),
  Schema.catchDecoding(() => Effect.succeed(Option.some(DEFAULT_RECOVERY_POLICY))),
)

/** How far one failure kind has climbed its ladder within one step. */
export interface RecoveryProgress {
  readonly retries: number
  readonly lunaReserve: boolean
  readonly failovers: number
  readonly waited: boolean
  readonly shrunk: boolean
}

export const NO_PROGRESS: RecoveryProgress = { retries: 0, lunaReserve: false, failovers: 0, waited: false, shrunk: false }

export type RecoveryStep =
  | { readonly kind: 'retry'; readonly delayMs: number }
  | { readonly kind: 'luna-reserve' }
  | { readonly kind: 'failover'; readonly to: string }
  | { readonly kind: 'wait'; readonly delayMs: number }
  | { readonly kind: 'shrink' }
  | { readonly kind: 'give-up'; readonly then: 'fail' | 'dsh' }

/**
 * The next rung for one failure. A Luna Reserve switch or a fail-over lands on
 * a different quota, so the same-account retries start over there.
 */
export const decideRecovery = (input: {
  readonly policy: KindPolicy
  readonly progress: RecoveryProgress
  readonly retryAfterMs: number | undefined
  readonly lunaReserveAvailable: boolean
  readonly failoverTo: string | undefined
  readonly canShrink: boolean
}): { readonly step: RecoveryStep; readonly progress: RecoveryProgress } => {
  const { policy, progress } = input
  const retryAfterMs = input.retryAfterMs !== undefined && Number.isFinite(input.retryAfterMs) && input.retryAfterMs > 0 ? input.retryAfterMs : undefined
  if (progress.retries < policy.retries) {
    const backoff = Math.min(policy.backoffMs * 2 ** progress.retries, MAX_BACKOFF_MS)
    const delayMs = retryAfterMs !== undefined && retryAfterMs > backoff && retryAfterMs <= MAX_BACKOFF_MS ? retryAfterMs : backoff
    return { step: { kind: 'retry', delayMs }, progress: { ...progress, retries: progress.retries + 1 } }
  }
  if (policy.lunaReserve && !progress.lunaReserve && input.lunaReserveAvailable) {
    return { step: { kind: 'luna-reserve' }, progress: { ...progress, lunaReserve: true, retries: 0 } }
  }
  if (policy.failover && input.failoverTo !== undefined) {
    return { step: { kind: 'failover', to: input.failoverTo }, progress: { ...progress, failovers: progress.failovers + 1, retries: 0 } }
  }
  const waitMs = policy.waitSeconds * 1_000
  if (waitMs > 0 && !progress.waited && (retryAfterMs === undefined || retryAfterMs <= waitMs)) {
    return { step: { kind: 'wait', delayMs: retryAfterMs ?? waitMs }, progress: { ...progress, waited: true } }
  }
  if (policy.shrink && !progress.shrunk && input.canShrink) {
    return { step: { kind: 'shrink' }, progress: { ...progress, shrunk: true } }
  }
  return { step: { kind: 'give-up', then: policy.then }, progress }
}
