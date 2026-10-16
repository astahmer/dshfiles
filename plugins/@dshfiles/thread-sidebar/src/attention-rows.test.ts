import assert from 'node:assert/strict'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { test } from 'vitest'
import { selectInputNeededRows, selectTurnFinishedRows } from './attention-rows.js'

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

test('keeps an unresolved continued question out of Turn finished', () => {
  const continuedQuestion = { id: SessionId('continued-question'), blank: false, running: false, updatedAt: 10 }
  const finishedSession = { id: SessionId('finished'), blank: false, running: false, updatedAt: 20 }
  const rows = selectTurnFinishedRows({
    sessions: [continuedQuestion, finishedSession],
    selectedSessionId: undefined,
    inputNeededSessionIds: new Set([continuedQuestion.id]),
    approvalNeededSessionIds: new Set<ReturnType<typeof SessionId>>(),
    completionAt: { [continuedQuestion.id]: 1, [finishedSession.id]: 2 },
    mutedSessionIds: new Set<string>(),
    archivedSessionIds: new Set<string>(),
    excludedSessionIds: new Set<ReturnType<typeof SessionId>>(),
    matchesWorkspace: () => true,
  })

  assert.deepEqual(rows, [finishedSession])
})

test('keeps a thread another group already lists out of Turn finished', () => {
  const groupedElsewhere = { id: SessionId('grouped-elsewhere'), blank: false, running: false, updatedAt: 10 }
  const finishedSession = { id: SessionId('finished'), blank: false, running: false, updatedAt: 20 }
  const rows = selectTurnFinishedRows({
    sessions: [groupedElsewhere, finishedSession],
    selectedSessionId: undefined,
    inputNeededSessionIds: new Set<ReturnType<typeof SessionId>>(),
    approvalNeededSessionIds: new Set<ReturnType<typeof SessionId>>(),
    completionAt: { [groupedElsewhere.id]: 1, [finishedSession.id]: 2 },
    mutedSessionIds: new Set<string>(),
    archivedSessionIds: new Set<string>(),
    excludedSessionIds: new Set([groupedElsewhere.id]),
    matchesWorkspace: () => true,
  })

  assert.deepEqual(rows, [finishedSession])
})
