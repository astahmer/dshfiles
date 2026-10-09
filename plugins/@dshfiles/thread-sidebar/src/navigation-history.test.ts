import assert from 'node:assert/strict'
import { test } from 'vitest'
import { canStep, currentLocation, emptyNavigationHistory, jumpHistory, stepHistory, visitLocation, type NavigationLocation } from './navigation-history.js'

const thread = (id: string): NavigationLocation => ({ kind: 'thread', id })
const panel = (id: string): NavigationLocation => ({ kind: 'panel', id })

const visitAll = (locations: readonly NavigationLocation[]) =>
  locations.reduce((history, location) => visitLocation(history, location), emptyNavigationHistory())

test('an open panel is the location; otherwise the selected thread is', () => {
  assert.deepEqual(currentLocation({ panelId: 'settings', threadId: 'a' }), panel('settings'))
  assert.deepEqual(currentLocation({ panelId: null, threadId: 'a' }), thread('a'))
  assert.equal(currentLocation({ panelId: null, threadId: null }), null)
})

test('back and forward walk visited threads and panels, disabled at either end', () => {
  const history = visitAll([thread('a'), panel('settings'), thread('b')])
  assert.equal(canStep(history, 1), false)
  assert.equal(canStep(emptyNavigationHistory(), -1), false)

  const back = stepHistory(history, -1)
  assert.deepEqual(back?.target, panel('settings'))
  const backAgain = back === null ? null : stepHistory(back.history, -1)
  assert.deepEqual(backAgain?.target, thread('a'))
  assert.equal(backAgain === null ? true : canStep(backAgain.history, -1), false)

  const forward = backAgain === null ? null : stepHistory(backAgain.history, 1)
  assert.deepEqual(forward?.target, panel('settings'))
})

test('visiting after going back drops the forward entries; revisiting the current entry is a no-op', () => {
  const history = visitAll([thread('a'), thread('b'), thread('c')])
  const back = stepHistory(history, -1)
  assert.ok(back)
  const branched = visitLocation(back.history, thread('d'))
  assert.deepEqual(branched.entries, [thread('a'), thread('b'), thread('d')])
  assert.equal(canStep(branched, 1), false)
  assert.equal(visitLocation(branched, thread('d')), branched)
})

test('history keeps only the newest entries past its limit', () => {
  const history = ['a', 'b', 'c', 'd'].reduce((current, id) => visitLocation(current, thread(id), 3), emptyNavigationHistory())
  assert.deepEqual(history.entries, [thread('b'), thread('c'), thread('d')])
  assert.equal(history.index, 2)
})

test('the history menu jumps to any visited entry and keeps the rest for back and forward', () => {
  const history = visitAll([thread('a'), panel('settings'), thread('b'), thread('c')])
  const jump = jumpHistory(history, 0)
  assert.deepEqual(jump?.target, thread('a'))
  assert.equal(jump?.history.entries, history.entries)
  assert.equal(jump === null ? true : canStep(jump.history, 1), true)
  assert.equal(jumpHistory(history, history.index), null)
  assert.equal(jumpHistory(history, 9), null)
})
