import assert from 'node:assert/strict'
import { test } from 'vitest'
import { selectRestartRecoveryRows } from './restart-recovery-rows.js'

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
    matchesWorkspace: candidate => candidate.id !== 'other-project',
    matchesSource: candidate => candidate.id !== 'other-source',
  })

  assert.deepEqual(
    rows.map(row => row.id),
    ['restart-interrupted'],
  )
})
