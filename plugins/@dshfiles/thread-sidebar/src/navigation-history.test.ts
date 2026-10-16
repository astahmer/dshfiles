import assert from 'node:assert/strict'
import { test } from 'vitest'
import { ThreadNavigationHistoryModel, type NavigationLocation } from './navigation-history.js'

const thread = (id: string): NavigationLocation => ({ kind: 'thread', id })
const panel = (id: string): NavigationLocation => ({ kind: 'panel', id })

const visitAll = (locations: readonly NavigationLocation[]) =>
  locations.reduce((history, location) => ThreadNavigationHistoryModel.visitLocation(history, location), ThreadNavigationHistoryModel.emptyNavigationHistory())

test('an open panel is the location; otherwise the selected thread is', () => {
  assert.deepEqual(ThreadNavigationHistoryModel.currentLocation({ panelId: 'settings', threadId: 'a' }), panel('settings'))
  assert.deepEqual(ThreadNavigationHistoryModel.currentLocation({ panelId: null, threadId: 'a' }), thread('a'))
  assert.equal(ThreadNavigationHistoryModel.currentLocation({ panelId: null, threadId: null }), null)
})

test('back and forward walk visited threads and panels, disabled at either end', () => {
  const history = visitAll([thread('a'), panel('settings'), thread('b')])
  assert.equal(ThreadNavigationHistoryModel.canStep(history, 1), false)
  assert.equal(ThreadNavigationHistoryModel.canStep(ThreadNavigationHistoryModel.emptyNavigationHistory(), -1), false)

  const back = ThreadNavigationHistoryModel.stepHistory(history, -1)
  assert.deepEqual(back?.target, panel('settings'))
  const backAgain = back === null ? null : ThreadNavigationHistoryModel.stepHistory(back.history, -1)
  assert.deepEqual(backAgain?.target, thread('a'))
  assert.equal(backAgain === null ? true : ThreadNavigationHistoryModel.canStep(backAgain.history, -1), false)

  const forward = backAgain === null ? null : ThreadNavigationHistoryModel.stepHistory(backAgain.history, 1)
  assert.deepEqual(forward?.target, panel('settings'))
})

test('visiting after going back drops the forward entries; revisiting the current entry is a no-op', () => {
  const history = visitAll([thread('a'), thread('b'), thread('c')])
  const back = ThreadNavigationHistoryModel.stepHistory(history, -1)
  assert.ok(back)
  const branched = ThreadNavigationHistoryModel.visitLocation(back.history, thread('d'))
  assert.deepEqual(branched.entries, [thread('a'), thread('b'), thread('d')])
  assert.equal(ThreadNavigationHistoryModel.canStep(branched, 1), false)
  assert.equal(ThreadNavigationHistoryModel.visitLocation(branched, thread('d')), branched)
})

test('history keeps only the newest entries past its limit', () => {
  const history = ['a', 'b', 'c', 'd'].reduce(
    (current, id) => ThreadNavigationHistoryModel.visitLocation(current, thread(id), 3),
    ThreadNavigationHistoryModel.emptyNavigationHistory(),
  )
  assert.deepEqual(history.entries, [thread('b'), thread('c'), thread('d')])
  assert.equal(history.index, 2)
})

test('the history menu jumps to any visited entry and keeps the rest for back and forward', () => {
  const history = visitAll([thread('a'), panel('settings'), thread('b'), thread('c')])
  const jump = ThreadNavigationHistoryModel.jumpHistory(history, 0)
  assert.deepEqual(jump?.target, thread('a'))
  assert.equal(jump?.history.entries, history.entries)
  assert.equal(jump === null ? true : ThreadNavigationHistoryModel.canStep(jump.history, 1), true)
  assert.equal(ThreadNavigationHistoryModel.jumpHistory(history, history.index), null)
  assert.equal(ThreadNavigationHistoryModel.jumpHistory(history, 9), null)
})
