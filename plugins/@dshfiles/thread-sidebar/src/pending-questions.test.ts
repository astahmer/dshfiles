import assert from 'node:assert/strict'
import { test } from 'vitest'
import { activeQuestionSessionIds } from './pending-questions.js'

test('reads only candidate Session rows that already carry active questions', () => {
  const candidates = ['waiting', 'empty', 'unprojected', 'missing']
  const summaries = {
    waiting: { projectionValues: { userQuestions: { active: [{ callId: 'question' }] } } },
    empty: { projectionValues: { userQuestions: { active: [] } } },
    unprojected: { projectionValues: { title: 'Completed thread' } },
  }

  assert.deepEqual(activeQuestionSessionIds(candidates, summaries), ['waiting'])
})

test('returns no question Sessions for an empty candidate list', () => {
  assert.deepEqual(activeQuestionSessionIds([], { waiting: { projectionValues: { userQuestions: { active: [{ callId: 'question' }] } } } }), [])
})
