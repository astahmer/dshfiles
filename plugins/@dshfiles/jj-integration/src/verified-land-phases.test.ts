import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { VerifiedLandOutcome } from './thread-workspace-types.js'
import { LAND_ATTEMPTS, runVerifiedLand, type LandStepResult, type LandSettlement, type VerifiedLandSteps } from './verified-land-phases.js'

const landed: VerifiedLandOutcome = { status: 'nothing-to-land' }

const steps = (overrides: Partial<VerifiedLandSteps<null, number, number, never>> = {}): VerifiedLandSteps<null, number, number, never> => ({
  scan: () => Effect.succeed({ _tag: 'next', state: 1 }),
  rebase: () => Effect.succeed({ _tag: 'next', state: 2 }),
  verify: () => Effect.succeed({ _tag: 'next', state: 3 }),
  land: () => Effect.succeed({ _tag: 'stop', outcome: landed }),
  ...overrides,
})

const run = (phases: VerifiedLandSteps<null, number, number, never>, cancelled = false) =>
  Effect.runPromise(
    runVerifiedLand({
      cancelled: Effect.succeed(cancelled),
      cancelledOutcome: { status: 'verification-cancelled' },
      start: () => null,
      steps: phases,
    }),
  )

describe('runVerifiedLand', () => {
  it('runs scan, rebase, verify and land in order', async () => {
    const seen: string[] = []
    const phases = steps({
      scan: () => Effect.sync(() => (seen.push('scan'), { _tag: 'next' as const, state: 1 })),
      rebase: state => Effect.sync(() => (seen.push(`rebase:${String(state)}`), { _tag: 'next' as const, state: 2 })),
      verify: state => Effect.sync(() => (seen.push(`verify:${String(state)}`), { _tag: 'next' as const, state: 3 })),
      land: state => Effect.sync(() => (seen.push(`land:${String(state)}`), { _tag: 'stop' as const, outcome: landed })),
    })
    await expect(run(phases)).resolves.toEqual(landed)
    expect(seen).toEqual(['scan', 'rebase:1', 'verify:2', 'land:3'])
  })

  it('stops at the first step that refuses the attempt', async () => {
    const refusal: LandStepResult<number> = { _tag: 'stop', outcome: { status: 'not-eligible' } }
    await expect(run(steps({ rebase: () => Effect.succeed(refusal) }))).resolves.toEqual({ status: 'not-eligible' })
  })

  it('reruns the whole attempt while the bookmark keeps moving and gives up with the step message', async () => {
    let scans = 0
    const phases = steps({
      scan: () =>
        Effect.sync(() => {
          scans += 1
          return { _tag: 'restart' as const, exhausted: 'The bookmark moved during the scan.' }
        }),
    })
    await expect(run(phases)).resolves.toEqual({ status: 'verification-stale', message: 'The bookmark moved during the scan.' })
    expect(scans).toBe(LAND_ATTEMPTS)
  })

  it('retries the attempt that lands nothing when a restart arrives before the last attempt', async () => {
    let rebases = 0
    const phases = steps({
      rebase: state => {
        rebases += 1
        return Effect.succeed(rebases === 1 ? { _tag: 'restart', exhausted: 'The bookmark moved during rebase.' } : { _tag: 'next', state })
      },
    })
    await expect(run(phases)).resolves.toEqual(landed)
    expect(rebases).toBe(2)
  })

  it('lets a settlement restart the attempt and reports its message on the last one', async () => {
    const phases = steps({
      land: (): Effect.Effect<LandSettlement> => Effect.succeed({ _tag: 'restart', exhausted: 'The bookmark moved before landing.' }),
    })
    await expect(run(phases)).resolves.toEqual({ status: 'verification-stale', message: 'The bookmark moved before landing.' })
  })

  it('stops before scanning once the integration is cancelled', async () => {
    let scans = 0
    const phases = steps({ scan: () => Effect.sync(() => ((scans += 1), { _tag: 'next' as const, state: 1 })) })
    await expect(run(phases, true)).resolves.toEqual({ status: 'verification-cancelled' })
    expect(scans).toBe(0)
  })
})
