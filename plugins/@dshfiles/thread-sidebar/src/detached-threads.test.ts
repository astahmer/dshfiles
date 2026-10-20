import assert from 'node:assert/strict'
import { test } from 'vitest'
import { DetachedThreadsModel } from './detached-threads.js'

test('an unavailable branch hides its archived threads until the view asks for archived', () => {
  assert.equal(DetachedThreadsModel.showsArchived([]), false)
  assert.equal(DetachedThreadsModel.showsArchived(['working', 'muted']), false)
  assert.equal(DetachedThreadsModel.showsArchived(['archived']), true)
  assert.equal(DetachedThreadsModel.showsArchived(['archived', 'settled']), true)
})

test('the branch header archives its live threads and restores it once every visible thread is archived', () => {
  assert.equal(DetachedThreadsModel.actionFor([]), null)
  assert.equal(DetachedThreadsModel.actionFor([{ archived: false }, { archived: true }]), 'archive')
  assert.equal(DetachedThreadsModel.actionFor([{ archived: false }, { archived: false }]), 'archive')
  assert.equal(DetachedThreadsModel.actionFor([{ archived: true }, { archived: true }]), 'restore')
})
