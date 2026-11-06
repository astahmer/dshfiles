import { describe, expect, it } from 'vitest'
import type { AccountConnectionSnapshot } from './api.js'
import { joiningOf, statusOf, transition, type SetupEvent, type SetupPhase } from './account-setup-phase.js'

const work = (): Promise<AccountConnectionSnapshot> => Promise.resolve({} as AccountConnectionSnapshot)

const pending = (): SetupPhase => ({ kind: 'pending' })
const configuring = (): SetupPhase => ({ kind: 'configuring', configuration: work() })
const verifying = (): SetupPhase => ({ kind: 'verifying', completion: work() })
const committing = (): SetupPhase => ({ kind: 'committing', completion: work() })
const discarded = (): SetupPhase => ({ kind: 'discarded', joining: undefined, cleaned: false, cleanup: undefined, resourceCleanup: undefined })

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
    expect(transition(pending(), { kind: 'configure', configuration })).toEqual({ kind: 'configuring', configuration })
    expect(transition(configuring(), { kind: 'configured' })).toEqual({ kind: 'pending' })
    expect(transition(configuring(), { kind: 'verify', completion: work() })).toEqual(configuring())
    expect(transition(configuring(), { kind: 'commit' })).toEqual(configuring())
  })

  it('carries the completion promise through verification into the accepted commit', () => {
    const completion = work()
    const verifyingPhase = transition(pending(), { kind: 'verify', completion })
    expect(verifyingPhase).toEqual({ kind: 'verifying', completion })
    expect(transition(verifyingPhase, { kind: 'commit' })).toEqual({ kind: 'committing', completion })
    expect(transition(committing(), { kind: 'committed' })).toEqual({ kind: 'complete' })
  })

  it('returns a failed commit to pending for a retry, dropping its rejected completion', () => {
    const retried = transition(committing(), { kind: 'commitFailed' })
    expect(retried).toEqual({ kind: 'pending' })
    expect(statusOf(retried)).toBe('pending')
  })

  it('never discards an accepted commit or a committed connection', () => {
    expect(transition(committing(), { kind: 'discard' })).toEqual(committing())
    expect(transition({ kind: 'complete' }, { kind: 'discard' })).toEqual({ kind: 'complete' })
    expect(transition({ kind: 'complete' }, { kind: 'cleaned' })).toEqual({ kind: 'complete' })
  })

  it('keeps the abandoned work on a discard so cleanup can join it', () => {
    const configuration = work()
    const abandoned = transition({ kind: 'configuring', configuration }, { kind: 'discard' })
    expect(abandoned).toMatchObject({ kind: 'discarded', cleaned: false })
    expect(joiningOf(abandoned)).toBe(configuration)
  })

  it('marks a discarded operation cleaned at most once', () => {
    const discardedPhase = transition(discarded(), { kind: 'cleaned' })
    expect(discardedPhase).toMatchObject({ kind: 'discarded', cleaned: true })
    expect(transition(discardedPhase, { kind: 'cleaned' })).toBe(discardedPhase)
  })

  it('ignores every event once an operation is complete or discarded', () => {
    for (const terminal of [{ kind: 'complete' } as SetupPhase, { ...discarded(), cleaned: true } as SetupPhase]) {
      for (const event of events) expect(transition(terminal, event)).toBe(terminal)
    }
  })

  it('reports the public status of every phase', () => {
    expect(statusOf(pending())).toBe('pending')
    expect(statusOf(configuring())).toBe('pending')
    expect(statusOf(verifying())).toBe('verifying')
    expect(statusOf(committing())).toBe('verifying')
    expect(statusOf({ kind: 'complete' })).toBe('complete')
    expect(statusOf(discarded())).toBe('discarded')
  })
})
