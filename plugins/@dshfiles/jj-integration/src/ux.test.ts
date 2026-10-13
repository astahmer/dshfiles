import { describe, expect, it } from 'vitest'
import type { JjIntegrationTranslate } from './locales.js'
import type { IntegrationCandidate, WorkspaceRecord } from './types.js'
import { blockerOf } from './panel.js'

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
  lastActivityAt: 1,
  pinned: false,
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
