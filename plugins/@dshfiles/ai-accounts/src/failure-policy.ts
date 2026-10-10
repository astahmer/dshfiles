import { z } from 'zod'

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

const kindPolicySchema = (fallback: KindPolicy) =>
  z
    .object({
      retries: z.number().int().min(0).max(10).catch(fallback.retries),
      backoffMs: z.number().int().min(100).max(MAX_BACKOFF_MS).catch(fallback.backoffMs),
      lunaReserve: z.boolean().catch(fallback.lunaReserve),
      failover: z.boolean().catch(fallback.failover),
      waitSeconds: z.number().int().min(0).max(3_600).catch(fallback.waitSeconds),
      shrink: z.boolean().catch(fallback.shrink),
      then: z.enum(['fail', 'dsh']).catch(fallback.then),
    })
    .catch(fallback)

/** Stored settings decoded once; a missing or malformed field keeps its default, so older settings still load. */
export const recoveryPolicySchema = z
  .object({
    transport: kindPolicySchema(DEFAULT_RECOVERY_POLICY.transport),
    rateLimit: kindPolicySchema(DEFAULT_RECOVERY_POLICY.rateLimit),
    exhausted: kindPolicySchema(DEFAULT_RECOVERY_POLICY.exhausted),
    auth: kindPolicySchema(DEFAULT_RECOVERY_POLICY.auth),
    oversized: kindPolicySchema(DEFAULT_RECOVERY_POLICY.oversized),
  })
  .catch(DEFAULT_RECOVERY_POLICY)

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
