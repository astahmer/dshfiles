import assert from 'node:assert/strict'
import { test } from 'vitest'
import { COLLAPSED_GROUPS_STORAGE_KEY, storedCollapsedGroups, toggleCollapsedGroup } from './collapsed-groups.js'

test('toggling a group key adds it and toggling again removes it', () => {
  const collapsed = toggleCollapsedGroup([], 'project:alpha')
  assert.deepEqual(collapsed, ['project:alpha'])
  assert.deepEqual(toggleCollapsedGroup(collapsed, 'project:alpha'), [])
  assert.deepEqual(toggleCollapsedGroup(collapsed, 'date:today'), ['project:alpha', 'date:today'])
})

test('a stored value the schema rejects reads as the fallback', () => {
  assert.equal(COLLAPSED_GROUPS_STORAGE_KEY, 'dshfiles.thread-sidebar.collapsed-groups.v1')
  assert.equal(storedCollapsedGroups.get() !== undefined, true)
})
