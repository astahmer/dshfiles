import { describe, expect, it } from 'vitest'
import { DEFAULT_THREAD_BOARD_VIEW, ThreadBoardViewModel, threadBoardViewSchema } from './thread-board-view.js'

describe('thread board view', () => {
  it('starts with its own all-project status view', () => {
    expect(DEFAULT_THREAD_BOARD_VIEW).toEqual({
      groupBy: 'status',
      statusFilters: [],
      sourceFilter: 'all',
      projectFilter: null,
      collapsedGroups: [],
      collapsedSections: [],
      columnOrder: ['pinned', 'active', 'parked', 'inactive', 'settled', 'archived'],
      hiddenColumns: [],
    })
  })

  it('validates independent grouping and filters', () => {
    expect(
      threadBoardViewSchema.parse({
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
      columnOrder: ['pinned', 'active', 'parked', 'inactive', 'settled', 'archived'],
      hiddenColumns: [],
    })
    expect(threadBoardViewSchema.safeParse({ ...DEFAULT_THREAD_BOARD_VIEW, statusFilters: ['all'] }).success).toBe(false)
    expect(threadBoardViewSchema.safeParse({ ...DEFAULT_THREAD_BOARD_VIEW, unexpected: true }).success).toBe(false)
    expect(threadBoardViewSchema.parse({ ...DEFAULT_THREAD_BOARD_VIEW, statusFilters: ['not-working'] }).statusFilters).toEqual(['not-running'])
  })

  it('keeps board column order and visibility independent and moves columns safely', () => {
    const current = ThreadBoardViewModel.update(DEFAULT_THREAD_BOARD_VIEW, {
      columnOrder: ThreadBoardViewModel.moveColumn(DEFAULT_THREAD_BOARD_VIEW.columnOrder, 'archived', -1),
      hiddenColumns: ThreadBoardViewModel.toggleColumn(DEFAULT_THREAD_BOARD_VIEW.hiddenColumns, 'inactive', false),
    })

    expect(current.columnOrder).toEqual(['pinned', 'active', 'parked', 'inactive', 'archived', 'settled'])
    expect(current.hiddenColumns).toEqual(['inactive'])
    expect(ThreadBoardViewModel.orderColumns(['today', 'older'], ['older', 'archived'])).toEqual(['older', 'today'])
    expect(ThreadBoardViewModel.moveColumn(current.columnOrder, 'pinned', -1)).toEqual(current.columnOrder)
    expect(ThreadBoardViewModel.moveColumn(current.columnOrder, 'missing', 1)).toEqual(current.columnOrder)
    expect(ThreadBoardViewModel.toggleColumn(current.hiddenColumns, 'inactive', true)).toEqual([])
    expect(DEFAULT_THREAD_BOARD_VIEW.columnOrder).toEqual(['pinned', 'active', 'parked', 'inactive', 'settled', 'archived'])
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
      columnOrder: ['pinned', 'active', 'parked', 'inactive', 'settled', 'archived'],
      hiddenColumns: [],
    })
    expect(DEFAULT_THREAD_BOARD_VIEW).toEqual({
      groupBy: 'status',
      statusFilters: [],
      sourceFilter: 'all',
      projectFilter: null,
      collapsedGroups: [],
      collapsedSections: [],
      columnOrder: ['pinned', 'active', 'parked', 'inactive', 'settled', 'archived'],
      hiddenColumns: [],
    })
  })
})
