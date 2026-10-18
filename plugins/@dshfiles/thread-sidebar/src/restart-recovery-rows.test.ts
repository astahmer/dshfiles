import assert from 'node:assert/strict'
import { test } from 'vitest'
import { selectRecoveryRows, selectRestartRecoveryRows } from './restart-recovery-rows.js'
import type { RecoveryReason } from './restart-recovery.js'

const session = (id: string, updatedAt: number, overrides: Partial<{ readonly blank: boolean; readonly running: boolean }> = {}) => ({
  id,
  updatedAt,
  blank: overrides.blank ?? false,
  running: overrides.running ?? false,
})

test('recovery rows include only persisted restart candidates that remain idle and visible', () => {
  const rows = selectRestartRecoveryRows({
    sessions: [
      session('restart-interrupted', 4),
      session('unrelated-idle', 3),
      session('still-running', 2, { running: true }),
      session('blank', 1, { blank: true }),
      session('muted', 7),
      session('archived', 6),
      session('other-project', 5),
      session('other-source', 8),
    ],
    sessionIds: new Set(['restart-interrupted', 'still-running', 'blank', 'muted', 'archived', 'other-project', 'other-source']),
    mutedSessionIds: new Set(['muted']),
    archivedSessionIds: new Set(['archived']),
    settledSessionIds: new Set(),
    matchesWorkspace: candidate => candidate.id !== 'other-project',
    matchesSource: candidate => candidate.id !== 'other-source',
  })

  assert.deepEqual(
    rows.map(row => row.id),
    ['restart-interrupted'],
  )
})

test('interrupted rows keep crash recoveries apart from managed restarts', () => {
  const reasons = new Map<string, RecoveryReason>([
    ['crash-a', 'interrupted'],
    ['crash-b', 'interrupted'],
    ['restart-a', 'restart'],
  ])
  const options = {
    sessions: [session('crash-a', 1), session('crash-b', 9), session('restart-a', 5), session('no-reason', 7)],
    sessionIds: new Set(['crash-a', 'crash-b', 'restart-a']),
    reasonFor: (sessionId: string) => reasons.get(sessionId),
    mutedSessionIds: new Set<string>(),
    archivedSessionIds: new Set<string>(),
    settledSessionIds: new Set<string>(),
    matchesWorkspace: () => true,
    matchesSource: () => true,
  }

  assert.deepEqual(
    selectRecoveryRows({ ...options, reason: 'interrupted' }).map(row => row.id),
    ['crash-b', 'crash-a'],
  )
  assert.deepEqual(
    selectRecoveryRows({ ...options, reason: 'restart' }).map(row => row.id),
    ['restart-a'],
  )
})
