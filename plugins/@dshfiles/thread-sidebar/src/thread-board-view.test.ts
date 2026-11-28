import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'
import { DEFAULT_THREAD_BOARD_VIEW, ThreadBoardViewModel, threadBoardViewSchema } from './thread-board-view.js'
import { ThreadStatusModel } from './thread-status.js'

describe('thread board view', () => {
  it('draws the list\'s status groups as columns, even from an older stored section view', () => {
    expect(ThreadBoardViewModel.columnsOf(DEFAULT_THREAD_BOARD_VIEW).groupBy).toBe('state')
    const view = ThreadBoardViewModel.columnsOf({ ...DEFAULT_THREAD_BOARD_VIEW, groupBy: 'status' })
    expect(view.groupBy).toBe('state')
    expect(ThreadBoardViewModel.columnsOf({ ...DEFAULT_THREAD_BOARD_VIEW, groupBy: 'project' }).groupBy).toBe('project')
    const NOW = 10_000_000_000
    const status = (draft: boolean) =>
      ThreadStatusModel.statusOf({ running: false, pinned: false, archived: false, settled: false, unread: false, labels: [], inbox: undefined, draft, activityAt: NOW - 1_000, settledAt: undefined, now: NOW })
    const groups = ThreadStatusModel.groupEntries([
      { thread: 'a', status: status(false), cameBackAt: 1 },
      { thread: 'b', status: status(false), cameBackAt: 2 },
      { thread: 'c', status: status(true), cameBackAt: 3 },
    ])
    expect(groups.map(group => `${group.group} (${String(group.threads.length)})`)).toEqual(['idle (2)', 'draft (1)'])
  })

  it('starts with its own all-project status view', () => {
    expect(DEFAULT_THREAD_BOARD_VIEW).toEqual({
      groupBy: 'status',
      statusFilters: [],
      sourceFilter: 'all',
      projectFilter: null,
      collapsedGroups: [],
      collapsedSections: [],
    })
  })

  it('validates independent grouping and filters', () => {
    expect(
      Schema.decodeUnknownSync(threadBoardViewSchema)({
        groupBy: 'project',
        statusFilters: ['working', 'attention'],
        sourceFilter: 'subagents',
        projectFilter: 'workspace-1',
        collapsedGroups: [],
        collapsedSections: [],
      }),
    ).toEqual({
      groupBy: 'project',
      statusFilters: ['working', 'attention'],
      sourceFilter: 'subagents',
      projectFilter: 'workspace-1',
      collapsedGroups: [],
      collapsedSections: [],
    })
    expect(SchemaHelpers.decodeUnknownSafe(threadBoardViewSchema, { ...DEFAULT_THREAD_BOARD_VIEW, statusFilters: ['all'] }).success).toBe(false)
    expect(SchemaHelpers.decodeUnknownSafe(threadBoardViewSchema, { ...DEFAULT_THREAD_BOARD_VIEW, unexpected: true }).success).toBe(false)
    expect(Schema.decodeUnknownSync(threadBoardViewSchema)({ ...DEFAULT_THREAD_BOARD_VIEW, statusFilters: ['not-working'] }).statusFilters).toEqual([
      'not-running',
    ])
  })

  it('updates only the board view and rejects invalid patches', () => {
    const board = ThreadBoardViewModel.update(DEFAULT_THREAD_BOARD_VIEW, {
      groupBy: 'date',
      sourceFilter: 'main',
      projectFilter: '',
    })

    expect(board).toEqual({
      groupBy: 'date',
      statusFilters: [],
      sourceFilter: 'main',
      projectFilter: '',
      collapsedGroups: [],
      collapsedSections: [],
    })
    expect(DEFAULT_THREAD_BOARD_VIEW).toEqual({
      groupBy: 'status',
      statusFilters: [],
      sourceFilter: 'all',
      projectFilter: null,
      collapsedGroups: [],
      collapsedSections: [],
    })
  })
})
