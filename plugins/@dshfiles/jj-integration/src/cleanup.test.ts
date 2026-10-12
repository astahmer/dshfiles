import { describe, expect, it } from 'vitest'
import { decideCleanup, describeAge, isDisposableWorkspacePath, type CleanupInputs } from './cleanup.js'

const day = 86_400_000
const now = 10 * day

const policy = { enabled: true, idleAfterMs: day, deleteAfterMs: 7 * day, dryRun: false }

const inputs = (overrides: Partial<CleanupInputs> = {}): CleanupInputs => ({
  workspace: {
    name: 'dshfiles-threads/topic',
    isolated: true,
    pinned: false,
    lifecycle: 'idle',
    missing: false,
    writerLease: null,
    observers: [],
    owners: [{ sessionId: 'session-a', attachedAt: 1, detachedAt: 2, source: 'agent-tool' }],
    lastActivityAt: now - 8 * day,
  },
  now,
  policy,
  pendingIntegration: false,
  quarantined: false,
  uncommitted: false,
  uniqueRevisions: false,
  ...overrides,
})

describe('workspace cleanup eligibility', () => {
  it('removes nothing while cleanup is disabled', () => {
    expect(decideCleanup(inputs({ policy: { ...policy, enabled: false } }))).toMatchObject({ kind: 'skip', code: 'disabled' })
  })

  it('never considers a checkout it merely discovered', () => {
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, isolated: false } }))).toMatchObject({ kind: 'skip', code: 'not-isolated' })
  })

  it('honours a pin above every age rule', () => {
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, pinned: true } }))).toMatchObject({ kind: 'skip', code: 'pinned' })
  })

  it('protects work and coordination that would be lost', () => {
    expect(decideCleanup(inputs({ pendingIntegration: true }))).toMatchObject({ code: 'pending-integration' })
    expect(decideCleanup(inputs({ quarantined: true }))).toMatchObject({ code: 'quarantined' })
    expect(decideCleanup(inputs({ uncommitted: true }))).toMatchObject({ code: 'uncommitted' })
    expect(decideCleanup(inputs({ uniqueRevisions: true }))).toMatchObject({ code: 'unique-revisions' })
  })

  it('protects a live lease, an observer, an attached Session and a lifecycle in flight', () => {
    const lease = { sessionId: 'session-b', epoch: 2, acquiredAt: 1, heartbeatAt: now, host: null }
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, writerLease: lease } }))).toMatchObject({ code: 'leased' })
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, observers: [{ sessionId: 'session-c', since: 1 }] } }))).toMatchObject({
      code: 'observed',
    })
    expect(
      decideCleanup(inputs({ workspace: { ...inputs().workspace, owners: [{ sessionId: 'a', attachedAt: 1, detachedAt: null, source: 'agent-tool' }] } })),
    ).toMatchObject({ code: 'attached' })
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, lifecycle: 'ready' } }))).toMatchObject({ code: 'lifecycle' })
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, lifecycle: 'integrating' } }))).toMatchObject({ code: 'lifecycle' })
  })

  it('leaves a registration whose directory is gone for the operator', () => {
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, missing: true } }))).toMatchObject({ code: 'missing' })
  })

  it('reports idle before eligible, on the configured thresholds', () => {
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, lastActivityAt: now - 2 * day } }))).toMatchObject({ kind: 'idle', code: 'ok' })
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, lastActivityAt: now - 8 * day } }))).toMatchObject({ kind: 'eligible', code: 'ok' })
  })

  it('holds a workspace younger than the idle threshold', () => {
    expect(decideCleanup(inputs({ workspace: { ...inputs().workspace, lastActivityAt: now - 3_600_000 } }))).toMatchObject({ kind: 'skip', code: 'too-young' })
  })

  it('states the age it decided from', () => {
    expect(describeAge(3_600_000)).toBe('1h')
    expect(describeAge(90 * 60_000)).toBe('1h')
    expect(describeAge(8 * day)).toBe('8d')
  })
})

describe('disposable path guard', () => {
  it('accepts a sibling thread workspace', () => {
    expect(isDisposableWorkspacePath('/Users/x/dev/dshfiles-threads/topic', '/Users/x/dev/dshfiles')).toBe(true)
  })

  it('refuses the repository, anything inside it, and any parent of it', () => {
    expect(isDisposableWorkspacePath('/Users/x/dev/dshfiles', '/Users/x/dev/dshfiles')).toBe(false)
    expect(isDisposableWorkspacePath('/Users/x/dev/dshfiles/plugins', '/Users/x/dev/dshfiles')).toBe(false)
    expect(isDisposableWorkspacePath('/Users/x/dev', '/Users/x/dev/dshfiles')).toBe(false)
    expect(isDisposableWorkspacePath('/', '/Users/x/dev/dshfiles')).toBe(false)
  })
})
