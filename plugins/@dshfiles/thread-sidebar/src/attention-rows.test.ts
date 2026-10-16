import assert from 'node:assert/strict'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { test } from 'vitest'
import { selectInputNeededRows } from './attention-rows.js'

test('shows the selected thread when it has an unanswered question', () => {
  const selectedSession = { id: SessionId('selected'), blank: false, updatedAt: 10 }
  const rows = selectInputNeededRows({
    sessions: [selectedSession],
    pendingInteractionKindFor: () => 'question',
    mutedSessionIds: new Set<string>(),
    archivedSessionIds: new Set<string>(),
    matchesWorkspace: () => true,
  })

  assert.deepEqual(rows, [selectedSession])
})
