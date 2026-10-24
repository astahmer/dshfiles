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
    })
    expect(threadBoardViewSchema.safeParse({ ...DEFAULT_THREAD_BOARD_VIEW, statusFilters: ['all'] }).success).toBe(false)
    expect(threadBoardViewSchema.safeParse({ ...DEFAULT_THREAD_BOARD_VIEW, unexpected: true }).success).toBe(false)
    expect(threadBoardViewSchema.parse({ ...DEFAULT_THREAD_BOARD_VIEW, statusFilters: ['not-working'] }).statusFilters).toEqual(['not-running'])
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
