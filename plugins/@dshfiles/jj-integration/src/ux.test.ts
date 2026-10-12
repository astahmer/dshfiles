import { describe, expect, it } from 'vitest'
import type { JjIntegrationTranslate } from './locales.js'
import type { IntegrationCandidate, WorkspaceRecord } from './types.js'
import { blockerOf } from './panel.js'
import { describeStatus } from './workspace-chip.js'

const t = ((key: string) => key) as unknown as JjIntegrationTranslate

const workspace = (overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
  id: '00000000-0000-4000-8000-000000000001',
  repositoryId: '00000000-0000-4000-8000-000000000002',
  name: 'dshfiles-threads/topic',
  path: '/tmp/topic',
  lifecycle: 'active',
  currentRevision: null,
  owners: [{ sessionId: 'session-a', attachedAt: 1, detachedAt: null, source: 'agent-tool' }],
  createdAt: 1,
  updatedAt: 1,
  lastObservedAt: null,
  missing: false,
  notes: null,
  isolated: true,
  writerEpoch: 0,
  writerLease: null,
  observers: [],
  ...overrides,
})

const candidate = (overrides: Partial<IntegrationCandidate> = {}): IntegrationCandidate => ({
  id: '00000000-0000-4000-8000-000000000003',
  repositoryId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  sourceSessionId: 'session-a',
  sourceRevision: { changeId: 'abcdefgh', commitId: 'a'.repeat(40), description: 'work' },
  spineAtSubmit: null,
  dependsOn: [],
  state: 'queued',
  correlationId: null,
  createdAt: 1,
  updatedAt: 1,
  attempts: [],
  resultRevision: null,
  conflict: null,
  validation: { kind: 'none', revision: null, command: null, exitCode: null, outputExcerpt: '', ranAt: null },
  error: null,
  queuePosition: 0,
  ...overrides,
})

describe('composer workspace status', () => {
  it('reads a free workspace as writable', () => {
    expect(describeStatus(workspace(), undefined, 'session-a', t)).toEqual({ label: 'chipWritable', tone: 'success' })
  })

  it('names the holder when another session owns the lease', () => {
    const lease = { sessionId: 'session-b', epoch: 2, acquiredAt: 1, heartbeatAt: 1, host: null }
    expect(describeStatus(workspace({ writerLease: lease }), undefined, 'session-a', t)).toEqual({ label: 'chipOwnedElsewhere', tone: 'danger' })
    expect(describeStatus(workspace({ writerLease: lease, observers: [{ sessionId: 'session-a', since: 1 }] }), undefined, 'session-a', t)).toEqual({
      label: 'chipReadOnly',
      tone: 'neutral',
    })
  })

  it('keeps the lease holder writable and surfaces integration progress', () => {
    const lease = { sessionId: 'session-a', epoch: 1, acquiredAt: 1, heartbeatAt: 1, host: null }
    expect(describeStatus(workspace({ writerLease: lease }), undefined, 'session-a', t)).toEqual({ label: 'chipWritable', tone: 'success' })
    expect(describeStatus(workspace({ writerLease: lease }), candidate({ state: 'running' }), 'session-a', t)).toEqual({ label: 'chipIntegrating', tone: 'info' })
    expect(describeStatus(workspace({ writerLease: lease }), candidate({ state: 'queued' }), 'session-a', t)).toEqual({ label: 'chipIntegrationPending', tone: 'warning' })
    expect(describeStatus(workspace({ writerLease: lease }), candidate({ state: 'blocked' }), 'session-a', t)).toEqual({ label: 'chipNeedsResolution', tone: 'danger' })
  })

  it('reports a missing workspace ahead of any ownership state', () => {
    expect(describeStatus(workspace({ missing: true }), candidate({ state: 'running' }), 'session-a', t)).toEqual({ label: 'missing', tone: 'danger' })
  })
})

describe('integration blocker', () => {
  it('explains conflicts, validation, dependencies and stale sources', () => {
    expect(blockerOf(candidate({ conflict: { files: ['a.ts', 'b.ts'], detectedAt: 1, note: '' } }))).toBe('2 conflicting file(s)')
    expect(
      blockerOf(candidate({ validation: { kind: 'command', revision: null, command: 'pnpm test', exitCode: 1, outputExcerpt: '', ranAt: 1 } })),
    ).toBe('validation failed')
    expect(blockerOf(candidate({ dependsOn: ['00000000-0000-4000-8000-000000000009'] }))).toBe('1 dependency candidate(s)')
    expect(blockerOf(candidate({ state: 'stale' }))).toBe('source revision moved after queueing')
  })

  it('has nothing to explain for a healthy queued candidate', () => {
    expect(blockerOf(candidate())).toBeNull()
  })
})
