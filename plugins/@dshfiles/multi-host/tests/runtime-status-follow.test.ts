import { expect, test } from 'vitest'
import { RuntimeStatusModel } from '../src/runtime-status.js'

// The workspace follow baseline and replace frames carry the owning runtime's archived and pinned Session sets, and
// the archived increment carries a new one. The status serves those sets, so a sidebar can place a remote row.

const workspace = { workspaceId: 'workspace-a', path: '/work/app', title: 'app', sessionIds: ['session-live', 'session-archived'] }

const baseline = {
  type: 'baseline',
  value: { items: [workspace], archivedSessionIds: ['session-archived'], pinnedSessionIds: ['session-live'] },
}

test('reads the archived set from the follow baseline and still reads its workspaces', () => {
  expect(RuntimeStatusModel.archivedSessionIds([baseline])).toEqual(['session-archived'])
  expect(RuntimeStatusModel.workspaces([baseline])).toEqual([workspace])
})

test('follows an archived increment and a replace frame', () => {
  expect(RuntimeStatusModel.archivedSessionIds([{ type: 'archived', archivedSessionIds: ['session-a', 'session-b'] }])).toEqual(['session-a', 'session-b'])
  expect(RuntimeStatusModel.archivedSessionIds([{ type: 'replace', value: { items: [], archivedSessionIds: ['session-c'], pinnedSessionIds: [] } }])).toEqual([
    'session-c',
  ])
})

test('a runtime that reports no archived set, or a malformed one, yields none', () => {
  expect(RuntimeStatusModel.archivedSessionIds([{ type: 'baseline', value: { items: [workspace] } }])).toEqual([])
  expect(RuntimeStatusModel.archivedSessionIds([{ type: 'baseline', value: { archivedSessionIds: [42, null] } }])).toEqual([])
  expect(RuntimeStatusModel.archivedSessionIds([])).toEqual([])
})

test('one Session id appears once however many frames carry it', () => {
  expect(RuntimeStatusModel.archivedSessionIds([baseline, { type: 'archived', archivedSessionIds: ['session-archived', 'session-a'] }])).toEqual([
    'session-archived',
    'session-a',
  ])
})
