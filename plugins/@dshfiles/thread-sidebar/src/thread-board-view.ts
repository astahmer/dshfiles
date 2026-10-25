import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import { SIDEBAR_SECTIONS, type SidebarSection } from './organization.js'
import {
  THREAD_GROUP_BY_OPTIONS,
  THREAD_SOURCE_FILTER_OPTIONS,
  THREAD_STATUS_FILTER_OPTIONS,
  upgradeLegacyStatusFilters,
  type ThreadStatusFilter,
  type ThreadViewPreferences,
} from './thread-view.js'

export interface ThreadBoardViewSettings extends ThreadViewPreferences {
  readonly projectFilter: string | null
  readonly collapsedGroups: readonly string[]
  readonly collapsedSections: readonly SidebarSection[]
  readonly columnOrder: readonly string[]
  readonly hiddenColumns: readonly string[]
}

const BOARD_DEFAULT_COLUMN_ORDER = [...SIDEBAR_SECTIONS]

export const DEFAULT_THREAD_BOARD_VIEW: ThreadBoardViewSettings = {
  groupBy: 'status',
  statusFilters: [],
  sourceFilter: 'all',
  projectFilter: null,
  collapsedGroups: [],
  collapsedSections: [],
  columnOrder: BOARD_DEFAULT_COLUMN_ORDER,
  hiddenColumns: [],
}

const groupBySchema = z.enum(THREAD_GROUP_BY_OPTIONS)
const sourceFilterSchema = z.enum(THREAD_SOURCE_FILTER_OPTIONS)
const statusFilterSchema = z.enum(THREAD_STATUS_FILTER_OPTIONS.filter((filter): filter is ThreadStatusFilter => filter !== 'all'))

export const threadBoardViewSchema = z
  .object({
    groupBy: groupBySchema,
    statusFilters: z.preprocess(
      value => (Array.isArray(value) ? upgradeLegacyStatusFilters(value) : value),
      z
        .array(statusFilterSchema)
        .max(THREAD_STATUS_FILTER_OPTIONS.length - 1)
        .readonly(),
    ),
    sourceFilter: sourceFilterSchema,
    projectFilter: z.string().max(200).nullable(),
    collapsedGroups: z.array(z.string().max(160)).max(64).readonly(),
    collapsedSections: z.array(z.enum(SIDEBAR_SECTIONS)).max(SIDEBAR_SECTIONS.length).readonly(),
    columnOrder: z
      .array(z.string().max(160))
      .max(128)
      .readonly()
      .default([...BOARD_DEFAULT_COLUMN_ORDER]),
    hiddenColumns: z.array(z.string().max(160)).max(128).readonly().default([]),
  })
  .strict()
  .superRefine((settings, context) => {
    if (new Set(settings.statusFilters).size !== settings.statusFilters.length) {
      context.addIssue({ code: 'custom', path: ['statusFilters'], message: 'Status filters must be unique.' })
    }
  })

export const storedThreadBoardView = createStoredValue({
  key: 'dshfiles.thread-sidebar.board-view.v1',
  schema: threadBoardViewSchema,
  fallback: DEFAULT_THREAD_BOARD_VIEW,
})

export class ThreadBoardViewModel {
  static readonly update = (
    current: ThreadBoardViewSettings,
    patch: Partial<
      Pick<
        ThreadBoardViewSettings,
        'groupBy' | 'statusFilters' | 'sourceFilter' | 'projectFilter' | 'collapsedGroups' | 'collapsedSections' | 'columnOrder' | 'hiddenColumns'
      >
    >,
  ): ThreadBoardViewSettings => {
    const result = threadBoardViewSchema.safeParse({ ...current, ...patch })
    return result.success ? result.data : current
  }

  static readonly orderColumns = (columns: readonly string[], savedOrder: readonly string[]): string[] => {
    const available = new Set(columns)
    return [...savedOrder.filter(column => available.has(column)), ...columns.filter(column => !savedOrder.includes(column))]
  }

  static readonly moveColumn = (columns: readonly string[], column: string, direction: -1 | 1): string[] => {
    const current = [...columns]
    const from = current.indexOf(column)
    const to = from + direction
    if (from < 0 || to < 0 || to >= current.length) return current
    current.splice(from, 1)
    current.splice(to, 0, column)
    return current
  }

  static readonly toggleColumn = (hiddenColumns: readonly string[], column: string, visible: boolean): string[] => {
    const hidden = new Set(hiddenColumns)
    if (visible) hidden.delete(column)
    else hidden.add(column)
    return [...hidden]
  }
}
