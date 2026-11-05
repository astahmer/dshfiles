import type { BacklogSummaryView } from './api.js'

/** The relation fields every summary carries, at their empty values, for test fixtures that spell a summary out. */
export const summaryRelationDefaults = {
  priority: 'none',
  parent: null,
  owner: 'user',
  delegate: null,
  children: { total: 0, done: 0 },
  ready: false,
  blockedBy: [],
  lease: null,
  criteriaProgress: { total: 0, done: 0 },
  planApproval: null,
} as const satisfies Partial<BacklogSummaryView>
