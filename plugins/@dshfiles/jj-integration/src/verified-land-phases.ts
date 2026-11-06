import { Effect } from 'effect'
import type { VerifiedLandOutcome } from './thread-workspace-types.js'

/** How many whole attempts one automatic integration gets when another writer keeps moving the bookmark. */
export const LAND_ATTEMPTS = 3

/** The steps every backend runs, in this order, for each landing attempt. */
export const VERIFIED_LAND_PHASES = ['scan', 'rebase', 'verify', 'land'] as const
export type VerifiedLandPhase = (typeof VERIFIED_LAND_PHASES)[number]

export type LandStepResult<State> =
  | { readonly _tag: 'next'; readonly state: State }
  | { readonly _tag: 'restart'; readonly exhausted: string }
  | { readonly _tag: 'stop'; readonly outcome: VerifiedLandOutcome }

/** Settling cannot fall through: the last step either lands, refuses, or asks for another attempt. */
export type LandSettlement = { readonly _tag: 'restart'; readonly exhausted: string } | { readonly _tag: 'stop'; readonly outcome: VerifiedLandOutcome }

export interface VerifiedLandSteps<Base, Scanned, Rebased, E> {
  readonly scan: (base: Base, attempt: number) => Effect.Effect<LandStepResult<Scanned>, E>
  readonly rebase: (scanned: Scanned, attempt: number) => Effect.Effect<LandStepResult<Rebased>, E>
  readonly verify: (rebased: Rebased, attempt: number) => Effect.Effect<LandStepResult<Rebased>, E>
  readonly land: (verified: Rebased, attempt: number) => Effect.Effect<LandSettlement, E>
}

export const verifiedLandStale = (message: string): VerifiedLandOutcome => ({ status: 'verification-stale', message })

/** One restart per attempt; the attempt that would follow the last one reports why it gave up instead. */
const restart = (attempt: number, exhausted: string): VerifiedLandOutcome | undefined => (attempt >= LAND_ATTEMPTS ? verifiedLandStale(exhausted) : undefined)

/**
 * Run each attempt's scan, rebase, verify and land steps in order. A step that reports the bookmark moved forward
 * starts the whole attempt again, and the last attempt turns that into a stale outcome with the step's own message.
 */
export const runVerifiedLand = <Base, Scanned, Rebased, E>(input: {
  readonly cancelled: Effect.Effect<boolean>
  readonly cancelledOutcome: VerifiedLandOutcome
  readonly start: () => Base
  readonly steps: VerifiedLandSteps<Base, Scanned, Rebased, E>
}): Effect.Effect<VerifiedLandOutcome, E> =>
  Effect.gen(function* () {
    let attempt = 1
    while (true) {
      if (yield* input.cancelled) return input.cancelledOutcome
      const scanResult = yield* input.steps.scan(input.start(), attempt)
      if (scanResult._tag === 'stop') return scanResult.outcome
      if (scanResult._tag === 'restart') {
        const exhausted = restart(attempt, scanResult.exhausted)
        if (exhausted !== undefined) return exhausted
        attempt += 1
        continue
      }
      const rebaseResult = yield* input.steps.rebase(scanResult.state, attempt)
      if (rebaseResult._tag === 'stop') return rebaseResult.outcome
      if (rebaseResult._tag === 'restart') {
        const exhausted = restart(attempt, rebaseResult.exhausted)
        if (exhausted !== undefined) return exhausted
        attempt += 1
        continue
      }
      const verifyResult = yield* input.steps.verify(rebaseResult.state, attempt)
      if (verifyResult._tag === 'stop') return verifyResult.outcome
      if (verifyResult._tag === 'restart') {
        const exhausted = restart(attempt, verifyResult.exhausted)
        if (exhausted !== undefined) return exhausted
        attempt += 1
        continue
      }
      const settlement = yield* input.steps.land(verifyResult.state, attempt)
      if (settlement._tag === 'stop') return settlement.outcome
      const exhausted = restart(attempt, settlement.exhausted)
      if (exhausted !== undefined) return exhausted
      attempt += 1
    }
  })
