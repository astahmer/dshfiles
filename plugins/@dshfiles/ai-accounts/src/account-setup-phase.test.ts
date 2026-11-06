import { describe, expect, it } from 'vitest'
import type { AccountConnectionSnapshot } from './api.js'
import { AccountSetupPhaseModel, type SetupEvent, type SetupPhase } from './account-setup-phase.js'

// SAFETY: the phase model only joins or discards this work, never reading the snapshot it resolves.
const work = (): Promise<AccountConnectionSnapshot> => Promise.resolve({} as AccountConnectionSnapshot)

const pending = (): SetupPhase => ({ kind: 'pending' })
const configuring = (): SetupPhase => ({ kind: 'configuring', configuration: work() })
const verifying = (): SetupPhase => ({ kind: 'verifying', completion: work() })
const committing = (): SetupPhase => ({ kind: 'committing', completion: work() })
type DiscardedPhase = Extract<SetupPhase, { kind: 'discarded' }>
const discarded = (): DiscardedPhase => ({ kind: 'discarded', joining: undefined, cleaned: false, cleanup: undefined, resourceCleanup: undefined })

const events: readonly SetupEvent[] = [
  { kind: 'configure', configuration: work() },
  { kind: 'configured' },
  { kind: 'verify', completion: work() },
  { kind: 'commit' },
  { kind: 'committed' },
  { kind: 'commitFailed' },
  { kind: 'discard' },
  { kind: 'cleaned' },
]

describe('account setup operation phase', () => {
  it('moves pending to configuring and back, so verification and commit wait for the configuration', () => {
    const configuration = work()
    expect(AccountSetupPhaseModel.transition(pending(), { kind: 'configure', configuration })).toEqual({ kind: 'configuring', configuration })
    expect(AccountSetupPhaseModel.transition(configuring(), { kind: 'configured' })).toEqual({ kind: 'pending' })
    expect(AccountSetupPhaseModel.transition(configuring(), { kind: 'verify', completion: work() })).toEqual(configuring())
    expect(AccountSetupPhaseModel.transition(configuring(), { kind: 'commit' })).toEqual(configuring())
  })

  it('carries the completion promise through verification into the accepted commit', () => {
    const completion = work()
    const verifyingPhase = AccountSetupPhaseModel.transition(pending(), { kind: 'verify', completion })
    expect(verifyingPhase).toEqual({ kind: 'verifying', completion })
    expect(AccountSetupPhaseModel.transition(verifyingPhase, { kind: 'commit' })).toEqual({ kind: 'committing', completion })
    expect(AccountSetupPhaseModel.transition(committing(), { kind: 'committed' })).toEqual({ kind: 'complete' })
  })

  it('returns a failed commit to pending for a retry, dropping its rejected completion', () => {
    const retried = AccountSetupPhaseModel.transition(committing(), { kind: 'commitFailed' })
    expect(retried).toEqual({ kind: 'pending' })
    expect(AccountSetupPhaseModel.statusOf(retried)).toBe('pending')
  })

  it('never discards an accepted commit or a committed connection', () => {
    expect(AccountSetupPhaseModel.transition(committing(), { kind: 'discard' })).toEqual(committing())
    expect(AccountSetupPhaseModel.transition({ kind: 'complete' }, { kind: 'discard' })).toEqual({ kind: 'complete' })
    expect(AccountSetupPhaseModel.transition({ kind: 'complete' }, { kind: 'cleaned' })).toEqual({ kind: 'complete' })
  })

  it('keeps the abandoned work on a discard so cleanup can join it', () => {
    const configuration = work()
    const abandoned = AccountSetupPhaseModel.transition({ kind: 'configuring', configuration }, { kind: 'discard' })
    expect(abandoned).toMatchObject({ kind: 'discarded', cleaned: false })
    expect(AccountSetupPhaseModel.joiningOf(abandoned)).toBe(configuration)
  })

  it('marks a discarded operation cleaned at most once', () => {
    const discardedPhase = AccountSetupPhaseModel.transition(discarded(), { kind: 'cleaned' })
    expect(discardedPhase).toMatchObject({ kind: 'discarded', cleaned: true })
    expect(AccountSetupPhaseModel.transition(discardedPhase, { kind: 'cleaned' })).toBe(discardedPhase)
  })

  it('ignores every event once an operation is complete or discarded', () => {
    const terminals: readonly SetupPhase[] = [{ kind: 'complete' }, { ...discarded(), cleaned: true }]
    for (const terminal of terminals) {
      for (const event of events) expect(AccountSetupPhaseModel.transition(terminal, event)).toBe(terminal)
    }
  })

  it('reports the public status of every phase', () => {
    expect(AccountSetupPhaseModel.statusOf(pending())).toBe('pending')
    expect(AccountSetupPhaseModel.statusOf(configuring())).toBe('pending')
    expect(AccountSetupPhaseModel.statusOf(verifying())).toBe('verifying')
    expect(AccountSetupPhaseModel.statusOf(committing())).toBe('verifying')
    expect(AccountSetupPhaseModel.statusOf({ kind: 'complete' })).toBe('complete')
    expect(AccountSetupPhaseModel.statusOf(discarded())).toBe('discarded')
  })
})
